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
  'auth',
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
  /** Подстрока сообщения без учёта регистра */
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
const MAX_CONTEXT_KEYS = 20

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
  const time = new Date(
    typeof fields.time === 'number' || typeof fields.time === 'string'
      ? fields.time
      : Date.now(),
  )
  const entry: Omit<LogEntry, 'id' | 'seq'> = {
    time: Number.isNaN(time.getTime())
      ? new Date().toISOString()
      : time.toISOString(),
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
  private nextSeq = 1
  private readonly capacity: number

  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = capacity
  }

  push(line: string) {
    const parsed = parseLine(line)

    if (!parsed)
      return

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
      return
    }

    const seq = this.nextSeq++

    this.entries.push({ id: seq, seq, ...parsed })

    if (this.entries.length > this.capacity)
      this.entries.splice(0, this.entries.length - this.capacity)
  }

  /**
   * Новые сверху. С `after` берутся ближайшие к курсору записи, и `hasMore`
   * значит «есть ещё новее»: живое обновление дочитывает их без пропусков.
   * Без него — самые новые до `before`, и `hasMore` — «есть старше».
   */
  query(query: LogQuery = {}) {
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
      && (!needle || entry.message.toLowerCase().includes(needle))
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

    return { entries: found.map(entry => ({ ...entry })), hasMore }
  }
}
