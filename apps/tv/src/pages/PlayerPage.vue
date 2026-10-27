<script setup lang="ts">
import type { LibraryFile, SourceCandidate, UpNext } from '@torsher/api-client'
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
import PlayerOsd from '../components/player/PlayerOsd.vue'
import PlayerPauseScreen from '../components/player/PlayerPauseScreen.vue'
import PlayerPrompt from '../components/player/PlayerPrompt.vue'
import PlayerStage from '../components/player/PlayerStage.vue'
import AppIcon from '../components/AppIcon.vue'
import FocusSection from '../components/FocusSection.vue'
import SourcesScreen from '../components/SourcesScreen.vue'
import type { SourceChoice } from '../components/SourcesScreen.vue'
import PlayerEpisodes from '../components/player/PlayerEpisodes.vue'
import PlayerSettings from '../components/player/PlayerSettings.vue'
import PlayerTracks from '../components/player/PlayerTracks.vue'
import PlayerUpNext from '../components/player/PlayerUpNext.vue'
import type {
  PlaybackRestart,
  PlayerError,
} from '../composables/usePlayback.ts'
import { api } from '../api.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useHls } from '../composables/useHls.ts'
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
  formatGigabytes,
  freshBudget,
  nextRetry,
  PAUSED_METADATA_MS,
  settleBudget,
  stallAction,
  streamLive,
  UP_NEXT_SECONDS,
  upNextVisible,
  videoTimePolicy,
} from '../lib/player.ts'
import {
  episodeCode,
  libraryRoute,
  playerRoute,
  resolveRoute,
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
import { heardStudio } from '../lib/tracks.ts'
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
  // Озвучка, которую слушали в прошлой раздаче: после смены раздачи
  voice?: string
}>()

// Позиция сохраняется по ходу просмотра, а не только на выходе: ТВ могут выключить
const SAVE_EVERY_S = 10

const { t, locale } = useI18n()
const router = useRouter()
const focus = useFocus()
const isLibrary = !!props.mediaFileId
const player = usePlayback(
  props.mediaFileId
    ? { mediaFileId: props.mediaFileId }
    : { torrentId: props.torrentId!, fileIndex: Number(props.fileIndex) },
  titleRefOf(props.titleId, props.season, props.episode),
  props.voice,
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
  return libraryFiles.value.find(
    file =>
      file.season === season
      && file.episode !== null
      && episode >= file.episode
      && episode <= (file.episodeTo ?? file.episode),
  )
}

// Экран подготовки: кадр, логотип и серия тайтла — если плеер открыт из карточки
const season = props.season ? Number(props.season) : undefined
const episode = props.episode ? Number(props.episode) : undefined
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
// Ошибка сети — повтор; разбор сегментов не удался — формат не по силам плееру
const hls = useHls((kind) => {
  if (kind === 'network')
    recover('unknown')
  else player.fail(kind === 'media' ? 'unsupported' : 'unknown')
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
const duration = ref(Number.NaN)
type Panel = 'audio' | 'subtitles' | 'episodes' | 'source' | 'settings'

const panel = ref<Panel | null>(null)
const settingsPanel = ref<InstanceType<typeof PlayerSettings>>()
const now = ref(new Date())
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
let viewerPaused = false
// Поток оборвался на паузе зрителя: новый ждёт на той же паузе
let keepPaused = false
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

// Смена дорожки, которую плеер не переключит сам, перезапускает поток
const tracksHint = computed(() => {
  if (panel.value === 'audio' && playback.value?.audioSwitch === 'restart')
    return t('player.restartHint')

  if (panel.value === 'subtitles' && tracks.hasBurnIn.value)
    return t('player.burnInHint')

  return undefined
})

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

if (props.titleId && season && episode) {
  api.titles
    .getTitleUpNext(props.titleId, {
      season: String(season),
      episode: String(episode),
      torrentId: props.torrentId,
      language: language.value,
    })
    .then((result) => {
      nextAired.value = result.next
    })
    .catch(() => {
      // Без ответа плашки нет: серию можно выбрать в «Сериях»
    })
}

const remaining = computed(() => knownDuration.value - position.value)

const errorKey = computed(() => {
  if (player.error.value === 'engine')
    return `player.errors.engine.${player.engineKind.value ?? 'starting'}`

  if (player.error.value === 'storage')
    return `player.errors.storage.${player.storage.value?.kind ?? 'no_space'}`

  return `player.errors.${player.error.value ?? 'unknown'}`
})

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
    }),
)

// Без автоперехода отсчёта нет: плашка ждёт OK
const upNextCountdown = computed(() => {
  if (!playerSettings.value.autoNext)
    return null

  return ended.value ? 0 : countdownOf(remaining.value)
})

const upNextElapsed = computed(() =>
  Math.min(1, Math.max(0, 1 - remaining.value / UP_NEXT_SECONDS)),
)

// Отсчёт дошёл до нуля — переход, даже если `ended` не придёт: старые ТВ на
// прямом потоке кончают файл не всегда
watch(upNextCountdown, (value) => {
  if (value === 0 && showsUpNext.value && !paused.value)
    void playNext()
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
const showsLoader = computed(() => showsStage.value && !showsError.value)
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
  if (!showsStage.value)
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

function save() {
  if (
    videoTimePolicy({ phase: phase.value, restarting: restarting.value }).save
  ) {
    return player.saveWatchState(
      osd.scrub.value?.target ?? position.value,
      knownDuration.value,
    )
  }

  return Promise.resolve()
}

/**
 * Другая серия, не выходя из плеера: позиция этой сохраняется до перехода,
 * иначе новый запуск прочитал бы старую. Файл в этой раздаче — сразу плеер,
 * иначе экран подготовки ищет раздачу с той же озвучкой
 */
async function switchTo(target: {
  season: number
  episode: number
  fileIndex?: number
}) {
  if (leaving || !props.titleId)
    return

  leaving = true
  await save()

  const title = {
    id: props.titleId,
    season: target.season,
    episode: target.episode,
  }
  const next = upNext.value
  // Файл библиотеки — следующую серию тоже берём из библиотеки, если она там
  const own = isLibrary
    ? libraryFileOf(target.season, target.episode)
    : undefined

  if (own) {
    void router.replace(libraryRoute(own.id, title))
    return
  }

  const file
    = target.fileIndex !== undefined && props.torrentId
      ? { torrentId: props.torrentId, fileIndex: target.fileIndex }
      : next?.season === target.season && next.episode === target.episode
        ? next.file
        : null

  void router.replace(
    file
      ? playerRoute(file, title)
      : resolveRoute(
          props.titleId,
          target.season,
          target.episode,
          props.torrentId,
        ),
  )
}

function playNext() {
  if (upNext.value)
    return switchTo(upNext.value)
}

/**
 * Другая раздача той же серии: позиция серии сохранится и продолжится в ней,
 * озвучка — та, что слышно сейчас, если она там есть
 */
async function switchSource(candidate: SourceCandidate, choice: SourceChoice) {
  if (candidate.lastWatched && !isLibrary) {
    closePanel()
    return
  }

  if (leaving || !props.titleId)
    return

  leaving = true
  await save()
  void router.replace({
    path: `/title/${props.titleId}/play`,
    query: {
      season: props.season,
      episode: props.episode,
      candidate: candidate.id,
      voice: heardStudio(tracks.audioTrack.value, choice.playingVoice),
    },
  })
}

// Строка «В библиотеке» экрана источников: файл этой серии с диска
async function switchToLibrary(
  fileId: string,
  title: { season?: number | null, episode?: number | null },
) {
  if (isLibrary) {
    closePanel()
    return
  }

  if (leaving || !props.titleId)
    return

  leaving = true
  await save()
  void router.replace(libraryRoute(fileId, { id: props.titleId, ...title }))
}

function exit() {
  save()

  goBack(router, () => void router.replace('/'))
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

function seekTo(seconds: number) {
  const el = video.value

  if (!el || !Number.isFinite(seconds))
    return

  const target = clampTime(seconds, knownDuration.value)

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

function closePanel() {
  panel.value = null
  focus.activate('player-buttons')
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
  if (phase.value !== 'playing' || restarting.value || showsError.value) {
    if (action.type !== 'back')
      return false

    exit()
    return true
  }

  // Затемнённая пауза: первое нажатие только возвращает OSD с прежним фокусом.
  // Медиакнопки — явное действие и работают сразу
  if (osd.dimmed.value && action.type !== 'media') {
    osd.wake()
    return true
  }

  if (action.type === 'back') {
    // Из выбора настройки — к списку, а не из панели
    if (panel.value === 'settings' && settingsPanel.value?.back())
      return true

    if (showsUpNext.value && !osd.visible.value) {
      upNextDismissed.value = true
      return true
    }

    const next = backAction({
      panelOpen: !!panel.value,
      osdVisible: osd.visible.value,
    })

    if (next === 'closePanel')
      closePanel()
    else if (next === 'hideOsd')
      osd.hide()
    else exit()

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
    if (showsUpNext.value)
      void playNext()
    else toggle()

    return true
  }

  osd.show()

  // Первое нажатие только показывает OSD
  return hidden
}

async function begin(from: number) {
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
    if (!(await hls.attach(el, current.streamUrl, from))) {
      player.fail('unsupported')
      return
    }
  }
  else {
    hls.detach()
    el.src = current.streamUrl
  }

  // Приложение могли свернуть, пока подключался hls.js
  if (stayPaused || document.hidden)
    return

  // Свернули и вернули за время подключения: пауза по метаданным устарела
  startPausedBy = null

  // Без жеста пользователя браузер может не дать играть со звуком:
  // тогда видео ждёт на паузе с OSD, OK запускает
  el.play().catch((err: unknown) => {
    if (err instanceof Error && err.name === 'NotAllowedError') {
      phase.value = 'playing'
      paused.value = true
      osd.show()
    }
  })
}

function onPromptChoice(choice: 'retry' | 'back') {
  if (choice === 'back') {
    exit()
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
  const run = ++launch
  const at = resumeAt()

  requested = change
  reloadArt()
  holdStream()
  const outcome = await player.start({ ...change, startPosition: at })

  if (run !== launch)
    return

  if (outcome === 'ready') {
    requested = undefined
    startStats()
    await begin(at)
  }
  else if (outcome === 'retry') {
    recover()
  }
}

/**
 * Сбой на нашей стороне: повтор из бюджета после паузы, а когда бюджет
 * исчерпан — ошибка экрана (`cause`; без неё — ошибка последнего запуска)
 */
function recover(cause?: PlayerError) {
  if (retryTimer !== undefined || player.status.value === 'error')
    return

  const next = nextRetry(budget, Date.now())

  if (!next) {
    reconnecting.value = false
    player.fail(cause)
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

function onTracksSelect(id: string) {
  if (panel.value === 'audio')
    tracks.selectAudio(id)
  else tracks.selectSubtitles(id)

  closePanel()
}

function openPanel(kind: Panel) {
  panel.value = kind
  osd.hold()

  // Источники закрывают фильм целиком: он ждёт на паузе
  if (kind === 'source')
    video.value?.pause()
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
  if (holding)
    return

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

  // Паузу при перезапуске ставит сам плеер, а конец файла ставит её перед
  // `ended` — ранний `ended` это обрыв, а не пауза зрителя
  if (!restarting.value) {
    viewerPaused = !video.value?.ended

    if (viewerPaused)
      onViewerAction()
  }

  paused.value = true
  osd.show()
  save()
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

// Код 2 — сеть (движок упал, поток оборвался), остальное — формат не по
// силам плееру. При перезапуске прежний поток обрывается намеренно
function onError() {
  if (restarting.value)
    return

  clearTimeout(metadataTimer)

  if (video.value?.error?.code === 2)
    recover('unknown')
  else player.fail('unsupported')
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
    void playNext()
  else osd.show()
}

function onPointer(event: MouseEvent) {
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

async function start() {
  const run = ++launch

  phase.value = 'starting'
  // Каждый запуск и повтор заодно перезапрашивает тайтл, сорвавшийся вместе
  // с сервером: иначе сцена так и осталась бы без кадра и названия
  reloadArt()
  const outcome = await player.start()

  if (run !== launch)
    return

  if (outcome === 'retry')
    recover()

  if (outcome !== 'ready')
    return

  startStats()

  // Сервер не даёт позицию в самом начале и в хвосте файла: там с начала
  const from = playback.value?.startPosition ?? 0

  fromStart.value = from > 0
  void begin(from)
}

let detachNative: (() => void) | undefined

onMounted(() => {
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
  <main class="player" @mousemove="onPointer" @click="onPointer">
    <video
      ref="video"
      class="player__video"
      preload="auto"
      @loadedmetadata="onLoadedMetadata"
      @play="onPlay"
      @playing="onPlaying"
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

        <template v-else>
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
        :stats="shownStats"
        :buffer-seconds="bufferSeconds"
        :now="now"
        :audio-label="tracks.audioLabel.value"
        :subtitles-label="tracks.subtitlesLabel.value"
        :from-start="fromStart"
        :titled="!!titleId && !lacksSources()"
        :series="!!(titleId && season && episode)"
        :source-label="tracks.caption.value ?? ''"
        :has-next="!!upNext"
        @toggle="toggle"
        @seek="seekTo($event * knownDuration)"
        @tracks="openPanel"
        @panel="openPanel"
        @next="playNext"
        @from-start="playFromStart"
      />

      <PlayerUpNext
        v-if="showsUpNext && upNext"
        :code="episodeCode(upNext.season, upNext.episode)"
        :title="upNext.title"
        :still="upNext.still"
        :countdown="upNextCountdown"
        :elapsed="upNextElapsed"
        @play="playNext"
        @cancel="upNextDismissed = true"
      />

      <PlayerTracks
        v-if="panel === 'audio' || panel === 'subtitles'"
        :kind="panel"
        :options="trackOptions"
        :caption="tracks.caption.value"
        :hint="tracksHint"
        @select="onTracksSelect"
        @close="closePanel"
      />
      <PlayerEpisodes
        v-else-if="panel === 'episodes' && titleId && season && episode"
        :title-id="titleId"
        :seasons="art?.seasons ?? []"
        :season="season"
        :episode="episode"
        :torrent-id="torrentId"
        @select="switchTo"
        @close="closePanel"
      />
      <SourcesScreen
        v-else-if="panel === 'source' && titleId"
        :id="titleId"
        class="player__sources"
        :playing="{ season, episode, library: isLibrary }"
        @select="switchSource"
        @library="switchToLibrary"
        @back="closePanel"
      />
      <PlayerSettings
        v-else-if="panel === 'settings'"
        ref="settingsPanel"
        :speed="speed"
        :settings="playerSettings"
        :link="externalLink"
        @speed="speed = $event"
        @update="updatePlayerSettings"
        @close="closePanel"
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
      <button v-focusable class="player__back" type="button" @click="exit">
        <AppIcon name="chevronLeft" />
        <span class="player__back-label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>
  </main>
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
