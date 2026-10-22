import type { TorrentStats } from '@torsher/api-client'

/**
 * Шаги экрана буферизации: `connecting` — движок ищет пиров,
 * `waitingPeers` — долго никого нет (честно говорим, что ждём),
 * `buffering` — пиры есть, качаем начало.
 */
export type BufferingStep = 'connecting' | 'waitingPeers' | 'buffering'

/** Шаг на сцене подготовки: ещё повтор после сбоя и медленная раздача */
export type StageStep = BufferingStep | 'reconnecting' | 'slow'

// Столько ищем пиров молча, дальше говорим, что ждём
export const WAITING_PEERS_AFTER_MS = 15_000

export function bufferingStep(
  stats: Pick<TorrentStats, 'activity' | 'peers'> | null,
  waitedMs: number,
): BufferingStep {
  if (stats && stats.activity === 'downloading' && stats.peers.connected > 0)
    return 'buffering'

  return waitedMs >= WAITING_PEERS_AFTER_MS ? 'waitingPeers' : 'connecting'
}

export type BackAction = 'closePanel' | 'hideOsd' | 'exit'

/** Back в два шага: сначала прячет то, что поверх видео, вторым нажатием выходит */
export function backAction(state: {
  panelOpen: boolean
  osdVisible: boolean
}): BackAction {
  if (state.panelOpen)
    return 'closePanel'

  return state.osdVisible ? 'hideOsd' : 'exit'
}

/** Перемотка при удержании ускоряется: чем дольше держат, тем крупнее шаг (секунд) */
export function seekStep(heldMs: number) {
  if (heldMs < 1000)
    return 10

  if (heldMs < 3000)
    return 30

  if (heldMs < 6000)
    return 60

  return 120
}

// Шаг при удержании — не чаще этого, сколько бы раз ТВ ни повторял нажатие
export const SCRUB_TICK_MS = 250
// Отдельные нажатия копятся и уходят в плеер одним переходом: торренту
// дешевле одна перемотка, чем пять
export const SCRUB_COMMIT_MS = 700

export interface Scrub {
  target: number
  direction: 1 | -1
  startedAt: number
  steppedAt: number
}

export function clampTime(time: number, duration: number) {
  const end = Number.isFinite(duration) && duration > 0 ? duration - 1 : time

  return Math.max(0, Math.min(time, end))
}

/** Нажатие ← или →: первый шаг от текущей позиции или от уже набранной цели */
export function pressScrub(
  scrub: Scrub | null,
  position: number,
  direction: 1 | -1,
  now: number,
  duration: number,
): Scrub {
  const from = scrub ? scrub.target : position
  const startedAt
    = scrub && scrub.direction === direction ? scrub.startedAt : now

  return {
    target: clampTime(from + direction * seekStep(0), duration),
    direction,
    startedAt,
    steppedAt: now,
  }
}

/** Повтор удерживаемой клавиши: шаг растёт со временем удержания */
export function holdScrub(scrub: Scrub, now: number, duration: number): Scrub {
  if (now - scrub.steppedAt < SCRUB_TICK_MS)
    return scrub

  return {
    ...scrub,
    target: clampTime(
      scrub.target + scrub.direction * seekStep(now - scrub.startedAt),
      duration,
    ),
    steppedAt: now,
  }
}

/** Сколько секунд видео в скачанном подряд: по среднему битрейту файла */
export function bufferedSeconds(bytes: number, size: number, duration: number) {
  if (!size || !Number.isFinite(duration) || duration <= 0)
    return 0

  return (bytes / size) * duration
}

// Запас, с которым нехватка скорости не страшна: пока впереди больше минуты,
// плашка не пугает зрителя
const LOW_BUFFER_SECONDS = 60

/**
 * Что сказать о сети в OSD. `done` — до конца файла всё скачано, скорость и
 * пиры больше не важны. Иначе `level` 0–4 — палочки, как у сотовой связи:
 * успевает ли скачивание за видео (скорость против среднего битрейта файла);
 * `low` — запас кончается, а сеть не успевает.
 */
export type NetworkState
  = { kind: 'done' } | { kind: 'signal', level: 0 | 1 | 2 | 3 | 4, low: boolean }

export function networkState(input: {
  speed: number
  size: number
  downloaded: number
  duration: number
  /** Секунд видео впереди позиции, уже скачанных */
  bufferSeconds: number
  /** Секунд до конца файла от позиции */
  remaining: number
}): NetworkState {
  const { speed, size, downloaded, duration, bufferSeconds, remaining } = input

  if (
    (size > 0 && downloaded >= size)
    || (remaining > 0 && bufferSeconds >= remaining - 1)
  ) {
    return { kind: 'done' }
  }

  const bitrate
    = size > 0 && Number.isFinite(duration) && duration > 0 ? size / duration : 0
  const ratio = bitrate > 0 ? speed / bitrate : 0
  const level
    = ratio >= 2 ? 4 : ratio >= 1.3 ? 3 : ratio >= 1 ? 2 : ratio > 0 ? 1 : 0

  return {
    kind: 'signal',
    level,
    low: bufferSeconds < LOW_BUFFER_SECONDS && ratio < 1,
  }
}

/** Окно, в котором фатальные ошибки медиа hls.js считаются одной серией */
export const MEDIA_ERROR_WINDOW_MS = 3000

/**
 * Что делать с фатальной ошибкой медиа hls.js, зная время прежних. Без
 * предела `recoverMediaError` на битом сегменте зацикливается: первая —
 * восстановление, вторая подряд — ещё и смена аудиокодека (лечит
 * несовпадение HE-AAC и AAC), третья подряд — отказ.
 */
export function mediaErrorAction(
  previous: number[],
  now: number,
): 'recover' | 'swapAndRecover' | 'fail' {
  const recent = previous.filter(
    at => now - at < MEDIA_ERROR_WINDOW_MS,
  ).length

  return recent === 0 ? 'recover' : recent === 1 ? 'swapAndRecover' : 'fail'
}

/**
 * Учитывать ли `currentTime` видео (`track`) и сохранять ли позицию (`save`).
 * При перезапуске дорожки hls.js отцепляется, и `currentTime` падает в 0: это
 * не просмотр, позиция остаётся прежней и не сохраняется, пока не пойдёт новый
 * поток. До первых кадров позицию не сохраняем: просмотра ещё не было.
 */
export function videoTimePolicy(state: {
  phase: 'starting' | 'buffering' | 'playing'
  restarting: boolean
}) {
  return {
    track: !state.restarting,
    save: !state.restarting && state.phase === 'playing',
  }
}

// Паузы перед повторами серии, секунд: дальше — последняя
const RETRY_DELAYS_S = [2, 5, 10, 20, 30]
// Столько с первого сбоя серии плеер повторяет сам: перекрывает худший
// перезапуск движка вместе с восстановлением раздач
export const RETRY_WINDOW_MS = 180_000
// Столько непрерывного воспроизведения — и прошлые сбои забыты
export const RETRY_RESET_MS = 60_000
// Поток стартовал на паузе: сторож выключен, и без метаданных за это время
// он считается сбоем
export const PAUSED_METADATA_MS = 20_000

/** Пауза перед повтором номер `attempt` (с нуля) */
export function retryDelay(attempt: number) {
  return RETRY_DELAYS_S[Math.min(attempt, RETRY_DELAYS_S.length - 1)]! * 1000
}

/** Бюджет повторов: серия сбоев с первого и число попыток в ней */
export interface RetryBudget {
  firstFailureAt: number | null
  attempts: number
}

export function freshBudget(): RetryBudget {
  return { firstFailureAt: null, attempts: 0 }
}

export function canRetry(budget: RetryBudget, now: number) {
  return (
    budget.firstFailureAt === null
    || now - budget.firstFailureAt < RETRY_WINDOW_MS
  )
}

/** Сбой: следующая попытка и пауза перед ней; `null` — бюджет исчерпан */
export function nextRetry(budget: RetryBudget, now: number) {
  if (!canRetry(budget, now))
    return null

  return {
    budget: {
      firstFailureAt: budget.firstFailureAt ?? now,
      attempts: budget.attempts + 1,
    },
    delayMs: retryDelay(budget.attempts),
  }
}

/**
 * Поток живой: видео хоть раз пошло, а плеер не перезапускает его, не ждёт
 * повтора и не показывает ошибку. Пауза или «играть» зрителя на таком потоке
 * начинают новую серию повторов; сбои на паузе считаются по обычным часам
 */
export function streamLive(state: {
  phase: 'starting' | 'buffering' | 'playing'
  restarting: boolean
  failed: boolean
}) {
  return state.phase === 'playing' && !state.restarting && !state.failed
}

/** `playingSince` — с какого момента `currentTime` растёт без остановки */
export function settleBudget(
  budget: RetryBudget,
  playingSince: number | null,
  now: number,
) {
  return playingSince !== null && now - playingSince >= RETRY_RESET_MS
    ? freshBudget()
    : budget
}

// Статистика молчит дольше — не отвечает сервер или движок
export const STATS_STALE_MS = 15_000
// Столько данных впереди у движка значат, что стоит не раздача, а конвейер
const AHEAD_ENOUGH_S = 30
const STUCK_WITH_DATA_MS = 20_000
// Столько стоим при живых пирах, прежде чем начать поток заново
const STUCK_WITH_PEERS_MS = 120_000

/**
 * Сторож прогресса, раз в секунду, пока плеер хочет играть. `retry` — сбой
 * на нашей стороне, поток начинается заново; `wait` — ждём (пиров нет или
 * ещё рано судить); `slow` — пиры есть, но раздача не успевает, а повторы
 * кончились: ждём дальше с честной подписью, это не ошибка.
 */
export function stallAction(input: {
  now: number
  /** Когда статистика движка пришла в последний раз */
  statsAt: number
  /** Подключённые пиры; `null` — статистики ещё не было */
  peers: number | null
  /** Секунд видео впереди позиции, скачанных движком подряд */
  aheadSeconds: number
  /** Сколько `currentTime` не растёт */
  stuckMs: number
  /** Сколько пиры подключены без перерыва */
  peersMs: number
  budgetLeft: boolean
}): 'ok' | 'wait' | 'retry' | 'slow' {
  const { now, statsAt, peers, aheadSeconds, stuckMs, peersMs, budgetLeft }
    = input

  // Молчит только статистика, а видео идёт — просмотр не трогаем
  if (now - statsAt > STATS_STALE_MS) {
    if (stuckMs >= STUCK_WITH_DATA_MS)
      return 'retry'

    return stuckMs > 0 ? 'wait' : 'ok'
  }

  // Данные есть, а видео стоит — даже без пиров: файл мог скачаться целиком
  if (aheadSeconds >= AHEAD_ENOUGH_S && stuckMs >= STUCK_WITH_DATA_MS)
    return 'retry'

  if (!peers)
    return 'wait'

  // Пиры только что подключились после простоя: даём им то же время
  if (Math.min(stuckMs, peersMs) >= STUCK_WITH_PEERS_MS)
    return budgetLeft ? 'retry' : 'slow'

  return stuckMs > 0 ? 'wait' : 'ok'
}

/**
 * Что делать со сбоем запуска: `retry` — сбой сети, сервера или движка,
 * который пройдёт сам; `fail` — причина не наша (нет входа, раздачи,
 * метаданных, места), повтор даст то же.
 */
export function startErrorAction(error: {
  /** HTTP-статус; `undefined` — ответа не было */
  status: number | undefined
  /** Имя ошибки без ответа: `TypeError` — сеть, `TimeoutError` — таймаут */
  name?: string
  /** `kind` ответа 503 */
  engineKind?: string
}): 'retry' | 'fail' {
  const { status, name, engineKind } = error

  if (status === 503)
    return engineKind === 'not_installed' ? 'fail' : 'retry'

  if (status === 502 || status === 504)
    return 'retry'

  if (status !== undefined)
    return 'fail'

  return name === 'TypeError' || name === 'TimeoutError' ? 'retry' : 'fail'
}

/**
 * Конец файла раньше времени: так старые ТВ отвечают на обрыв прямого потока.
 * Длительность — текущая у видео, если он её знает: она могла уточниться
 * после `loadedmetadata`.
 */
export function endedEarly(
  currentTime: number,
  mediaDuration: number,
  knownDuration: number,
) {
  const total = Number.isFinite(mediaDuration) ? mediaDuration : knownDuration

  return Number.isFinite(total) && currentTime < total - 2
}

/** Позиция чтения в байтах — по той же оценке битрейта */
export function byteOffset(time: number, size: number, duration: number) {
  if (!size || !Number.isFinite(duration) || duration <= 0)
    return 0

  return Math.min(size, Math.max(0, Math.floor((time / duration) * size)))
}

function pad(value: number) {
  return value < 10 ? `0${value}` : String(value)
}

/** «1:02:03» или «18:44» */
export function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60

  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/**
 * Время на часах: «18:21». `Intl.DateTimeFormat` — только если ТВ знает локаль:
 * данные ICU на старых ТВ не проверены, иначе 24-часовой формат.
 */
export function formatClock(date: Date, locale: string) {
  const tag = locale.replace('_', '-')

  if (
    typeof Intl !== 'undefined'
    && Intl.DateTimeFormat.supportedLocalesOf([tag]).length > 0
  ) {
    return new Intl.DateTimeFormat(tag, {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date)
  }

  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Когда закончится при обычной скорости с текущей позиции */
export function endsAt(now: Date, remainingSeconds: number) {
  return new Date(now.getTime() + Math.max(0, remainingSeconds) * 1000)
}

/** Мегабайты в секунду с одним знаком: «2,4»; без данных локали — точка */
export function formatSpeed(bytesPerSecond: number, locale: string) {
  return formatOneDecimal(bytesPerSecond / (1024 * 1024), locale)
}

/** Гигабайты с одним знаком: «2,1»; единицу добавляет строка i18n */
export function formatGigabytes(bytes: number, locale: string) {
  return formatOneDecimal(bytes / 1024 ** 3, locale)
}

// Chromium 68 не знает `style: 'unit'`, поэтому только число
function formatOneDecimal(value: number, locale: string) {
  const tag = locale.replace('_', '-')

  if (
    typeof Intl !== 'undefined'
    && Intl.NumberFormat.supportedLocalesOf([tag]).length > 0
  ) {
    return new Intl.NumberFormat(tag, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value)
  }

  return value.toFixed(1)
}
