import type { ImdbDatasetState, ImdbErrorKind } from './state.ts'
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import { setImmediate } from 'node:timers/promises'
import { createGunzip } from 'node:zlib'
import Database from 'better-sqlite3'
import { logFor } from '../../logs/index.ts'
import { netFetch } from '../../net/index.ts'
import { isImdbEnabled, readImdbState, writeImdbState } from './state.ts'
import { closeImdbStore, imdbNumber, imdbStorePath } from './store.ts'

export const IMDB_DATASET_URL
  = 'https://datasets.imdbws.com/title.ratings.tsv.gz'

const HEADER = 'tconst\taverageRating\tnumVotes'
// В выгрузке больше 1,7 млн строк: меньшее число — обрезанный или чужой файл
export const IMDB_MIN_ROWS = 100_000
// Пачка — одна транзакция; между пачками event loop отпускается, чтобы потоки
// видео не ждали импорта
const BATCH_SIZE = 5000
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000

export class ImdbDatasetError extends Error {
  readonly kind: ImdbErrorKind

  constructor(kind: ImdbErrorKind, message: string) {
    super(message)
    this.name = 'ImdbDatasetError'
    this.kind = kind
  }
}

function parseLine(line: string) {
  const [tconst, average, votes] = line.split('\t')
  const id = tconst ? imdbNumber(tconst) : undefined
  const value = Number(average)
  const count = Number(votes)

  if (id === undefined || !Number.isFinite(value) || !Number.isInteger(count))
    return undefined

  return { id, rating: Math.round(value * 10), votes: count }
}

/** Разбирает выгрузку во временный файл; итог — число записей */
async function importDataset(
  body: ReadableStream<Uint8Array>,
  path: string,
  signal: AbortSignal,
) {
  rmSync(path, { force: true })
  mkdirSync(dirname(path), { recursive: true })

  const db = new Database(path)

  try {
    // Файл собирается целиком и заменяет прежний: журнал не нужен
    db.pragma('journal_mode = OFF')
    db.pragma('synchronous = OFF')
    db.exec(
      'CREATE TABLE ratings (id INTEGER PRIMARY KEY, rating INTEGER NOT NULL, votes INTEGER NOT NULL) WITHOUT ROWID',
    )

    const insert = db.prepare(
      'INSERT OR REPLACE INTO ratings (id, rating, votes) VALUES (?, ?, ?)',
    )
    const insertBatch = db.transaction(
      (rows: { id: number, rating: number, votes: number }[]) => {
        for (const row of rows) insert.run(row.id, row.rating, row.votes)
      },
    )
    const lines = createInterface({
      input: Readable.fromWeb(body as never, { signal }).pipe(createGunzip()),
      crlfDelay: Infinity,
    })
    let header: string | undefined
    let batch: { id: number, rating: number, votes: number }[] = []
    let count = 0

    for await (const line of lines) {
      if (header === undefined) {
        header = line

        if (header !== HEADER)
          throw new ImdbDatasetError('invalid', 'Unexpected dataset header')

        continue
      }

      const row = parseLine(line)

      if (!row)
        continue

      batch.push(row)

      if (batch.length >= BATCH_SIZE) {
        insertBatch(batch)
        count += batch.length
        batch = []
        await setImmediate()
      }
    }

    insertBatch(batch)
    count += batch.length

    if (count < IMDB_MIN_ROWS)
      throw new ImdbDatasetError('invalid', `Dataset has only ${count} rows`)

    return count
  }
  finally {
    db.close()
  }
}

async function download(state: ImdbDatasetState, signal: AbortSignal) {
  const target = imdbStorePath()
  const headers: Record<string, string> = {}

  // Условный запрос — только когда есть что оставить на 304
  if (existsSync(target) && state.count) {
    if (state.etag)
      headers['If-None-Match'] = state.etag
    if (state.lastModified)
      headers['If-Modified-Since'] = state.lastModified
  }

  let response: Response

  try {
    response = await netFetch(IMDB_DATASET_URL, {
      headers,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      ]),
    })
  }
  catch (err) {
    throw new ImdbDatasetError(
      'unavailable',
      err instanceof Error ? err.message : String(err),
    )
  }

  const now = new Date().toISOString()

  if (response.status === 304)
    return { ...state, checkedAt: now, error: undefined }

  if (!response.ok || !response.body) {
    throw new ImdbDatasetError(
      'unavailable',
      `IMDb responded ${response.status}`,
    )
  }

  const temporary = `${target}.tmp`

  try {
    const count = await importDataset(response.body, temporary, signal)

    closeImdbStore()
    renameSync(temporary, target)

    const lastModified = response.headers.get('last-modified') ?? undefined
    const modifiedAt = lastModified ? new Date(lastModified) : undefined

    return {
      ...state,
      checkedAt: now,
      updatedAt:
        modifiedAt && !Number.isNaN(modifiedAt.getTime())
          ? modifiedAt.toISOString()
          : now,
      etag: response.headers.get('etag') ?? undefined,
      lastModified,
      count,
      error: undefined,
    }
  }
  catch (err) {
    rmSync(temporary, { force: true })

    if (err instanceof ImdbDatasetError || signal.aborted)
      throw err

    // Обрыв потока посреди ответа — сеть; ошибка gzip или базы — формат
    const kind = (err as NodeJS.ErrnoException).code?.startsWith('Z_')
      ? 'invalid'
      : 'unavailable'

    throw new ImdbDatasetError(
      kind,
      err instanceof Error ? err.message : String(err),
    )
  }
}

let running:
  { promise: Promise<void>, controller: AbortController } | undefined

export function isImdbRefreshRunning() {
  return running !== undefined
}

/**
 * Скачивает выгрузку, если она изменилась, и заменяет файл оценок. Прежний
 * файл остаётся при любой ошибке. Одновременно идёт одно обновление: повторный
 * вызов ждёт текущее.
 */
export function refreshImdbRatings(): Promise<void> {
  if (running)
    return running.promise

  const controller = new AbortController()
  const promise = (async () => {
    const state = readImdbState()
    const attemptedAt = new Date().toISOString()

    try {
      const next = await download({ ...state, attemptedAt }, controller.signal)

      // Выключили, пока скачивали: файл уже удалён, состояние не пишем
      if (controller.signal.aborted)
        return

      writeImdbState(next)
      logFor('catalog').info({ count: next.count }, 'IMDb ratings checked')
    }
    catch (err) {
      if (controller.signal.aborted)
        return

      const kind = err instanceof ImdbDatasetError ? err.kind : 'unavailable'

      writeImdbState({
        ...state,
        attemptedAt,
        error: { kind, at: attemptedAt },
      })
      logFor('catalog').warn({ err }, 'IMDb ratings update failed')
    }
  })().finally(() => {
    running = undefined
  })

  running = { promise, controller }

  return promise
}

/** Обрывает текущее обновление; временный файл удаляет само обновление */
export async function cancelImdbRefresh() {
  const current = running

  if (!current)
    return

  current.controller.abort()
  await current.promise
}

const DAY_MS = 24 * 60 * 60 * 1000
export const IMDB_RETRY_MS = 60 * 60 * 1000

/** Пора ли обновлять: раз в сутки от последней проверки, после ошибки — через час */
export function isImdbRefreshDue(now = Date.now()) {
  if (!isImdbEnabled() || running)
    return false

  const state = readImdbState()
  const attempted = state.attemptedAt ? Date.parse(state.attemptedAt) : 0
  const checked = state.checkedAt ? Date.parse(state.checkedAt) : 0
  const hasFile = Boolean(state.count) && existsSync(imdbStorePath())

  if (now - attempted < IMDB_RETRY_MS)
    return false

  return !hasFile || now - checked >= DAY_MS
}
