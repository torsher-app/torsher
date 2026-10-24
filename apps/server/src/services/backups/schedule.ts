import type { BackupSettings } from './settings.ts'

export interface BackupAttempt {
  at: string
  /** Слот расписания, к которому относится попытка (ISO) */
  slot: string
  count: number
  error?: { kind: string, params: Record<string, string | number> }
}

export interface BackupState {
  lastSuccessAt?: string
  lastAttempt?: BackupAttempt
  dirAvailable?: boolean
}

// Старт и так занят движком и сканом: догоняющая копия — не раньше
export const STARTUP_DELAY_MS = 5 * 60 * 1000
export const RETRY_DELAY_MS = 60 * 60 * 1000
export const MAX_ATTEMPTS = 3

function timeOf(time: string) {
  return time.split(':').map(Number) as [number, number]
}

/**
 * Последний наступивший слот расписания по местному времени процесса (`TZ`
 * контейнера). Сегодняшнее время ещё не наступило — вчерашний.
 */
export function slotFor(now: Date, time: string) {
  const [hours, minutes] = timeOf(time)
  const slot = new Date(now)

  slot.setHours(hours, minutes, 0, 0)

  if (slot > now) {
    slot.setDate(slot.getDate() - 1)
    slot.setHours(hours, minutes, 0, 0)
  }

  return slot
}

export interface DueInput {
  now: Date
  settings: Pick<BackupSettings, 'enabled' | 'time'>
  state: BackupState
  startedAt: Date
  /** Время самой новой плановой копии в каталоге */
  lastScheduledAt?: Date
}

function attemptsFor(state: BackupState, slot: Date) {
  const attempt = state.lastAttempt

  return attempt && attempt.slot === slot.toISOString() ? attempt : undefined
}

/** Когда можно снимать копию текущего слота; `undefined` — слот закрыт */
function earliestFor(input: DueInput, slot: Date) {
  if (input.lastScheduledAt && input.lastScheduledAt >= slot)
    return undefined

  const attempt = attemptsFor(input.state, slot)

  if (attempt && attempt.count >= MAX_ATTEMPTS)
    return undefined

  let earliest = slot.getTime()

  // Сервер был выключен в момент слота — догоняем, но не сразу после старта
  if (slot < input.startedAt)
    earliest = Math.max(earliest, input.startedAt.getTime() + STARTUP_DELAY_MS)

  if (attempt?.error) {
    earliest = Math.max(
      earliest,
      new Date(attempt.at).getTime() + RETRY_DELAY_MS,
    )
  }

  return earliest
}

export function isDue(input: DueInput) {
  if (!input.settings.enabled)
    return false

  const earliest = earliestFor(input, slotFor(input.now, input.settings.time))

  return earliest !== undefined && input.now.getTime() >= earliest
}

/** Когда расписание снимет следующую копию — для панели */
export function nextRunAt(input: DueInput) {
  if (!input.settings.enabled)
    return undefined

  const slot = slotFor(input.now, input.settings.time)
  const earliest = earliestFor(input, slot)

  if (earliest !== undefined)
    return new Date(Math.max(earliest, input.now.getTime()))

  const [hours, minutes] = timeOf(input.settings.time)
  const next = new Date(slot)

  next.setDate(next.getDate() + 1)
  next.setHours(hours, minutes, 0, 0)

  return next
}
