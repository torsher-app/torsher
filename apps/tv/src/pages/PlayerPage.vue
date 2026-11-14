<script setup lang="ts">
import { playbackResume, sourceReturnState } from '../lib/sourceReturn.ts'
import type {
  Continuation,
  LibraryFile,
  SourceCandidate,
  UpNext,
} from '@torsher/api-client'
import { getErrorStatus } from '@torsher/api-client'
import type { AutomaticPlayback } from '../lib/continue.ts'
import { useContinuationConsent } from '../composables/useContinuationConsent.ts'
import {
  continuationBaseline,
  continuationQualityCheck,
} from '../lib/continuationQuality.ts'
import OptionsPanel from '../components/OptionsPanel.vue'
import type { KeyAction } from '../focus/index.ts'
import type { StageStep } from '../lib/player.ts'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  watchEffect,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PlayerBuffering from '../components/player/PlayerBuffering.vue'
import PlayerLamp from '../components/player/PlayerLamp.vue'
import PlayerSkip from '../components/player/PlayerSkip.vue'
import { currentSkip } from '../lib/skipSegments.ts'
import PlayerOsd from '../components/player/PlayerOsd.vue'
import PlayerPauseScreen from '../components/player/PlayerPauseScreen.vue'
import PlayerPrompt from '../components/player/PlayerPrompt.vue'
import PlayerStage from '../components/player/PlayerStage.vue'
import AppIcon from '../components/AppIcon.vue'
import AppToast from '../components/AppToast.vue'
import FocusSection from '../components/FocusSection.vue'
import SourcesScreen from '../components/SourcesScreen.vue'
import LibraryVersionPicker from '../components/LibraryVersionPicker.vue'
import { useLibraryPicker } from '../composables/useLibraryPicker.ts'
import { libraryChoices, libraryFilesFor } from '../lib/library.ts'
import type { SourceChoice } from '../components/SourcesScreen.vue'
import PlayerEpisodes from '../components/player/PlayerEpisodes.vue'
import PlayerSettings from '../components/player/PlayerSettings.vue'
import PlayerTracks from '../components/player/PlayerTracks.vue'
import PlayerUpNext from '../components/player/PlayerUpNext.vue'
import type {
  PlaybackRestart,
  PlayerError,
  PlayerFailure,
} from '../composables/usePlayback.ts'
import { api } from '../api.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useHls } from '../composables/useHls.ts'
import type {
  DiagnosticContext,
  DiagnosticInput,
} from '../diagnostics/index.ts'
import {
  activationTrigger,
  currentDiagnosticContext,
  diagnostic,
  diagnosticAction,
  diagnosticError,
  diagnosticMedia,
  diagnosticParams,
  diagnosticRoute,
  diagnosticSnapshot,
} from '../diagnostics/index.ts'
import { mediaSnapshot } from '../diagnostics/media.ts'
import { networkSnapshot } from '../diagnostics/network.ts'
import { diagnosticPlaybackMode, upNextGate } from '../diagnostics/player.ts'
import { usePlayback } from '../composables/usePlayback.ts'
import { usePlayerTracks } from '../composables/usePlayerTracks.ts'
import { usePlayerOsd } from '../composables/usePlayerOsd.ts'
import { usePlaybackSpeed } from '../composables/usePlaybackSpeed.ts'
import { usePlayerArt } from '../composables/usePlayerArt.ts'
import { useFocus } from '../focus/index.ts'
import {
  backAction,
  bufferedSeconds,
  bufferingStep,
  bufferProgress,
  byteOffset,
  canDimPause,
  canRetry,
  clampTime,
  countdownOf,
  endedEarly,
  errorKeyOf,
  formatGigabytes,
  freshBudget,
  mediaFailureAction,
  nextRetry,
  PAUSED_METADATA_MS,
  playerPrompt,
  settleBudget,
  stallAction,
  STATS_STALE_MS,
  streamLive,
  UP_NEXT_SECONDS,
  upNextVisible,
  videoTimePolicy,
} from '../lib/player.ts'
import {
  automaticEpisodeRoute,
  episodeCode,
  libraryRoute,
} from '../lib/continue.ts'
import {
  LOADER_DELAY_MS,
  loaderHoldMs,
  STAGE_MIN_VISIBLE_MS,
} from '../lib/loader.ts'
import { goBack } from '../lib/navigation.ts'
import { titleRefOf } from '../lib/sources.ts'
import { hasNativePlayer } from '../platform/android.ts'
import { attachNativeVideo } from '../platform/nativeVideo.ts'
import { heardStudio, unconfirmedStudio } from '../lib/tracks.ts'
import { lacksSources } from '../serverSources.ts'
import { session, updatePlayerSettings } from '../session.ts'

const props = defineProps<{
  // Файл раздачи — `torrentId` и `fileIndex`, файл библиотеки — `mediaFileId`
  torrentId?: string
  fileIndex?: string
  mediaFileId?: string
  // Открыт из карточки тайтла: позиция сохраняется по серии, а не по файлу
  titleId?: string
  season?: string
  episode?: string
  start?: string
  // Озвучка, которую слушали в прошлой раздаче: после смены раздачи
  voice?: string
  automatic?: AutomaticPlayback
}>()

// Позиция сохраняется по ходу просмотра, а не только на выходе: ТВ могут выключить
const SAVE_EVERY_S = 10

const { t, locale } = useI18n()
const router = useRouter()
const diagnosticContext = currentDiagnosticContext()
const focus = useFocus()
const isLibrary = !!props.mediaFileId
const player = usePlayback(
  props.mediaFileId
    ? { mediaFileId: props.mediaFileId }
    : { torrentId: props.torrentId!, fileIndex: Number(props.fileIndex) },
  titleRefOf(props.titleId, props.season, props.episode),
  props.voice,
  diagnosticContext,
  session.profile?.id,
)
const { playback, stats } = player
// Пиры и скорость — только у раздачи: файл библиотеки играется с диска
const shownStats = computed(() => (isLibrary ? undefined : stats.value))
// Серии сериала в библиотеке: следующая серия и выбор серии играют их сразу
const libraryFiles = ref<LibraryFile[]>([])

if (isLibrary && props.titleId) {
  api.titles
    .getTitleLibrary(props.titleId)
    .then((result) => {
      libraryFiles.value = result.files
    })
    .catch(() => {
      // Без списка следующая серия ищется, как у раздачи
    })
}

function libraryFileOf(season: number, episode: number) {
  return libraryFilesFor(libraryFiles.value, { season, episode })[0]
}

// Экран подготовки: кадр, логотип и серия тайтла — если плеер открыт из карточки
const season = props.season ? Number(props.season) : undefined
const episode = props.episode ? Number(props.episode) : undefined
// Даже без индексаторов библиотечному видео можно сменить версию.
const hasLibraryVersions = computed(
  () =>
    libraryChoices(libraryFiles.value, episode !== undefined, {
      season: season ?? null,
      episode,
    }).files.length > 1,
)
const {
  art,
  episodeOverview,
  subtitle: artSubtitle,
  reload: reloadArt,
} = usePlayerArt(props.titleId, season, episode)

// Название на сцене: тайтл из каталога, пока его нет — имя из ответа сервера
const stageTitle = computed(
  () =>
    art.value?.title
    ?? playback.value?.title
    ?? player.pending.value?.title
    ?? '',
)

const video = ref<HTMLVideoElement>()
// Ошибка сети — повтор; разбор сегментов не удался — ошибка медиа
const hls = useHls((kind, detail) => {
  diagnosticError(
    'hls',
    undefined,
    kind === 'network'
      ? 'hls_network'
      : kind === 'media'
        ? 'hls_media'
        : 'hls_other',
    { ...diagnosticContext, session: playback.value?.sessionId },
  )
  if (kind === 'network')
    recover('unknown')
  else if (kind === 'media')
    void onMediaFailure({ detail })
  else failAt('unknown', { detail })
})

// starting — запрашиваем адрес, buffering — ждём первые кадры, playing —
// видео хоть раз пошло
const phase = ref<'starting' | 'buffering' | 'playing'>('starting')
// Продолжили с сохранённого места без вопроса: в OSD кнопка «С начала», пока
// зритель сам не выбрал позицию
const fromStart = ref(false)
const stalled = ref(false)
const paused = ref(false)
const position = ref(0)
const tracks = usePlayerTracks(playback, video, position, restartWith)
const voiceNotice = ref('')
let pendingVoiceNotice = ''
const duration = ref(Number.NaN)
type Panel
  = 'audio' | 'subtitles' | 'episodes' | 'source' | 'settings' | 'versions'

const panel = ref<Panel | null>(null)
const settingsPanel = ref<InstanceType<typeof PlayerSettings>>()
const now = ref(new Date())
// OSD не выдаёт прошлую скорость и число сидов за текущие после сбоя опроса.
const osdStats = computed(() =>
  !player.statsFailed.value
  && now.value.getTime() - player.statsReceivedAt() <= STATS_STALE_MS
    ? shownStats.value
    : undefined,
)
const bufferingSince = ref(Date.now())
// Смена дорожки перезапуском: до нового потока на экране сцена с лоадером, а
// клавиши, кроме Back, не работают — перемотка потерялась бы при старте
const restarting = ref(false)
// Поток оборвался: ждём паузу перед повтором или идёт сам повтор
const reconnecting = ref(false)
// Пиры есть, но раздача не успевает, а повторы кончились: ждём с подписью
const slow = ref(false)

let startAt = 0
let savedAt = 0
let clockTimer: ReturnType<typeof setInterval> | undefined
let offKey: (() => void) | undefined
// Поток хоть раз ставился в видео: повтор продолжает его с места зрителя, а
// не с сохранённого на сервере
let begun = false
// Запуск перезапуском: устаревший после `await` уходит, не трогая видео
let launch = 0
let budget = freshBudget()
let retryTimer: ReturnType<typeof setTimeout> | undefined
// Пауза зрителя или свёрнутого приложения, а не остановка потока плеером
const returnedPlayback = playbackResume(
  router.options.history.state.resumePlayback,
)
let sourcePanelReturn = router.options.history.state.sourcePanelReturn === true
// Пассивный показ OSD указкой не отменяет уже выполненный шаг Back.
let controlsDismissedByBack = false

function resetBack() {
  controlsDismissedByBack = false
}

let viewerPaused = returnedPlayback?.paused ?? false
// Перезапуск на паузе зрителя: новый поток ждёт на той же паузе
let keepPaused = returnedPlayback?.paused ?? false
// Новый поток ждёт на паузе: на экран плеера он выходит с метаданными, когда
// видео уже на нужной позиции. По возврату в приложение снимается только пауза
// от сворачивания (`hidden`), пауза зрителя (`viewer`) остаётся
let startPausedBy: 'viewer' | 'hidden' | null = null
let metadataTimer: ReturnType<typeof setTimeout> | undefined
// Дорожки, с которыми запрошен перезапуск: если он сорвался, повтор берёт их,
// а не прежние из сессии
let requested: PlaybackRestart | undefined

// Сторож прогресса: состояние с прошлого тика
let armed = false
let armedAt = 0
let lastTime = 0
let progressAt = 0
let peersSince = 0
let playingSince: number | null = null

const knownDuration = computed(() =>
  Number.isFinite(duration.value)
    ? duration.value
    : (playback.value?.duration ?? Number.NaN),
)

const osd = usePlayerOsd({
  canAutoHide: () => !paused.value && !panel.value,
  canDim: () =>
    canDimPause({
      phase: phase.value,
      paused: paused.value,
      restarting: restarting.value,
      panelOpen: !!panel.value,
      // Удержанную при повторе ошибку отсекают `restarting` и фаза старта
      error: player.status.value === 'error',
    }),
  position: () => position.value,
  duration: () => knownDuration.value,
  // OSD мог появиться вместе с переходом в `playing`: таймлайн ещё не в DOM
  onShow: () => void nextTick(() => focus.activate('player-timeline')),
  onSeek: seekTo,
})

const step = computed<StageStep>(() => {
  if (reconnecting.value)
    return 'reconnecting'

  if (slow.value)
    return 'slow'

  return bufferingStep(
    stats.value ?? null,
    now.value.getTime() - bufferingSince.value,
    !player.statsFailed.value
    && now.value.getTime()
    - Math.max(player.statsReceivedAt(), bufferingSince.value)
    <= STATS_STALE_MS,
  )
})

// Буфер впереди — большее из скачанного движком подряд и того, что уже у браузера
const bufferSeconds = computed(() => {
  const fromEngine = bufferedSeconds(
    stats.value?.file.bufferedAhead ?? 0,
    playback.value?.size ?? 0,
    knownDuration.value,
  )
  const el = video.value
  let fromBrowser = 0

  if (el) {
    for (let i = 0; i < el.buffered.length; i++) {
      if (
        el.buffered.start(i) <= position.value
        && el.buffered.end(i) >= position.value
      ) {
        fromBrowser = el.buffered.end(i) - position.value
      }
    }
  }

  return Math.max(fromEngine, fromBrowser)
})

const trackOptions = computed(() =>
  panel.value === 'audio'
    ? tracks.audioOptions.value
    : tracks.subtitleOptions.value,
)

// Настройки профиля — вид субтитров и автопереход; скорость живёт до
// перезапуска витрины и переходит на следующую серию
const speed = usePlaybackSpeed()
const playerSettings = computed(
  () =>
    session.profile?.player ?? {
      autoNext: true,
      subtitleSize: 'm' as const,
      subtitleBackground: 'box' as const,
    },
)
const stopDiagnosticMedia = diagnosticMedia(() => {
  const media = mediaSnapshot(
    video.value,
    hasNativePlayer,
    playback.value,
    hls.diagnosticState(),
    tracks.selection(),
  )
  return {
    media,
    network: networkSnapshot({
      media,
      stats: stats.value,
      receivedAt: player.statsReceivedAt(),
      offset: player.statsOffset(),
      failed: player.statsFailed.value,
      now: Date.now(),
      library: isLibrary,
      torrentId: props.torrentId,
      fileIndex: Number(props.fileIndex),
      size: playback.value?.size,
      duration: knownDuration.value,
    }),
    context: { ...diagnosticContext, session: playback.value?.sessionId },
    active: phase.value === 'playing' && !paused.value && !document.hidden,
    stalled: stalled.value,
  }
})
watch([phase, paused, stalled], () =>
  diagnosticSnapshot(stalled.value ? 'buffering' : 'transition'))
const language = useCatalogLanguage()

watch(speed, (value) => {
  if (video.value)
    video.value.playbackRate = value
})

// Прямой адрес файла для VLC и Infuse — с origin витрины
const externalLink = computed(() =>
  playback.value ? new URL(playback.value.externalUrl, location.href).href : '',
)

// Следующая вышедшая серия и её файл в этой раздаче: спрашиваем при старте
const nextAired = ref<UpNext['next']>(null)
// Без источников серию, которой нет ни в раздаче, ни в библиотеке, не найти:
// её не предлагаем
const upNext = computed(() => {
  const next = nextAired.value

  if (!next || next.file || !lacksSources())
    return next

  return libraryFileOf(next.season, next.episode) ? next : null
})
// Видео дошло до конца само, а не оборвалось
const ended = ref(false)
const upNextDismissed = ref(false)
// Уходим к другой серии или раздаче: второй переход не начинаем
let leaving = false
const consent = useContinuationConsent(
  run => run === launch && !leaving,
  diagnosticContext,
)
const qualityChoice = consent.pending

if (props.titleId && season && episode) {
  api.titles
    .getTitleUpNext(
      props.titleId,
      {
        season: String(season),
        episode: String(episode),
        torrentId: props.torrentId,
        language: language.value,
      },
      diagnosticParams(diagnosticContext),
    )
    .then((result) => {
      diagnostic(
        {
          event: 'upnext.received',
          outcome: leaving ? 'stale' : 'accepted',
          available: !!result.next,
        },
        diagnosticContext,
      )
      nextAired.value = result.next
    })
    .catch(() => {
      diagnostic(
        { event: 'upnext.received', outcome: 'failed', available: false },
        diagnosticContext,
      )
      // Без ответа плашки нет: серию можно выбрать в «Сериях»
    })
}

if (!(props.titleId && season && episode)) {
  diagnostic(
    { event: 'upnext.received', outcome: 'unknown', available: false },
    diagnosticContext,
  )
}

const remaining = computed(() => knownDuration.value - position.value)

const errorKey = computed(() =>
  errorKeyOf({
    error: player.error.value,
    engineKind: player.engineKind.value,
    storageKind: player.storage.value?.kind,
    reasons: playback.value?.reasons,
  }),
)

// Цифры места — в гигабайтах: так их видит панель
const errorParams = computed(() => {
  const storage = player.storage.value
  const gigabytes = (bytes = 0) => formatGigabytes(bytes, locale.value)

  return {
    needed: gigabytes(storage?.needed),
    available: gigabytes(storage?.available),
    free: gigabytes(storage?.free),
    reserve: gigabytes(storage?.minFree),
    limit: gigabytes(storage?.cacheLimit),
  }
})

/**
 * «Повторить» оставляет ошибку на экране, пока новый запуск идёт дольше
 * задержки лоадера (`--loader-delay`): если сервер сразу ответит той же
 * ошибкой, экран не мигнёт сценой подготовки, а фокус останется на кнопке.
 * Текст снимается заранее: запуск сбрасывает ошибку и её подробности.
 */
const heldError = ref<{ title: string, text: string } | null>(null)
// Ошибку уже продержали всю задержку, или экран подготовки до плеера уже
// показывал торшер: торшер и чип встают без второй паузы
const instantLoader = ref(history.state?.loaderShown === true)
let retryHoldTimer = 0

function holdError() {
  heldError.value = {
    title: t(`${errorKey.value}.title`),
    text: t(`${errorKey.value}.text`, errorParams.value),
  }
  clearTimeout(retryHoldTimer)
  retryHoldTimer = window.setTimeout(() => {
    if (heldError.value && player.status.value === 'loading')
      instantLoader.value = true

    heldError.value = null
  }, LOADER_DELAY_MS)
}

// Тот же отказ, пока ошибку ещё держали: экран не менялся, и отклик —
// тряска кнопки «Повторить»
const retryRejections = ref(0)

watch(
  () => player.status.value,
  (status) => {
    if (status === 'error' && heldError.value)
      retryRejections.value++

    if (status !== 'loading')
      heldError.value = null
  },
)

const promptError = computed(() =>
  player.status.value !== 'error' && heldError.value
    ? heldError.value
    : {
        title: t(`${errorKey.value}.title`),
        text: t(`${errorKey.value}.text`, errorParams.value),
      },
)

const showsError = computed(
  () => player.status.value === 'error' || heldError.value !== null,
)

// «Назад» под указкой: видна вместе с OSD и на экранах до старта. У окна
// ошибки своя кнопка «Назад» — вторая сверху не нужна, и пока ошибку держат
// при повторе, тоже
const backVisible = computed(
  () => !showsError.value && (phase.value !== 'playing' || osd.visible.value),
)

const dismissedSkip = ref<string | null>(null)
const activeSkip = computed(() =>
  currentSkip(
    playback.value?.skipSegments,
    position.value,
    knownDuration.value,
  ),
)
const showsSkip = computed(
  () =>
    phase.value === 'playing'
    && !restarting.value
    && !showsError.value
    && !panel.value
    && !!activeSkip.value
    && dismissedSkip.value !== activeSkip.value.id,
)
const skipLabel = computed(() =>
  showsSkip.value
    ? t(
        activeSkip.value!.kind === 'intro'
          ? 'player.skipIntro'
          : 'player.skipCredits',
      )
    : undefined,
)
watch(
  () => activeSkip.value?.id,
  () => {
    dismissedSkip.value = null
  },
)
watch(
  showsSkip,
  (visible) => {
    if (
      !visible
      && !panel.value
      && osd.visible.value
      && focus.current()?.closest('.player-skip-action')
    ) {
      void nextTick(() => {
        if (!panel.value && osd.visible.value)
          focus.activate('player-timeline')
      })
    }
  },
  { flush: 'sync' },
)

function skipCurrent() {
  const segment = currentSkip(
    playback.value?.skipSegments,
    video.value?.currentTime ?? position.value,
    knownDuration.value,
  )
  if (!segment || !showsSkip.value || segment.id !== activeSkip.value?.id)
    return
  seekTo(segment.end)
}

const showsUpNext = computed(
  () =>
    phase.value === 'playing'
    && !restarting.value
    && !showsError.value
    && !panel.value
    && upNextVisible({
      available: !!upNext.value,
      dismissed: upNextDismissed.value,
      ended: ended.value,
      remaining: remaining.value,
      credits: activeSkip.value?.kind === 'credits',
    }),
)

let everDisplayed = false
let summarySent = false
let bufferingAt: number | undefined
let bufferingMs = 0
let bufferingCount = 0
const playedSessions = new Set<string>()
const nextGate = computed(() =>
  upNextGate({
    available: !!upNext.value,
    hasTarget: !!nextAired.value,
    displayed: showsUpNext.value,
    dismissed: upNextDismissed.value,
    playing: phase.value === 'playing',
    restarting: restarting.value,
    error: showsError.value,
    panel: !!panel.value,
    credits: activeSkip.value?.kind === 'credits',
    ended: ended.value,
    duration: knownDuration.value,
  }),
)
function nextSnapshot() {
  return {
    available: !!upNext.value,
    displayed: showsUpNext.value,
    gate: nextGate.value,
    position: Math.max(0, position.value),
    duration: Math.max(0, knownDuration.value),
    remaining: Math.max(0, remaining.value),
    thresholdSeconds: 60,
    countdownSeconds: 30,
    autoNext: playerSettings.value.autoNext,
  }
}
function dismissNext(trigger: 'pointer' | 'remote') {
  diagnostic(
    { event: 'upnext.dismissed', ...nextSnapshot(), trigger },
    diagnosticContext,
  )
  upNextDismissed.value = true
}
watch(
  [showsUpNext, nextGate],
  () => {
    everDisplayed ||= showsUpNext.value
    diagnostic(
      { event: 'upnext.visibility', ...nextSnapshot() },
      diagnosticContext,
    )
  },
  { immediate: true },
)
watch(stalled, (value) => {
  if (value) {
    bufferingAt = Date.now()
    bufferingCount++
    diagnostic(
      {
        event: 'playback.buffering',
        state: 'started',
        session: playback.value?.sessionId,
      },
      diagnosticContext,
    )
  }
  else if (bufferingAt !== undefined) {
    const durationMs = Math.min(1_000_000, Date.now() - bufferingAt)
    bufferingMs += durationMs
    bufferingAt = undefined
    diagnostic(
      {
        event: 'playback.buffering',
        state: 'ended',
        durationMs,
        session: playback.value?.sessionId,
      },
      diagnosticContext,
    )
  }
})
function playerSummary(
  reason: Extract<DiagnosticInput, { event: 'player.summary' }>['reason'],
) {
  if (summarySent)
    return
  summarySent = true
  const total = Math.min(
    1_000_000,
    bufferingMs + (bufferingAt === undefined ? 0 : Date.now() - bufferingAt),
  )
  diagnostic(
    {
      event: 'upnext.visibility',
      ...nextSnapshot(),
      summary: true,
      everDisplayed,
      trigger: 'exit',
    },
    diagnosticContext,
  )
  diagnostic(
    {
      event: 'playback.buffering',
      state: 'summary',
      durationMs: total,
      count: bufferingCount,
    },
    diagnosticContext,
  )
  diagnostic(
    {
      event: 'player.summary',
      reason,
      position: Math.max(0, position.value),
      duration: Math.max(0, knownDuration.value),
      upnextAvailable: !!upNext.value,
      upnextDisplayed: everDisplayed,
      bufferingMs: total,
      bufferingCount,
    },
    diagnosticContext,
    true,
  )
}
function backDiagnostic(
  outcome: Extract<DiagnosticInput, { event: 'player.back' }>['outcome'],
) {
  diagnostic(
    {
      event: 'player.back',
      outcome,
      position: Math.max(0, position.value),
      remaining: Math.max(0, remaining.value),
    },
    diagnosticAction(diagnosticContext),
    true,
  )
}

// Одна и та же подсказка рисуется поверх видео и принимает OK/Back пульта.
const prompt = computed(() => playerPrompt(showsUpNext.value, showsSkip.value))

// Без автоперехода отсчёта нет: плашка ждёт OK
const upNextCountdown = computed(() => {
  if (!playerSettings.value.autoNext)
    return null

  return ended.value ? 0 : countdownOf(remaining.value)
})

const visibleUpNextCountdown = computed(() =>
  upNextCountdown.value !== null && upNextCountdown.value <= UP_NEXT_SECONDS
    ? upNextCountdown.value
    : null,
)

const upNextElapsed = computed(() =>
  Math.min(1, Math.max(0, 1 - remaining.value / UP_NEXT_SECONDS)),
)

// Отсчёт дошёл до нуля — переход, даже если `ended` не придёт: старые ТВ на
// прямом потоке кончают файл не всегда
watch(upNextCountdown, (value) => {
  if (value === 0 && showsUpNext.value && !paused.value)
    void playNext('countdown')
})

const showsStage = computed(
  () => showsError.value || phase.value !== 'playing' || restarting.value,
)

// Задержку снимаем, только пока сцена на экране: сменить её у идущей анимации
// появления значит снова спрятать торшер. Следующая сцена — снова с задержкой
watch(showsStage, (shown) => {
  if (!shown)
    instantLoader.value = false
})

/**
 * Торшер и статус на сцене: с какого момента и с какой задержкой проявляются.
 * По ним решается, уйти в видео сразу или подержать сцену (`loaderHoldMs`)
 */
const showsLoader = computed(
  () => showsStage.value && !showsError.value && !qualityChoice.value,
)
let loaderSince = 0
let loaderDelay = LOADER_DELAY_MS
// Сколько файла было скачано, когда подготовка началась: от него считается
// докачанное для процента (`bufferProgress`)
let downloadedAtStage: number | null = null

watch(
  showsLoader,
  (shown) => {
    if (!shown)
      return

    loaderSince = performance.now()
    loaderDelay = instantLoader.value ? 0 : LOADER_DELAY_MS
    downloadedAtStage = null
  },
  { immediate: true },
)

// Уходящая сцена замирает: подпись и свет не меняются во время растворения
const stageStep = ref<StageStep>(step.value)
const stageStats = shallowRef(shownStats.value)

watchEffect(() => {
  if (!showsLoader.value)
    return

  stageStep.value = step.value
  stageStats.value = shownStats.value
})

const stageProgress = computed(() => {
  const file = stageStats.value?.file

  if (!file)
    return 0

  downloadedAtStage ??= file.downloaded

  return bufferProgress(
    file.bufferedAhead,
    file.downloaded - downloadedAtStage,
  )
})

/**
 * Видео готово, а торшер только что показался: сцена держится, пока он не
 * пробудет на экране `STAGE_MIN_VISIBLE_MS`, видео ждёт на первом кадре.
 * Пауза плеера, а не зрителя: `onPause` и сторож её не видят
 */
let holding = false
// На каждый запуск — одно удержание: после него сразу в видео
let held = false
let holdTimer: ReturnType<typeof setTimeout> | undefined
// Продолжаем не с начала: после растворения сцены OSD показывает, где мы
let osdAfterStage = false

function holdStage(ms: number) {
  holding = true
  held = true
  video.value?.pause()
  holdTimer = setTimeout(() => {
    holding = false
    holdTimer = undefined
    play()
  }, ms)
}

function cancelHold() {
  clearTimeout(holdTimer)
  holdTimer = undefined
  holding = false
}

function onStageGone() {
  if (osdAfterStage && phase.value === 'playing' && !showsStage.value)
    osd.show()

  osdAfterStage = false
}

function save(
  reason:
    'exit' | 'next' | 'source_switch' | 'pause' | 'checkpoint' = 'checkpoint',
  context: DiagnosticContext = diagnosticContext,
) {
  if (
    videoTimePolicy({ phase: phase.value, restarting: restarting.value }).save
  ) {
    return player.saveWatchState(
      osd.scrub.value?.target ?? position.value,
      knownDuration.value,
      reason,
      context,
    )
  }

  return Promise.resolve()
}

function automaticContext(): AutomaticPlayback {
  const video = playback.value?.media?.video
  return {
    kind: 'continuation',
    ...(video?.width
      && video.height && {
      current: {
        file: props.mediaFileId
          ? { kind: 'library' as const, mediaFileId: props.mediaFileId }
          : {
              kind: 'torrent' as const,
              torrentId: props.torrentId!,
              fileIndex: Number(props.fileIndex),
            },
        video: {
          width: video.width,
          height: video.height,
          basis: 'probe' as const,
        },
      },
    }),
  }
}

let automaticLibrary = false
let libraryDiagnosticContext: DiagnosticContext = diagnosticContext
const libraryPicker = useLibraryPicker((fileId, target, explicit) => {
  void switchToLibrary(
    fileId,
    target,
    automaticLibrary && !explicit ? automaticContext() : undefined,
    libraryDiagnosticContext,
  )
})
const librarySelection = libraryPicker.selection

function closeLibraryPicker() {
  backDiagnostic('close_panel')
  libraryPicker.close()
  closePanel()
}

/**
 * Другая серия, не выходя из плеера: позиция этой сохраняется до перехода,
 * иначе новый запуск прочитал бы старую. Файл в этой раздаче — сразу плеер,
 * иначе экран подготовки ищет раздачу с той же озвучкой
 */
async function switchTo(
  target: {
    season: number
    episode: number
    fileIndex?: number
  },
  context: DiagnosticContext = diagnosticAction(diagnosticContext),
) {
  if (leaving || !props.titleId)
    return

  const files = isLibrary ? libraryFilesFor(libraryFiles.value, target) : []

  if (files.length) {
    if (files.length > 1) {
      if (librarySelection.value)
        return

      // Отмена выбора не должна повторно запускать окончившийся отсчёт.
      upNextDismissed.value = true
      panel.value = 'versions'
      osd.show()
    }

    automaticLibrary = true
    libraryDiagnosticContext = context
    libraryPicker.open(
      { files, target, currentId: props.mediaFileId, titleId: props.titleId },
      context,
    )
    return
  }

  leaving = true
  const run = ++launch
  playerSummary('next')
  await save('next', context)
  if (run !== launch)
    return

  const title = {
    id: props.titleId,
    season: target.season,
    episode: target.episode,
    fileIndex: target.fileIndex,
  }
  const progress = await api.titles
    .getTitleProgress(
      props.titleId,
      {
        language: language.value,
        season: String(target.season),
        episode: String(target.episode),
      },
      diagnosticParams(context),
    )
    .catch(() => undefined)
  if (run !== launch)
    return
  const release = progress?.seasonReleases.find(
    item => item.season === season && item.torrentId === props.torrentId,
  )
  const voice = heardStudio(tracks.audioTrack.value, release?.voice)
  const next = upNext.value
  const file
    = next?.season === target.season && next.episode === target.episode
      ? next.file
      : null

  void router.replace(
    diagnosticRoute(
      automaticEpisodeRoute(
        title,
        file,
        props.torrentId,
        automaticContext(),
        voice,
      ),
      context,
    ),
  )
}

function playNext(
  trigger: 'remote' | 'pointer' | 'countdown' | 'ended' | 'OSD_next' = 'remote',
) {
  if (!upNext.value || leaving)
    return
  const context = diagnosticAction(diagnosticContext)
  diagnostic(
    {
      event: 'upnext.selected',
      ...nextSnapshot(),
      trigger,
      season: upNext.value.season,
      episode: upNext.value.episode,
    },
    context,
    true,
  )
  return switchTo(upNext.value, context)
}

/**
 * Другая раздача той же серии: позиция серии сохранится и продолжится в ней,
 * озвучка — та, что слышно сейчас, если она там есть
 */
async function switchSource(candidate: SourceCandidate, choice: SourceChoice) {
  if (candidate.torrentId === props.torrentId && !isLibrary) {
    closePanel()
    return
  }

  if (leaving || !props.titleId)
    return

  const context = Object.freeze({
    ...diagnosticAction(diagnosticContext),
    rankingDecisionId: choice.rankingDecisionId,
  })
  diagnostic(
    {
      event: 'selection.activated',
      slot: 'source',
      trigger: activationTrigger(),
      titleId: props.titleId,
      candidateId: candidate.id,
    },
    context,
    true,
  )
  leaving = true
  const run = ++launch
  playerSummary('source_switch')
  const sourceReturn = sourceReturnState(
    router.currentRoute.value,
    position.value,
    viewerPaused,
  )
  await save('source_switch', context)
  if (run !== launch)
    return
  void router.replace({
    path: `/title/${props.titleId}/play`,
    state: {
      diagnostic: { ...context },
      sourceReturn,
      sourcePanelReturn: null,
      resumePlayback: null,
    },
    query: {
      season: props.season,
      episode: props.episode,
      candidate: candidate.id,
      q: choice.query,
      voice: heardStudio(tracks.audioTrack.value, choice.playingVoice),
    },
  })
}

// Строка «В библиотеке» экрана источников: файл этой серии с диска
async function switchToLibrary(
  fileId: string,
  title: { season?: number | null, episode?: number | null },
  automatic?: AutomaticPlayback,
  context: DiagnosticContext = diagnosticAction(diagnosticContext),
) {
  if (
    fileId === props.mediaFileId
    && (title.season ?? undefined) === season
    && (title.episode ?? undefined) === episode
  ) {
    closePanel()
    return
  }

  if (leaving || !props.titleId)
    return

  leaving = true
  const run = ++launch
  playerSummary(automatic ? 'next' : 'source_switch')
  await save(automatic ? 'next' : 'source_switch', context)
  if (run !== launch)
    return
  void router.replace(
    diagnosticRoute(
      libraryRoute(
        fileId,
        { id: props.titleId, ...title },
        automatic,
        automatic ? heardStudio(tracks.audioTrack.value, undefined) : undefined,
      ),
      context,
    ),
  )
}

function exit() {
  backDiagnostic('exit')
  playerSummary('exit')
  launch++
  leaving = true
  consent.cancel()
  hls.detach()
  player.close()
  save('exit')

  goBack(router, () => void router.replace('/'))
}

function backFromPlayer() {
  if (!sourcePanelReturn || !props.titleId) {
    exit()
    return
  }

  sourcePanelReturn = false
  void router.replace({
    path: router.currentRoute.value.path,
    query: router.currentRoute.value.query,
    state: { sourcePanelReturn: null },
    force: true,
  })
  openPanel('source')
}

function play() {
  video.value?.play().catch(() => {})
}

function toggle() {
  const el = video.value

  if (!el || phase.value !== 'playing')
    return

  if (el.paused)
    play()
  else el.pause()

  osd.show()
}

let pendingSeek:
  | { from: number, to: number, trigger: 'remote' | 'pointer' | 'automatic' }
  | undefined
function onSeeked() {
  if (!pendingSeek)
    return
  diagnostic(
    {
      event: 'playback.seek',
      ...pendingSeek,
      to: Math.max(0, video.value?.currentTime ?? pendingSeek.to),
    },
    diagnosticContext,
  )
  pendingSeek = undefined
}
function seekTo(
  seconds: number,
  trigger: 'remote' | 'pointer' | 'automatic' = 'remote',
) {
  const el = video.value

  if (!el || !Number.isFinite(seconds))
    return

  const target = clampTime(seconds, knownDuration.value)

  pendingSeek = { from: Math.max(0, el.currentTime), to: target, trigger }
  el.currentTime = target
  position.value = target
  fromStart.value = false

  if (target < knownDuration.value - 1)
    ended.value = false
  save()
}

// Кнопка пропадает из-под фокуса: он уходит на таймлайн
function playFromStart() {
  seekTo(0)
  void nextTick(() => focus.activate('player-timeline'))
}

// Левее в панели есть куда шагнуть только по чипам сезонов в «Сериях»
function hasLeftInPanel() {
  const el = focus.current()

  return (
    !!el?.closest('[data-focus-section="player-seasons"]')
    && !!el.previousElementSibling
  )
}

function closePanelFromScreen() {
  backDiagnostic('close_panel')
  closePanel()
}
let trackSelectionGeneration = 0
function closePanel() {
  trackSelectionGeneration++
  librarySelection.value = undefined
  panel.value = null
  focus.activate(
    showsError.value
      ? 'player-prompt'
      : phase.value === 'playing'
        ? 'player-buttons'
        : 'player-back',
  )
  osd.scheduleHide()
}

function onMedia(
  key: Extract<KeyAction, { type: 'media' }>['key'],
  held: boolean,
) {
  if (key === 'stop')
    exit()
  else if (key === 'forward' || key === 'rewind')
    osd.step(key === 'forward' ? 1 : -1, held)
  else if (key === 'play')
    play()
  else if (key === 'pause')
    video.value?.pause()
  else toggle()
}

/**
 * Клавиши плеера раньше движка фокуса: ← → перематывают, когда OSD скрыт или
 * фокус на таймлайне, OK при скрытом OSD — пауза, Back — в два шага.
 */
function onKey(action: KeyAction, event: KeyboardEvent) {
  if (action.type !== 'back')
    resetBack()

  if (qualityChoice.value)
    return false
  if (phase.value !== 'playing' || restarting.value || showsError.value) {
    if (action.type !== 'back')
      return false

    if (panel.value) {
      backDiagnostic('close_panel')
      closePanel()
    }
    else {
      backFromPlayer()
    }
    return true
  }

  // Затемнённая пауза: первое нажатие только возвращает OSD с прежним фокусом.
  // Медиакнопки — явное действие и работают сразу
  if (osd.dimmed.value && action.type !== 'media') {
    if (action.type === 'back')
      backDiagnostic('wake_osd')
    osd.wake()
    return true
  }

  if (action.type === 'back') {
    // Из выбора настройки — к списку, а не из панели
    if (panel.value === 'settings' && settingsPanel.value?.back()) {
      backDiagnostic('settings_step')
      return true
    }

    if (prompt.value === 'skip' && !osd.visible.value) {
      backDiagnostic('dismiss_skip')
      dismissedSkip.value = activeSkip.value!.id
      return true
    }

    if (prompt.value === 'upNext' && !osd.visible.value) {
      backDiagnostic('dismiss_upnext')
      dismissNext('remote')
      return true
    }

    const next = backAction({
      panelOpen: !!panel.value,
      osdVisible: osd.visible.value && !controlsDismissedByBack,
    })

    if (next === 'closePanel') {
      backDiagnostic('close_panel')
      closePanel()
    }
    else if (next === 'hideOsd') {
      backDiagnostic('hide_osd')
      controlsDismissedByBack = true
      osd.hide()
    }
    else {
      backFromPlayer()
    }

    return true
  }

  // Влево из панели, где левее ничего нет, — к фильму: панель закрывается.
  // Источники — экран целиком, а не панель сбоку: их закрывает только Back
  if (
    panel.value
    && panel.value !== 'source'
    && action.type === 'move'
    && action.direction === 'left'
    && !hasLeftInPanel()
  ) {
    // Из шага настройки — сначала к списку, как Back
    if (!(panel.value === 'settings' && settingsPanel.value?.back()))
      closePanel()

    return true
  }

  if (panel.value)
    return false

  if (action.type === 'media') {
    onMedia(action.key, event.repeat)
    osd.show()
    return true
  }

  const hidden = !osd.visible.value
  // Фокус движка, а не DOM: под указкой фокус экрана «тихий», без DOM-фокуса
  const onTimeline = !!focus
    .current()
    ?.closest('[data-focus-section="player-timeline"]')

  if (
    action.type === 'move'
    && (action.direction === 'left' || action.direction === 'right')
  ) {
    if (hidden || onTimeline) {
      osd.step(action.direction === 'right' ? 1 : -1, event.repeat)
      return true
    }
  }

  // Плашка «Следующая серия»: OK — сразу к ней
  if (hidden && action.type === 'enter') {
    if (prompt.value === 'skip')
      skipCurrent()
    else if (prompt.value === 'upNext')
      void playNext()
    else toggle()

    return true
  }

  osd.show()

  // Первое нажатие только показывает OSD
  return hidden
}

async function begin(from: number) {
  const run = launch
  const el = video.value
  const current = playback.value

  if (!el || !current?.streamUrl)
    return

  // Свёрнутое приложение ставит паузу и на остановленном видео, без события
  // `pause`: поток не должен стартовать в фоне
  const stayPaused = keepPaused || document.hidden

  begun = true
  startPausedBy = keepPaused ? 'viewer' : document.hidden ? 'hidden' : null
  keepPaused = false
  clearTimeout(metadataTimer)

  if (stayPaused)
    metadataTimer = setTimeout(onMetadataTimeout, PAUSED_METADATA_MS)

  startAt = from
  // Новая позиция — новый отсчёт докачанного
  downloadedAtStage = null
  held = false
  cancelHold()
  restarting.value = false
  reconnecting.value = false
  // Пауза от остановки прежнего потока снимается: новый играет, и сторож его
  // видит. Зритель был на паузе — новый поток ждёт на ней, как обычная пауза
  paused.value = stayPaused
  phase.value = 'buffering'
  position.value = from
  bufferingSince.value = Date.now()

  // Нативный плеер оболочки сам играет HLS: hls.js ему не нужен
  if (current.mode === 'hls' && !hasNativePlayer) {
    let attached: boolean
    try {
      attached = await hls.attach(el, current.streamUrl, from)
    }
    catch (err) {
      if (run !== launch || leaving || restarting.value)
        return
      throw err
    }
    if (run !== launch || leaving || restarting.value)
      return
    if (!attached) {
      player.fail('unsupported')
      return
    }
  }
  else {
    hls.detach()
    el.src = current.streamUrl
  }

  // Приложение могли свернуть, пока подключался hls.js
  if (stayPaused || paused.value || document.hidden)
    return

  // Свернули и вернули за время подключения: пауза по метаданным устарела
  startPausedBy = null

  // Без жеста пользователя браузер может не дать играть со звуком:
  // тогда видео ждёт на паузе с OSD, OK запускает
  el.play().catch((err: unknown) => {
    if (run !== launch || leaving || restarting.value)
      return
    if (err instanceof Error && err.name === 'NotAllowedError') {
      phase.value = 'playing'
      paused.value = true
      osd.show()
    }
  })
}

function onPromptChoice(choice: 'retry' | 'back') {
  if (choice === 'back') {
    backFromPlayer()
  }
  else {
    holdError()
    budget = freshBudget()
    slow.value = false
    keepPaused = false
    relaunch()
  }
}

// Откуда продолжать: до первых кадров позиция ещё не пришла от видео
function resumeAt() {
  return (
    osd.scrub.value?.target
    ?? (phase.value === 'playing' ? position.value : startAt)
  )
}

// Тот же файл с теми же дорожками с места остановки; до первого потока —
// обычный запуск с сохранённого места
function relaunch() {
  if (begun)
    void restartWith(requested ?? tracks.selection())
  else void start()
}

/** Остановить поток до нового: позиция сохраняется до отключения hls.js */
function holdStream() {
  save()
  // Не снимается при ошибке нового старта: при выходе остаётся позиция,
  // сохранённая выше, а не 0 от отцепленного видео
  restarting.value = true

  if (panel.value)
    closePanel()

  clearTimeout(metadataTimer)
  cancelHold()

  // Прежняя сессия закрывается при перезапуске: hls.js грузил бы её сегменты,
  // получал 404 и ронял экран посреди смены дорожки
  hls.detach()
  video.value?.pause()
}

/**
 * Озвучка или субтитры, которые плеер не переключит сам, и повтор после
 * сбоя: новый поток с этими дорожками с текущего места
 */
async function restartWith(change: PlaybackRestart) {
  if (!restarting.value)
    keepPaused = viewerPaused
  const run = ++launch
  const at = resumeAt()

  requested = change
  reloadArt()
  holdStream()
  const startup = player.start({ ...change, startPosition: at })
  // Проба тоже может ждать пиров: статистика нужна до playback.ready.
  // start() уже сменил generation, поэтому опрос принадлежит новой попытке.
  startStats()
  const outcome = await startup

  if (run !== launch)
    return

  if (outcome === 'ready') {
    requested = undefined
    await begin(at)
  }
  else if (outcome === 'retry') {
    recover()
  }
  else if (outcome === 'error') {
    player.stopStats()
  }
}

/**
 * Сбой на нашей стороне: повтор из бюджета после паузы, а когда бюджет
 * исчерпан — ошибка экрана (`cause`; без неё — ошибка последнего запуска)
 */
function recover(cause?: PlayerError, failure: PlayerFailure = {}) {
  if (
    qualityChoice.value
    || retryTimer !== undefined
    || player.status.value === 'error'
  ) {
    return
  }

  const next = nextRetry(budget, Date.now())

  if (!next) {
    reconnecting.value = false
    failAt(cause, failure)
    return
  }

  budget = next.budget

  // Во время перезапуска видео стоит из-за него, а пауза зрителя уже запомнена
  if (!restarting.value)
    keepPaused = viewerPaused

  holdStream()
  reconnecting.value = true
  retryTimer = setTimeout(() => {
    retryTimer = undefined
    relaunch()
  }, next.delayMs)
}

/**
 * Поток на паузе так и не дал метаданные: сторож на паузе выключен, поэтому
 * это сбой. В свёрнутом приложении проверка откладывается: повтор в фоне
 * тратил бы бюджет, и зритель вернулся бы к ошибке
 */
function onMetadataTimeout() {
  if (qualityChoice.value)
    return
  const el = video.value

  if (document.hidden) {
    metadataTimer = setTimeout(onMetadataTimeout, PAUSED_METADATA_MS)
    return
  }

  metadataTimer = undefined

  if (
    el
    && el.readyState < el.HAVE_METADATA
    && phase.value === 'buffering'
    && !restarting.value
  ) {
    recover('unknown')
  }
}

/**
 * Раз в секунду, пока плеер хочет играть: растёт ли `currentTime`, жива ли
 * статистика движка, есть ли пиры. Решение — `stallAction`.
 */
function watchProgress() {
  const el = video.value
  const at = Date.now()
  const active
    = !!el
      && !qualityChoice.value
      && player.status.value === 'ready'
      && (phase.value === 'buffering' || phase.value === 'playing')
      && !paused.value
      && !restarting.value
      && !holding
      && !osd.scrub.value
      && retryTimer === undefined

  if (!el || !active) {
    armed = false
    playingSince = null
    return
  }

  if (!armed) {
    armed = true
    armedAt = progressAt = peersSince = at
    lastTime = el.currentTime
    return
  }

  if (el.currentTime !== lastTime) {
    lastTime = el.currentTime
    progressAt = at
    playingSince ??= at
    slow.value = false
  }
  else {
    playingSince = null
  }

  budget = settleBudget(budget, playingSince, at)

  const current = stats.value
  const peers = current ? current.peers.connected : null

  if (!peers)
    peersSince = at

  const action = stallAction({
    now: at,
    statsAt: Math.max(player.statsReceivedAt(), armedAt),
    peers,
    aheadSeconds: bufferedSeconds(
      current?.file.bufferedAhead ?? 0,
      playback.value?.size ?? 0,
      knownDuration.value,
    ),
    stuckMs: at - progressAt,
    peersMs: at - peersSince,
    budgetLeft: canRetry(budget, at),
  })

  if (action === 'retry')
    recover('unknown')
  else if (action === 'slow')
    slow.value = true
}

let savingTrack = false
async function onTracksSelect(id: string) {
  if (savingTrack)
    return
  const current = playback.value
  const kind = panel.value
  if (kind !== 'audio' && kind !== 'subtitles')
    return
  const generation = trackSelectionGeneration
  if (current?.media && (props.titleId || props.mediaFileId)) {
    savingTrack = true
    try {
      await api.playback.putPlaybackPreferences(
        current.sessionId,
        kind === 'audio'
          ? { audioStream: Number(id) }
          : { subtitle: id === 'off' ? null : id },
      )
    }
    catch (error) {
      voiceNotice.value = t('player.trackSaveFailed')
      // Older servers have no persistence endpoint; playback still works.
      if (getErrorStatus(error) !== 404)
        return
    }
    finally {
      savingTrack = false
    }
    if (
      leaving
      || generation !== trackSelectionGeneration
      || current !== playback.value
      || kind !== panel.value
    ) {
      return
    }
  }
  if (kind === 'audio')
    tracks.selectAudio(id)
  else tracks.selectSubtitles(id)
  closePanel()
}

function openPanel(kind: Panel) {
  resetBack()
  panel.value = kind
  osd.hold()

  // Источники закрывают фильм целиком: он ждёт на паузе
  if (kind === 'source') {
    const el = video.value
    cancelHold()
    viewerPaused = true
    paused.value = true
    el?.pause()

    // Back доступен ещё до старта: на паузе playing не придёт,
    // поэтому готовый поток выходит из сцены по метаданным.
    if (phase.value === 'starting' || restarting.value) {
      keepPaused = true
    }
    else if (phase.value === 'buffering') {
      startPausedBy = 'viewer'
      clearTimeout(metadataTimer)
      if (el && el.readyState >= el.HAVE_METADATA)
        showPaused()
      else metadataTimer = setTimeout(onMetadataTimeout, PAUSED_METADATA_MS)
    }
  }
}

function onLoadedMetadata() {
  const el = video.value!

  clearTimeout(metadataTimer)
  duration.value = el.duration
  el.defaultPlaybackRate = speed.value
  el.playbackRate = speed.value
  tracks.refresh()

  if (startAt > 0)
    el.currentTime = clampTime(startAt, el.duration)

  if (startPausedBy)
    showPaused()
}

/** Новый поток ждёт на паузе: экран плеера с OSD вместо сцены */
function showPaused() {
  clearTimeout(metadataTimer)
  startPausedBy = null
  paused.value = true
  phase.value = 'playing'
  osd.show()
}

// Действие зрителя на живом потоке: прошлые сбои забыты
function onViewerAction() {
  if (
    streamLive({
      phase: phase.value,
      restarting: restarting.value,
      failed: player.status.value === 'error',
    })
  ) {
    budget = freshBudget()
  }
}

function onPlay() {
  onViewerAction()
  ended.value = false

  // `playing` при пустом буфере может не прийти: сторож должен видеть и
  // такой запуск
  paused.value = false
  viewerPaused = false
}

function onPlaying() {
  const id = playback.value?.sessionId
  if (id && !playedSessions.has(id)) {
    playedSessions.add(id)
    diagnostic(
      {
        event: 'playback.playing',
        session: id,
        mode: diagnosticPlaybackMode(playback.value),
        position: Math.max(0, position.value),
        width: video.value?.videoWidth,
        height: video.value?.videoHeight,
      },
      diagnosticContext,
      true,
    )
  }
  if (holding)
    return

  if (pendingVoiceNotice) {
    voiceNotice.value = pendingVoiceNotice
    pendingVoiceNotice = ''
  }

  if (phase.value !== 'playing') {
    const hold = held
      ? 0
      : loaderHoldMs(loaderSince, performance.now(), {
          delay: loaderDelay,
          minVisible: STAGE_MIN_VISIBLE_MS,
        })

    if (hold > 0) {
      holdStage(hold)
      return
    }

    // Сцена растворяется в видео; таймлайн — только вместе с OSD, и на старте
    // с начала его нет
    phase.value = 'playing'
    osdAfterStage = startAt > 0
  }

  stalled.value = false
  paused.value = false
  viewerPaused = false
  osd.scheduleHide()
}

function onWaiting() {
  if (phase.value === 'playing')
    stalled.value = true
}

function onPause() {
  if (holding)
    return

  // Паузу при перезапуске ставит сам плеер, конец файла ставит её перед
  // `ended` — ранний `ended` это обрыв, а браузер — при ошибке источника:
  // ни то, ни другое не пауза зрителя, и повтор не должен стартовать на паузе
  if (!restarting.value && !video.value?.error) {
    viewerPaused = !video.value?.ended

    if (viewerPaused)
      onViewerAction()
  }

  paused.value = true
  osd.show()
  save('pause')
}

function onTimeUpdate() {
  const el = video.value!

  // До метаданных `currentTime` нового потока — 0, а не позиция
  if (
    el.readyState < el.HAVE_METADATA
    || !videoTimePolicy({ phase: phase.value, restarting: restarting.value }).track
  ) {
    return
  }

  position.value = el.currentTime

  if (Math.abs(el.currentTime - savedAt) >= SAVE_EVERY_S) {
    savedAt = el.currentTime
    save()
  }
}

// Код 2 — сеть (движок упал, поток оборвался), остальное — ошибка медиа.
// При перезапуске прежний поток обрывается намеренно
function onError() {
  if (restarting.value)
    return

  clearTimeout(metadataTimer)

  const error = video.value?.error
  diagnosticError(
    hasNativePlayer ? 'native' : 'media',
    undefined,
    error?.code === 1
      ? 'media_aborted'
      : error?.code === 2
        ? 'media_network'
        : error?.code === 3
          ? 'media_decode'
          : error?.code === 4
            ? 'media_source'
            : 'unknown',
    { ...diagnosticContext, session: playback.value?.sessionId },
  )

  if (error?.code === 2)
    recover('unknown')
  else void onMediaFailure({ mediaError: error?.code, detail: error?.message })
}

/** Плеер не разобрал данные: повтор или ошибка — по `mediaFailureAction` */
async function onMediaFailure(failure: PlayerFailure) {
  const attempt = launch
  const size = playback.value?.size ?? 0
  const offset = byteOffset(
    phase.value === 'playing' ? position.value : startAt,
    size,
    knownDuration.value,
  )
  const fresh = await player.freshStats(offset)

  if (attempt !== launch || restarting.value || player.status.value === 'error')
    return

  const { action, cause } = mediaFailureAction({
    badPieces: fresh?.badPieces ?? 0,
    bufferedAhead: fresh?.file.bufferedAhead ?? 0,
    remaining: size - offset,
  })

  if (action === 'retry')
    recover(cause, failure)
  else failAt(cause, failure)
}

/** Ошибка экрана с позицией: сервер запишет, на какой секунде встало */
function failAt(kind: PlayerError | undefined, failure: PlayerFailure) {
  diagnostic(
    {
      event: 'playback.error',
      session: playback.value?.sessionId,
      outcome: 'failed',
      position: Math.max(0, position.value),
    },
    diagnosticContext,
    true,
  )
  player.fail(kind, { ...failure, position: position.value })
}

// Старые ТВ на обрыв прямого потока отвечают не ошибкой, а концом файла.
// Настоящий конец серии — переход к следующей или пауза с OSD и плашкой
function onEnded() {
  const el = video.value

  if (restarting.value || !el)
    return

  if (endedEarly(el.currentTime, el.duration, knownDuration.value)) {
    recover('unknown')
    return
  }

  ended.value = true

  if (upNext.value && playerSettings.value.autoNext && !upNextDismissed.value)
    void playNext('ended')
  else osd.show()
}

let pointer: { x: number, y: number } | undefined

function onPointer(event: MouseEvent) {
  if (event.type === 'click')
    resetBack()

  // Chromium может прислать mousemove после скрытия OSD без движения указки.
  // Такое событие не должно снова показать управление и перехватить следующий Back.
  if (event.type === 'mousemove') {
    const moved
      = !pointer || pointer.x !== event.screenX || pointer.y !== event.screenY

    pointer = { x: event.screenX, y: event.screenY }

    if (!moved)
      return
  }

  if (phase.value !== 'playing' || restarting.value || showsError.value) {
    return
  }

  // Клик по затемнённой паузе, как и клавиша, только возвращает OSD
  if (osd.dimmed.value) {
    osd.wake()
    return
  }

  osd.show()

  const target = event.target as Element | null

  if (
    event.type === 'click'
    && !panel.value
    && !target?.closest('[data-focusable]')
  ) {
    toggle()
  }
}

function onVisibility() {
  const el = video.value

  if (!document.hidden) {
    // Свернули до метаданных: на паузе они могли так и не прийти, и сцена с
    // лоадером осталась бы навсегда. Поток стартует заново, сторож его видит.
    // Пауза зрителя остаётся: её стережёт таймер метаданных
    if (
      el
      && phase.value === 'buffering'
      && !restarting.value
      && startPausedBy === 'hidden'
      && el.readyState < el.HAVE_METADATA
    ) {
      clearTimeout(metadataTimer)
      startPausedBy = null
      paused.value = false
      play()
    }

    return
  }

  cancelHold()
  onViewerAction()
  el?.pause()

  // На паузе `playing` не придёт: без этого после возврата осталась бы сцена
  // с лоадером. Метаданные уже есть — сразу пауза с OSD, нет — по ним
  if (phase.value === 'buffering' && !restarting.value) {
    startPausedBy ??= 'hidden'
    paused.value = true

    if (el && el.readyState >= el.HAVE_METADATA)
      showPaused()
  }
}

function startStats() {
  player.pollStats(() => ({
    offset: byteOffset(
      phase.value === 'playing' ? position.value : startAt,
      playback.value?.size ?? 0,
      knownDuration.value,
    ),
    intervalMs: phase.value === 'playing' && !stalled.value ? 2000 : 1000,
  }))
}

const qualityOptions = computed(() => [
  {
    id: 'watch',
    label: t('player.quality.watch', { quality: qualityChoice.value?.quality }),
    selected: false,
  },
  { id: 'sources', label: t('player.quality.sources'), selected: false },
  { id: 'back', label: t('player.back'), selected: false },
])
function chooseQuality(choice: string) {
  const pending = qualityChoice.value
  if (!pending || pending.run !== launch || leaving)
    return
  if (choice === 'watch') {
    consent.accept()
  }
  else if (choice === 'sources' && props.titleId) {
    diagnostic(
      {
        event: 'continuation.consent',
        outcome: 'sources',
        generation: pending.run,
      },
      diagnosticContext,
      true,
    )
    launch++
    leaving = true
    consent.cancel()
    player.close()
    void router.replace({
      path: `/title/${props.titleId}/sources`,
      query: { season: props.season, episode: props.episode },
    })
  }
  else {
    diagnostic(
      {
        event: 'continuation.consent',
        outcome: 'exit',
        generation: pending.run,
      },
      diagnosticContext,
      true,
    )
    exit()
  }
}

async function start() {
  resetBack()
  const run = ++launch

  phase.value = 'starting'
  // Каждый запуск и повтор заодно перезапрашивает тайтл, сорвавшийся вместе
  // с сервером: иначе сцена так и осталась бы без кадра и названия
  reloadArt()
  let continuation: Continuation | undefined
  if (props.automatic && props.titleId && props.season && props.episode) {
    const progress = await api.titles
      .getTitleProgress(props.titleId, {
        language: language.value,
        season: props.season,
        episode: props.episode,
      })
      .catch(() => undefined)
    continuation = progress?.continuation
  }
  if (run !== launch || leaving)
    return
  const startup = player.start(
    returnedPlayback
      ? { startPosition: returnedPlayback.position }
      : props.start === '0'
        ? { startPosition: 0 }
        : undefined,
  )
  startStats()
  const outcome = await startup

  if (run !== launch || leaving)
    return

  if (outcome === 'retry')
    recover()

  if (outcome !== 'ready') {
    if (outcome === 'error')
      player.stopStats()
    return
  }

  // Сервер не даёт позицию в самом начале и в хвосте файла: там с начала
  const from
    = returnedPlayback?.position
      ?? (props.start === '0' ? 0 : (playback.value?.startPosition ?? 0))

  fromStart.value = from > 0
  diagnostic(
    {
      event: 'continuation.consent',
      outcome: props.automatic ? 'quality_checked' : 'manual',
      generation: run,
      baselineHeight:
        continuationBaseline(continuation, props.automatic?.current)?.video?.height ?? undefined,
      candidateHeight: playback.value?.media?.video?.height ?? undefined,
    },
    diagnosticContext,
  )
  const qualityCheck = props.automatic
    ? continuationQualityCheck(
        continuationBaseline(continuation, props.automatic.current),
        playback.value?.media?.video,
        props.mediaFileId
          ? { kind: 'library', mediaFileId: props.mediaFileId }
          : {
              kind: 'torrent',
              torrentId: props.torrentId!,
              fileIndex: Number(props.fileIndex),
            },
      )
    : { quality: null, outcome: 'manual' as const }
  diagnostic(
    {
      event: 'continuation.consent',
      outcome: qualityCheck.outcome,
      generation: run,
    },
    diagnosticContext,
  )
  if (
    !(await consent.confirm(qualityCheck.quality, run))
    || run !== launch
    || leaving
  ) {
    return
  }
  pendingVoiceNotice = playback.value?.preferenceMismatch?.length
    ? t('player.trackUnavailable')
    : playback.value?.preferenceMismatch === undefined
      && props.automatic
      && unconfirmedStudio(props.voice, playback.value)
      ? t('player.voiceUnconfirmed', { studio: props.voice })
      : ''
  void begin(from)
}

let detachNative: (() => void) | undefined

onMounted(() => {
  if (returnedPlayback) {
    void router.replace({
      path: router.currentRoute.value.path,
      query: router.currentRoute.value.query,
      state: { resumePlayback: null },
      force: true,
    })
  }
  if (hasNativePlayer && video.value)
    detachNative = attachNativeVideo(video.value)

  offKey = focus.onKey(onKey)
  clockTimer = setInterval(() => {
    now.value = new Date()
    watchProgress()
  }, 1000)
  document.addEventListener('visibilitychange', onVisibility)
  void start()
})

onBeforeUnmount(() => {
  leaving = true
  stopDiagnosticMedia()
  playerSummary('unmounted')
  consent.cancel()
  save()
  offKey?.()
  clearInterval(clockTimer)
  clearTimeout(retryTimer)
  clearTimeout(retryHoldTimer)
  clearTimeout(metadataTimer)
  clearTimeout(holdTimer)
  launch++
  document.removeEventListener('visibilitychange', onVisibility)
  player.stopStats()

  // Без этого браузер держит соединение с потоком, и движок качает дальше под позицией
  const el = video.value

  hls.detach()

  if (el) {
    el.removeAttribute('src')
    el.load()
  }

  detachNative?.()
})
</script>

<template>
  <main
    class="player"
    @mousemove="onPointer"
    @click.capture="resetBack"
    @click="onPointer"
  >
    <video
      ref="video"
      class="player__video"
      preload="auto"
      @loadedmetadata="onLoadedMetadata"
      @play="onPlay"
      @playing="onPlaying"
      @seeked="onSeeked"
      @waiting="onWaiting"
      @pause="onPause"
      @timeupdate="onTimeUpdate"
      @error="onError"
      @ended="onEnded"
    />

    <!--
      До первого кадра и при ошибке — одна сцена: фон и шапка не перерисовываются
      между фазами. В видео сцена уходит растворением
    -->
    <Transition name="player-stage" @after-leave="onStageGone">
      <PlayerStage
        v-if="showsStage"
        :style="instantLoader ? { '--loader-delay': '0ms' } : undefined"
        :title="stageTitle"
        :backdrop="art?.backdrop"
        :logo="art?.logo"
        :subtitle="artSubtitle"
      >
        <PlayerPrompt
          v-if="showsError"
          :title="promptError.title"
          :text="promptError.text"
          :busy="
            heldError && player.status.value === 'loading' ? 'retry' : undefined
          "
          :rejections="retryRejections"
          :actions="[
            { id: 'retry', label: t('player.retry') },
            { id: 'back', label: t('player.back') },
          ]"
          @choose="onPromptChoice"
        />

        <template v-else-if="showsLoader">
          <PlayerLamp
            :step="stageStep"
            :connected="stageStats?.peers.connected ?? 0"
            :progress="stageProgress"
          />
          <PlayerBuffering
            :step="stageStep"
            :stats="stageStats"
            :progress="stageProgress"
          />
        </template>
      </PlayerStage>
    </Transition>

    <SourcesScreen
      v-if="panel === 'source' && titleId"
      :id="titleId"
      class="player__sources"
      :playing="{
        season,
        episode,
        library: isLibrary,
        mediaFileId,
        torrentId,
      }"
      @select="switchSource"
      @library="switchToLibrary"
      @back="closePanelFromScreen"
    />

    <template
      v-if="playback && phase === 'playing' && !restarting && !showsError"
    >
      <p v-if="stalled" class="player__stall" role="status">
        <span class="player__spinner" aria-hidden="true" />
        {{ t(slow ? "player.steps.slow" : "player.steps.buffering")
        }}<template v-if="shownStats">
          · {{ t("player.peers", shownStats.peers.connected) }}
        </template>
      </p>

      <PlayerOsd
        :visible="osd.visible.value"
        :title="stageTitle"
        :subtitle="artSubtitle || playback.fileName"
        :position="position"
        :duration="knownDuration"
        :buffer-end="position + bufferSeconds"
        :scrub-target="osd.scrub.value?.target ?? null"
        :paused="paused"
        :stats="osdStats"
        :buffer-seconds="bufferSeconds"
        :now="now"
        :audio-label="tracks.audioLabel.value"
        :subtitles-label="tracks.subtitlesLabel.value"
        :from-start="fromStart"
        :titled="!!titleId && (!lacksSources() || hasLibraryVersions)"
        :series="!!(titleId && season && episode)"
        :source-label="tracks.caption.value ?? ''"
        :has-next="!!upNext"
        :skip-label="skipLabel"
        @skip="skipCurrent"
        @toggle="toggle"
        @seek="seekTo($event * knownDuration, 'pointer')"
        @tracks="openPanel"
        @panel="openPanel"
        @next="playNext('OSD_next')"
        @from-start="playFromStart"
      />

      <PlayerSkip
        v-if="prompt === 'skip' && !osd.visible.value"
        :label="skipLabel!"
        @skip="skipCurrent"
      />
      <PlayerUpNext
        v-if="prompt === 'upNext' && upNext"
        :code="episodeCode(upNext.season, upNext.episode)"
        :title="upNext.title"
        :still="upNext.still"
        :countdown="visibleUpNextCountdown"
        :elapsed="upNextElapsed"
        @play="playNext('pointer')"
        @cancel="dismissNext(activationTrigger())"
      />

      <PlayerTracks
        v-if="panel === 'audio' || panel === 'subtitles'"
        :kind="panel"
        :options="trackOptions"
        :caption="tracks.caption.value"
        @select="onTracksSelect"
        @close="closePanelFromScreen"
      />
      <PlayerEpisodes
        v-else-if="panel === 'episodes' && titleId && season && episode"
        :title-id="titleId"
        :seasons="art?.seasons ?? []"
        :season="season"
        :episode="episode"
        :torrent-id="torrentId"
        @select="switchTo"
        @close="closePanelFromScreen"
      />
      <LibraryVersionPicker
        v-else-if="panel === 'versions' && librarySelection"
        :files="librarySelection.files"
        :current-id="librarySelection.currentId"
        @select="libraryPicker.select"
        @close="closeLibraryPicker"
      />
      <PlayerSettings
        v-else-if="panel === 'settings'"
        ref="settingsPanel"
        :speed="speed"
        :settings="playerSettings"
        :link="externalLink"
        @speed="speed = $event"
        @update="updatePlayerSettings"
        @close="closePanelFromScreen"
      />
    </template>

    <p
      v-if="phase === 'playing' && tracks.subtitleHtml.value"
      class="player__subtitles"
      :class="[
        `player__subtitles--${playerSettings.subtitleSize}`,
        `player__subtitles--${playerSettings.subtitleBackground}`,
        { 'player__subtitles--lifted': osd.visible.value },
      ]"
    >
      <!-- Разметку реплики чистит subtitleHtml: остаются только i, b, u -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span class="player__cue" v-html="tracks.subtitleHtml.value" />
    </p>

    <PlayerPauseScreen
      v-if="playback && phase === 'playing' && !showsError"
      :visible="osd.dimmed.value"
      :title="stageTitle"
      :logo="art?.logo"
      :subtitle="artSubtitle"
      :overview="episodeOverview || art?.overview || ''"
    />

    <FocusSection
      name="player-back"
      class="player__back-section"
      :class="{ 'player__back-section--visible': backVisible && !panel }"
      :edges="{ down: 'player-timeline' }"
      manual-scroll
    >
      <button
        v-focusable
        class="player__back"
        type="button"
        @click="backFromPlayer"
      >
        <AppIcon name="chevronLeft" />
        <span class="player__back-label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>
  </main>
  <OptionsPanel
    v-if="qualityChoice"
    :title="t('player.quality.title')"
    :subtitle="t('player.quality.text')"
    :options="qualityOptions"
    @select="chooseQuality"
    @close="exit"
  />
  <AppToast :message="voiceNotice" @hide="voiceNotice = ''" />
</template>

<style scoped>
.player {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: #000000;
}

.player__video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000000;
}

/* Нативный плеер Android TV рисует кадр под страницей. Сам <video> без
   источника WebView закрыл бы серым постером — он только принимает события */
:global(.native-video .player) {
  background: transparent;
}

:global(.native-video .player__video) {
  visibility: hidden;
}

/* Сцена растворяется над уже идущим видео: анимируется только её opacity,
   само видео не трогаем — на ТВ оно бывает отдельным аппаратным слоем */
.player-stage-leave-active {
  transition: opacity 400ms var(--motion-easing);
  pointer-events: none;
}

.player-stage-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .player-stage-leave-active {
    transition: none;
  }
}

/* Короткая подгрузка после перемотки плашкой не мелькает: видна через
   --loader-delay, как лоадеры; анимируется только opacity — transform центрирует */
.player__stall {
  opacity: 0;
  animation: player-stall-appear var(--motion-fast) var(--motion-easing) var(--loader-delay) forwards;
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  margin: 0;
  padding: calc(var(--u) * 14) calc(var(--u) * 28);
  border-radius: calc(var(--u) * 32);
  background: rgba(0, 0, 0, 0.6);
  font-size: var(--font-size-s);
  transform: translate(-50%, -50%);
}

@keyframes player-stall-appear {
  to {
    opacity: 1;
  }
}

.player__spinner {
  width: calc(var(--u) * 24);
  height: calc(var(--u) * 24);
  margin-right: calc(var(--u) * 14);
  border: calc(var(--u) * 4) solid var(--color-line);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: player-spin 900ms linear infinite;
}

/* Источники — экран целиком поверх фильма, субтитров и кнопки «Назад» */
.player__sources {
  z-index: 10;
}

.player__subtitles {
  position: absolute;
  right: var(--safe-x);
  bottom: calc(var(--u) * 110);
  left: var(--safe-x);
  margin: 0;
  text-align: center;
  pointer-events: none;
  transition: transform var(--motion-base) var(--motion-easing);
}

/* С OSD реплика поднимается над таймлайном и кнопками */
.player__subtitles--lifted {
  transform: translateY(calc(var(--u) * -230));
}

.player__cue {
  padding: calc(var(--u) * 4) calc(var(--u) * 16);
  border-radius: calc(var(--u) * 8);
  font-size: calc(var(--u) * 46);
  font-weight: 600;
  line-height: 1.45;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* Размер и подложка субтитров — из настроек профиля */
.player__subtitles--s .player__cue {
  font-size: calc(var(--u) * 38);
}

.player__subtitles--l .player__cue {
  font-size: calc(var(--u) * 58);
}

.player__subtitles--box .player__cue {
  background: rgba(0, 0, 0, 0.55);
}

.player__subtitles--shadow .player__cue {
  text-shadow:
    0 0 calc(var(--u) * 4) #000000,
    0 calc(var(--u) * 2) calc(var(--u) * 6) rgba(0, 0, 0, 0.9);
}

/* «Назад» появляется и прячется вместе с OSD */
.player__back-section {
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion-base) var(--motion-easing);
}

.player__back-section--visible {
  opacity: 1;
  pointer-events: auto;
}

.player__back {
  position: absolute;
  z-index: 5;
  top: var(--safe-y);
  left: calc(var(--u) * 28);
  display: flex;
  align-items: center;
  height: calc(var(--u) * 64);
  padding: 0 calc(var(--u) * 26) 0 calc(var(--u) * 18);
  border: 0;
  border-radius: calc(var(--u) * 32);
  background: var(--color-glass);
  color: var(--color-text);
  font: inherit;
  font-size: calc(var(--u) * 32);
}

.player__back:focus {
  --bump-scale: var(--focus-scale);

  background: var(--color-focus);
  color: var(--color-bg);
}

.player__back:focus {
  transform: scale(var(--bump-scale));
}

.player__back-label {
  margin-left: calc(var(--u) * 10);
  font-size: var(--font-size-s);
  font-weight: 600;
}

@keyframes player-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
