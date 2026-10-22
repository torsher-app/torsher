<script setup lang="ts">
import type { TitleDetails } from '@torsher/api-client'
import type { KeyAction } from '../focus/index.ts'
import type { StageStep } from '../lib/player.ts'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PlayerBuffering from '../components/player/PlayerBuffering.vue'
import PlayerLamp from '../components/player/PlayerLamp.vue'
import PlayerOsd from '../components/player/PlayerOsd.vue'
import PlayerPrompt from '../components/player/PlayerPrompt.vue'
import PlayerStage from '../components/player/PlayerStage.vue'
import AppIcon from '../components/AppIcon.vue'
import FocusSection from '../components/FocusSection.vue'
import PlayerTracks from '../components/player/PlayerTracks.vue'
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
import { useResource } from '../composables/useResource.ts'
import { loadSeason } from '../composables/useTitleSections.ts'
import { useFocus } from '../focus/index.ts'
import {
  backAction,
  bufferedSeconds,
  bufferingStep,
  byteOffset,
  canRetry,
  clampTime,
  endedEarly,
  formatDuration,
  formatGigabytes,
  freshBudget,
  nextRetry,
  PAUSED_METADATA_MS,
  settleBudget,
  stallAction,
  streamLive,
  videoTimePolicy,
} from '../lib/player.ts'
import { LOADER_DELAY_MS } from '../lib/loader.ts'
import { goBack } from '../lib/navigation.ts'
import { titleRefOf } from '../lib/sources.ts'

const props = defineProps<{
  torrentId: string
  fileIndex: string
  // Открыт из карточки тайтла: позиция сохраняется по серии, а не по файлу
  titleId?: string
  season?: string
  episode?: string
}>()

// Позиция сохраняется по ходу просмотра, а не только на выходе: ТВ могут выключить
const SAVE_EVERY_S = 10

const { t, locale } = useI18n()
const router = useRouter()
const focus = useFocus()
const player = usePlayback(
  props.torrentId,
  Number(props.fileIndex),
  titleRefOf(props.titleId, props.season, props.episode),
)
const { playback, stats } = player

// Экран подготовки: кадр, логотип и серия тайтла — если плеер открыт из карточки
const language = useCatalogLanguage()
const { data: art } = useResource<TitleDetails>(
  computed(() =>
    props.titleId ? `${props.titleId}:${language.value}` : undefined,
  ),
  (_, signal) =>
    api.catalog.getCatalogTitle(
      props.titleId!,
      { language: language.value },
      { signal },
    ),
)
const episodeName = ref('')

if (props.titleId && props.season && props.episode) {
  loadSeason(props.titleId, Number(props.season), language.value)
    .then((details) => {
      episodeName.value
        = details.episodes.find(item => item.number === Number(props.episode))
          ?.title ?? ''
    })
    .catch(() => {
      // Без названия серии — только номер
    })
}

const artSubtitle = computed(() =>
  props.season && props.episode
    ? [
        t('player.episodeOf', { season: props.season, episode: props.episode }),
        episodeName.value,
      ]
        .filter(Boolean)
        .join(' · ')
    : '',
)

// Название на сцене: тайтл из каталога, пока его нет — имя из ответа сервера
const stageTitle = computed(
  () =>
    art.value?.title
    ?? playback.value?.title
    ?? player.pending.value?.title
    ?? '',
)

// Где остановились: «23:27 из 52:41» и та же доля на дорожке
const resumeText = computed(() => {
  const start = playback.value?.startPosition ?? 0
  const total = playback.value?.duration

  return total
    ? t('player.resume.textOf', {
        time: formatDuration(start),
        total: formatDuration(total),
      })
    : t('player.resume.text', { time: formatDuration(start) })
})

const resumeShare = computed(() => {
  const total = playback.value?.duration

  return total
    ? Math.min(1, (playback.value?.startPosition ?? 0) / total)
    : undefined
})

const video = ref<HTMLVideoElement>()
// Ошибка сети — повтор; разбор сегментов не удался — формат не по силам плееру
const hls = useHls((kind) => {
  if (kind === 'network')
    recover('unknown')
  else player.fail(kind === 'media' ? 'unsupported' : 'unknown')
})

// starting — запрашиваем адрес, resume — спрашиваем, продолжить ли,
// buffering — ждём первые кадры, playing — видео хоть раз пошло
const phase = ref<'starting' | 'resume' | 'buffering' | 'playing'>('starting')
const stalled = ref(false)
const paused = ref(false)
const position = ref(0)
const tracks = usePlayerTracks(playback, video, position, restartWith)
const duration = ref(Number.NaN)
const panel = ref<'audio' | 'subtitles' | null>(null)
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
// Поток хоть раз ставился в видео: повтор продолжает его с места, а не
// спрашивает заново «Продолжить»
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
const tracksHint = computed(() =>
  panel.value === 'audio' && playback.value?.audioSwitch === 'restart'
    ? t('player.restartHint')
    : undefined,
)

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
// Ошибку уже продержали всю задержку: торшер и полоса встают без второй паузы
const instantLoader = ref(false)
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

const showsStage = computed(
  () => showsError.value || phase.value !== 'playing' || restarting.value,
)

// Задержку снимаем, только пока сцена на экране: сменить её у идущей анимации
// появления значит снова спрятать торшер. Следующая сцена — снова с задержкой
watch(showsStage, (shown) => {
  if (!shown)
    instantLoader.value = false
})

function save() {
  if (
    videoTimePolicy({ phase: phase.value, restarting: restarting.value }).save
  ) {
    player.saveWatchState(
      osd.scrub.value?.target ?? position.value,
      knownDuration.value,
    )
  }
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
  save()
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

  if (action.type === 'back') {
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

  if (panel.value)
    return false

  if (action.type === 'media') {
    onMedia(action.key, event.repeat)
    osd.show()
    return true
  }

  const hidden = !osd.visible.value
  const onTimeline = !!document.activeElement?.closest(
    '[data-focus-section="player-timeline"]',
  )

  if (
    action.type === 'move'
    && (action.direction === 'left' || action.direction === 'right')
  ) {
    if (hidden || onTimeline) {
      osd.step(action.direction === 'right' ? 1 : -1, event.repeat)
      return true
    }
  }

  if (hidden && action.type === 'enter') {
    toggle()
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
  restarting.value = false
  reconnecting.value = false
  // Пауза от остановки прежнего потока снимается: новый играет, и сторож его
  // видит. Зритель был на паузе — новый поток ждёт на ней, как обычная пауза
  paused.value = stayPaused
  phase.value = 'buffering'
  position.value = from
  bufferingSince.value = Date.now()

  if (current.mode === 'hls') {
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

function onPromptChoice(choice: 'resume' | 'restart' | 'retry' | 'back') {
  if (choice === 'back') {
    exit()
  }
  else if (choice === 'retry') {
    holdError()
    budget = freshBudget()
    slow.value = false
    keepPaused = false
    relaunch()
  }
  else {
    void begin(choice === 'resume' ? (playback.value?.startPosition ?? 0) : 0)
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
// обычный запуск с вопросом «Продолжить»
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

  // Прежняя сессия закрывается при перезапуске: hls.js грузил бы её сегменты,
  // получал 404 и ронял экран посреди смены дорожки
  hls.detach()
  video.value?.pause()
}

/**
 * Озвучка или субтитры, которые плеер не переключит сам, и повтор после
 * сбоя: новый поток с этими дорожками с текущего места, без вопроса
 * «Продолжить»
 */
async function restartWith(change: PlaybackRestart) {
  const run = ++launch
  const at = resumeAt()

  requested = change
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

function openTracks(kind: 'audio' | 'subtitles') {
  panel.value = kind
  osd.hold()
}

function onLoadedMetadata() {
  const el = video.value!

  clearTimeout(metadataTimer)
  duration.value = el.duration
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

  // `playing` при пустом буфере может не прийти: сторож должен видеть и
  // такой запуск
  paused.value = false
  viewerPaused = false
}

function onPlaying() {
  if (phase.value !== 'playing') {
    phase.value = 'playing'
    osd.show()
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

// Старые ТВ на обрыв прямого потока отвечают не ошибкой, а концом файла
function onEnded() {
  const el = video.value

  if (
    !restarting.value
    && el
    && endedEarly(el.currentTime, el.duration, knownDuration.value)
  ) {
    recover('unknown')
  }
}

function onPointer(event: MouseEvent) {
  if (phase.value !== 'playing' || restarting.value || showsError.value) {
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
  const outcome = await player.start()

  if (run !== launch)
    return

  if (outcome === 'retry')
    recover()

  if (outcome !== 'ready')
    return

  startStats()

  if (playback.value?.startPosition)
    phase.value = 'resume'
  else void begin(0)
}

onMounted(() => {
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

    <!-- До первого кадра и при ошибке — одна сцена: фон и шапка не перерисовываются между фазами -->
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

      <PlayerPrompt
        v-else-if="playback && phase === 'resume'"
        :text="resumeText"
        :progress="resumeShare"
        :actions="[
          {
            id: 'resume',
            label: t('player.resume.continue', {
              time: formatDuration(playback.startPosition ?? 0),
            }),
          },
          { id: 'restart', label: t('player.resume.restart') },
        ]"
        @choose="onPromptChoice"
      />

      <PlayerLamp
        v-else
        :step="step"
        :connected="stats?.peers.connected ?? 0"
      />

      <template v-if="!showsError && phase !== 'resume'" #bottom>
        <PlayerBuffering :step="step" :stats="stats" />
      </template>
    </PlayerStage>

    <template
      v-if="playback && phase === 'playing' && !restarting && !showsError"
    >
      <p v-if="stalled" class="player__stall" role="status">
        <span class="player__spinner" aria-hidden="true" />
        {{ t(slow ? "player.steps.slow" : "player.steps.buffering")
        }}<template v-if="stats">
          · {{ t("player.peers", stats.peers.connected) }}
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
        :stats="stats"
        :buffer-seconds="bufferSeconds"
        :now="now"
        :audio-label="tracks.audioLabel.value"
        :subtitles-label="tracks.subtitlesLabel.value"
        @toggle="toggle"
        @seek="seekTo($event * knownDuration)"
        @tracks="openTracks"
      />

      <PlayerTracks
        v-if="panel"
        :kind="panel"
        :options="trackOptions"
        :caption="tracks.caption.value"
        :hint="tracksHint"
        @select="onTracksSelect"
      />
    </template>

    <p
      v-if="phase === 'playing' && tracks.subtitleHtml.value"
      class="player__subtitles"
      :class="{ 'player__subtitles--lifted': osd.visible.value }"
    >
      <!-- Разметку реплики чистит subtitleHtml: остаются только i, b, u -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span class="player__cue" v-html="tracks.subtitleHtml.value" />
    </p>

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
  background: rgba(0, 0, 0, 0.55);
  font-size: calc(var(--u) * 46);
  font-weight: 600;
  line-height: 1.45;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
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
