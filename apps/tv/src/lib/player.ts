import type { TorrentStats } from '@torsher/api-client'

/**
 * Шаги экрана буферизации: `connecting` — движок ищет пиров,
 * `waitingPeers` — долго никого нет (честно говорим, что ждём),
 * `buffering` — пиры есть, качаем начало.
 */
export type BufferingStep = 'connecting' | 'waitingPeers' | 'buffering'

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
  const value = bytesPerSecond / (1024 * 1024)
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
