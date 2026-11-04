import type { HistoryRange, LoadPoint } from '../../dto/overview.ts'
import Database from 'better-sqlite3'

export const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
export const ranges: Record<HistoryRange, { duration: number, step: number }>
  = {
    '1m': { duration: MINUTE, step: 5000 },
    '15m': { duration: 15 * MINUTE, step: 5000 },
    '1h': { duration: 60 * MINUTE, step: MINUTE },
    '24h': { duration: DAY, step: 5 * MINUTE },
    '7d': { duration: 7 * DAY, step: 30 * MINUTE },
    '14d': { duration: 14 * DAY, step: 60 * MINUTE },
  }

type Field = 'cpuCores' | 'memoryBytes' | 'receiveBps' | 'sendBps'
const fields: Field[] = ['cpuCores', 'memoryBytes', 'receiveBps', 'sendBps']
type Totals = Record<Field | `${Field}Count`, number> & {
  time: number
  cpuPeak: number | null
}

function totals(time: number): Totals {
  return {
    time,
    cpuPeak: null,
    cpuCores: 0,
    cpuCoresCount: 0,
    memoryBytes: 0,
    memoryBytesCount: 0,
    receiveBps: 0,
    receiveBpsCount: 0,
    sendBps: 0,
    sendBpsCount: 0,
  }
}

function add(row: Totals, point: LoadPoint) {
  for (const key of fields) {
    if (point[key] !== null) {
      row[key] += point[key]
      row[`${key}Count`]++
    }
  }
  if (point.cpuCores !== null)
    row.cpuPeak = Math.max(row.cpuPeak ?? 0, point.cpuCores)
}

function average(row: Totals): LoadPoint {
  const avg = (field: Field) =>
    row[`${field}Count`] ? row[field] / row[`${field}Count`] : null
  return {
    time: row.time,
    cpuCores: avg('cpuCores'),
    cpuPeak: row.cpuPeak,
    memoryBytes: avg('memoryBytes'),
    receiveBps: avg('receiveBps'),
    sendBps: avg('sendBps'),
  }
}

const bucket = (time: number, step: number) => Math.floor(time / step) * step
const columns = fields.flatMap(key => [key, `${key}Count`])

/** Minute totals live for 14 days. Only the recent minutes retain their individual samples. */
export class LoadArchive {
  private db: Database.Database
  private cache = new Map<HistoryRange, { since: number, rows: Totals[] }>()

  constructor(path: string) {
    this.db = new Database(path, { timeout: 100 })
    try {
      this.db.pragma('journal_mode = WAL')
      this.db.exec(`CREATE TABLE IF NOT EXISTS minutes (
        time INTEGER PRIMARY KEY, raw TEXT, cpuPeak REAL,
        ${columns.map(k => `${k} REAL NOT NULL`).join(', ')}
      ); CREATE INDEX IF NOT EXISTS recent_minutes ON minutes(time) WHERE raw IS NOT NULL`)
    }
    catch (error) {
      this.db.close()
      throw error
    }
  }

  close() {
    this.db.close()
  }

  recent(now: number): LoadPoint[] {
    const rows = this.db
      .prepare(
        'SELECT raw FROM minutes WHERE time BETWEEN ? AND ? AND raw IS NOT NULL ORDER BY time',
      )
      .all(bucket(now - 15 * MINUTE, MINUTE), now) as { raw: string }[]
    return rows
      .flatMap(row => JSON.parse(row.raw) as LoadPoint[])
      .filter(p => p.time > now - 15 * MINUTE && p.time <= now)
  }

  write(samples: LoadPoint[], now: number) {
    const groups = new Map<number, LoadPoint[]>()
    for (const point of samples) {
      const time = bucket(point.time, MINUTE)
      if (!groups.has(time))
        groups.set(time, [])
      groups.get(time)!.push(point)
    }
    const get = this.db.prepare('SELECT raw FROM minutes WHERE time = ?')
    const put = this.db
      .prepare(`INSERT OR REPLACE INTO minutes (time,raw,cpuPeak,${columns.join(',')})
      VALUES (@time,@raw,@cpuPeak,${columns.map(k => `@${k}`).join(',')})`)
    this.db.transaction(() => {
      for (const [time, batch] of groups) {
        const saved = get.get(time) as { raw: string | null } | undefined
        const points = new Map<number, LoadPoint>()
        for (const point of [
          ...JSON.parse(saved?.raw ?? '[]'),
          ...batch,
        ] as LoadPoint[])
          points.set(point.time, point)
        const ordered = [...points.values()].sort((a, b) => a.time - b.time)
        const row = totals(time)
        for (const point of ordered) add(row, point)
        put.run({ ...row, raw: JSON.stringify(ordered) })
      }
      this.db
        .prepare(
          'UPDATE minutes SET raw = NULL WHERE raw IS NOT NULL AND time < ?',
        )
        .run(bucket(now - 15 * MINUTE, MINUTE))
      this.db
        .prepare('DELETE FROM minutes WHERE time < ? OR time > ?')
        .run(bucket(now - 14 * DAY, MINUTE), now)
    })()
    this.cache.clear()
  }

  history(range: HistoryRange, now: number, pending: LoadPoint[]): LoadPoint[] {
    const { step, duration } = ranges[range]
    const since = Math.ceil((now - duration) / MINUTE) * MINUTE
    let cached = this.cache.get(range)
    if (!cached || cached.since !== since) {
      const rows = this.db
        .prepare(
          `SELECT time - time % @step AS bin, MAX(cpuPeak) AS cpuPeak,
        ${columns.map(k => `SUM(${k}) AS ${k}`).join(',')}
        FROM minutes WHERE time BETWEEN @since AND @now GROUP BY bin ORDER BY bin`,
        )
        .all({ step, since, now }) as (Totals & { bin: number })[]
      cached = { since, rows: rows.map(row => ({ ...row, time: row.bin })) }
      this.cache.set(range, cached)
    }
    return aggregatePoints(pending, range, now, cached.rows)
  }
}

export function aggregatePoints(
  points: LoadPoint[],
  range: HistoryRange,
  now: number,
  stored: Totals[] = [],
) {
  const { duration, step } = ranges[range]
  const buckets = new Map(stored.map(row => [row.time, { ...row }]))
  for (const point of points) {
    if (point.time <= now - duration || point.time > now)
      continue
    const time = bucket(point.time, step)
    const row = buckets.get(time) ?? totals(time)
    add(row, point)
    buckets.set(time, row)
  }
  return [...buckets.values()]
    .sort((a, b) => a.time - b.time)
    .map(row => ({
      ...average(row),
      time: Math.max(row.time, now - duration),
    }))
}
