export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const

export type LogLevel = (typeof LOG_LEVELS)[number]

export const LOG_SOURCES = [
  'server',
  'engine',
  'playback',
  'storage',
  'sources',
  'catalog',
  'network',
  'notifications',
  'auth',
  'backups',
  'client',
] as const

export type LogSource = (typeof LOG_SOURCES)[number]

export interface LogEntry {
  /** Постоянный номер записи: у склеенной — номер первой из повторов */
  id: number
  /** Позиция в журнале для курсоров: склейка выдаёт новый, запись снова самая свежая */
  seq: number
  time: string
  level: LogLevel
  source: LogSource
  message: string
  details?: string
  context?: Record<string, string | number | boolean>
  /** Сколько раз подряд пришла та же запись; время — последней */
  repeat?: number
}

export interface LogQuery {
  /** Минимальный уровень */
  level?: LogLevel
  sources?: LogSource[]
  /** Подстрока сообщения или значения поля без учёта регистра */
  q?: string
  before?: number
  after?: number
  limit?: number
}

const DEFAULT_CAPACITY = 5000
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500
const MAX_DETAILS = 64 * 1024
const MAX_CONTEXT_VALUE = 500
const MAX_CONTEXT_KEYS = 32
export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function retainedTime(time: string, now = Date.now()) {
  const at = Date.parse(time)
  return Number.isFinite(at) && at <= now && at > now - LOG_RETENTION_MS
}

// Служебные поля pino и Fastify и то, что запись уже несёт отдельно
const RESERVED = new Set([
  'pid',
  'hostname',
  'reqId',
  'msg',
  'time',
  'level',
  'source',
  'err',
  'details',
])

function levelOf(value: unknown): LogLevel {
  if (typeof value === 'number') {
    if (value >= 50)
      return 'error'
    if (value >= 40)
      return 'warn'
    if (value >= 30)
      return 'info'
    return 'debug'
  }

  if (value === 'fatal')
    return 'error'

  return LOG_LEVELS.find(level => level === value) ?? 'debug'
}

// Запись без источника или с незнакомым (сторонние логгеры) — от сервера
function sourceOf(value: unknown): LogSource {
  return LOG_SOURCES.find(source => source === value) ?? 'server'
}

function rank(level: LogLevel) {
  return LOG_LEVELS.indexOf(level)
}

// Id раздачи, сессии и тайтла лежат в полях: поиск по ним собирает все
// записи одного случая
function hasText(entry: LogEntry, needle: string) {
  if (entry.message.toLowerCase().includes(needle))
    return true

  return Object.values(entry.context ?? {}).some(value =>
    String(value).toLowerCase().includes(needle),
  )
}

function isPrimitive(value: unknown): value is string | number | boolean {
  return (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  )
}

function contextOf(record: Record<string, unknown>) {
  const context: Record<string, string | number | boolean> = {}
  let count = 0

  for (const [key, raw] of Object.entries(record)) {
    if (RESERVED.has(key))
      continue

    let value: string | number | boolean | undefined

    if (isPrimitive(raw))
      value = raw
    else if (Array.isArray(raw) && raw.every(isPrimitive))
      value = raw.join(', ')

    if (value === undefined)
      continue

    context[key]
      = typeof value === 'string' ? value.slice(0, MAX_CONTEXT_VALUE) : value

    if (++count >= MAX_CONTEXT_KEYS)
      break
  }

  return count ? context : undefined
}

// Ключи по порядку: одинаковый контекст в разном порядке полей — одна запись
function sameContext(a: LogEntry['context'], b: LogEntry['context']) {
  const key = (context: LogEntry['context']) =>
    context
      ? JSON.stringify(
          Object.entries(context).sort(([x], [y]) =>
            x < y ? -1 : x > y ? 1 : 0,
          ),
        )
      : ''

  return key(a) === key(b)
}

function detailsOf(record: Record<string, unknown>) {
  const err = record.err as { stack?: unknown, message?: unknown } | undefined
  const details
    = typeof record.details === 'string'
      ? record.details
      : typeof err?.stack === 'string'
        ? err.stack
        : typeof err?.message === 'string'
          ? err.message
          : undefined

  return details?.slice(0, MAX_DETAILS)
}

/** Разбирает строку журнала (JSON pino); битая строка — `undefined` */
export function parseLine(
  line: string,
): Omit<LogEntry, 'id' | 'seq'> | undefined {
  let record: unknown

  try {
    record = JSON.parse(line)
  }
  catch {
    return undefined
  }

  if (!record || typeof record !== 'object' || Array.isArray(record))
    return undefined

  const fields = record as Record<string, unknown>
  if (typeof fields.time !== 'number' && typeof fields.time !== 'string')
    return undefined
  const time = new Date(fields.time)
  if (!Number.isFinite(time.getTime()))
    return undefined
  const entry: Omit<LogEntry, 'id' | 'seq'> = {
    time: time.toISOString(),
    level: levelOf(fields.level),
    source: sourceOf(fields.source),
    message: typeof fields.msg === 'string' ? fields.msg : '',
  }
  const details = detailsOf(fields)
  const context = contextOf(fields)

  if (details)
    entry.details = details
  if (context)
    entry.context = context

  return entry
}

/**
 * Последние записи процесса в памяти: из них отвечает API журнала.
 * Строки приходят уже очищенными — сырой объект записи сюда не попадает.
 */
export class LogRing {
  private entries: LogEntry[] = []
  private evicted = false
  private nextSeq = 1
  private readonly capacity: number

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity
  }

  push(line: string) {
    const parsed = parseLine(line)

    if (!parsed || !retainedTime(parsed.time))
      return false

    const last = this.entries.at(-1)

    // Повторяющееся предупреждение не должно вытеснить остальной журнал.
    // Запись с другим контекстом (раздача, код, длительность) — уже другая
    if (
      last
      && !last.details
      && !parsed.details
      && last.source === parsed.source
      && last.level === parsed.level
      && last.message === parsed.message
      && sameContext(last.context, parsed.context)
    ) {
      // Новый seq — чтобы живое обновление по `after` увидело рост счётчика
      last.repeat = (last.repeat ?? 1) + 1
      last.time = parsed.time
      last.seq = this.nextSeq++
      return true
    }

    const seq = this.nextSeq++

    this.entries.push({ id: seq, seq, ...parsed })

    if (this.entries.length > this.capacity) {
      this.evicted = true
      this.entries.splice(0, this.entries.length - this.capacity)
    }
    return true
  }

  /** No raw snapshot copy: the report projects one entry at a time, newest first. */
  visitNewest(visit: (entry: LogEntry) => void) {
    for (let index = this.entries.length - 1; index >= 0; index--)
      visit(this.entries[index]!)
  }

  get version() {
    return this.nextSeq
  }

  hasEvent(eventId: string) {
    return this.entries.some(entry => entry.context?.eventId === eventId)
  }

  /**
   * Новые сверху. С `after` берутся ближайшие к курсору записи, и `hasMore`
   * значит «есть ещё новее»: живое обновление дочитывает их без пропусков.
   * Без него — самые новые до `before`, и `hasMore` — «есть старше».
   */
  query(query: LogQuery = {}) {
    const retained = this.entries.filter(entry => retainedTime(entry.time))
    this.evicted ||= retained.length !== this.entries.length
    this.entries = retained
    const limit = Math.min(
      Math.max(query.limit ?? DEFAULT_LIMIT, 1),
      MAX_LIMIT,
    )
    const min = rank(query.level ?? 'debug')
    const sources = query.sources?.length
      ? new Set<LogSource>(query.sources)
      : undefined
    const needle = query.q?.trim().toLowerCase()
    const { before, after } = query
    const matches = (entry: LogEntry) =>
      rank(entry.level) >= min
      && (!sources || sources.has(entry.source))
      && (!needle || hasText(entry, needle))
      && (before === undefined || entry.seq < before)
      && (after === undefined || entry.seq > after)
    const found: LogEntry[] = []
    let hasMore = false

    if (after !== undefined) {
      for (const entry of this.entries) {
        if (!matches(entry))
          continue
        if (found.length === limit) {
          hasMore = true
          break
        }
        found.push(entry)
      }

      found.reverse()
    }
    else {
      for (let i = this.entries.length - 1; i >= 0; i--) {
        const entry = this.entries[i]!

        if (!matches(entry))
          continue
        if (found.length === limit) {
          hasMore = true
          break
        }
        found.push(entry)
      }
    }

    const times = this.entries.map(entry => entry.time)
    return {
      entries: found.map(entry => ({ ...entry })),
      hasMore,
      window: {
        oldest: times.length ? times.reduce((a, b) => (a < b ? a : b)) : null,
        newest: times.length ? times.reduce((a, b) => (a > b ? a : b)) : null,
        capacity: this.capacity,
        retained: this.entries.length,
        evicted: this.evicted,
      },
    }
  }
}
