import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { config } from '../../../config.ts'
import { getDb, migrateDb } from '../../../db/index.ts'
import { serverSettings } from '../../../db/schema.ts'
import { imdbRatings, imdbStatus, setImdbRatingsEnabled } from './index.ts'
import {
  IMDB_DATASET_URL,
  IMDB_MIN_ROWS,
  IMDB_RETRY_MS,
  isImdbRefreshDue,
  refreshImdbRatings,
} from './refresh.ts'
import { readImdbState, setImdbEnabled, writeImdbState } from './state.ts'
import { closeImdbStore, lookupImdbRatings } from './store.ts'

const HEADER = 'tconst\taverageRating\tnumVotes'
// Выдуманные ID из верхнего диапазона: настоящих данных IMDb в тестах нет
const BASE_ID = 9_000_000

const fetchMock = vi.fn<typeof fetch>()
let dir: string

function dataset(rows: number, extra: string[] = []) {
  const lines = [HEADER, ...extra]

  for (let index = 0; index < rows; index += 1)
    lines.push(`tt${BASE_ID + index}\t${(index % 100) / 10}\t${index + 1}`)

  return gzipSync(`${lines.join('\n')}\n`)
}

const fullDataset = dataset(IMDB_MIN_ROWS, ['tt0000001\t\\N\t\\N', 'garbage'])

function respond(body: Uint8Array, headers: Record<string, string> = {}) {
  return new Response(body, {
    headers: {
      'etag': '"v1"',
      'last-modified': 'Wed, 21 Oct 2026 00:55:16 GMT',
      ...headers,
    },
  })
}

beforeAll(() => {
  migrateDb()
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'torsher-imdb-'))
  vi.spyOn(config, 'imdbRatingsPath', 'get').mockReturnValue(
    join(dir, 'imdb-ratings.db'),
  )
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  getDb().delete(serverSettings).run()
  setImdbEnabled(true)
})

afterEach(() => {
  closeImdbStore()
  rmSync(dir, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

afterAll(() => {
  closeImdbStore()
})

describe('загрузка выгрузки', () => {
  it('скачивает, разбирает и ищет оценки пачкой', async () => {
    fetchMock.mockResolvedValue(respond(fullDataset))

    await refreshImdbRatings()

    expect(String(fetchMock.mock.calls[0]![0])).toBe(IMDB_DATASET_URL)
    expect(
      lookupImdbRatings([`tt${BASE_ID + 87}`, 'tt0000001', 'nm0000001']),
    ).toEqual(new Map([[`tt${BASE_ID + 87}`, { value: 8.7, votes: 88 }]]))
    expect(imdbStatus()).toMatchObject({
      enabled: true,
      state: 'ready',
      count: IMDB_MIN_ROWS,
      updatedAt: '2026-10-21T00:55:16.000Z',
    })
    expect(existsSync(`${config.imdbRatingsPath}.tmp`)).toBe(false)
  }, 20_000)

  it('на 304 оставляет файл и отмечает проверку', async () => {
    fetchMock.mockResolvedValue(respond(fullDataset))
    await refreshImdbRatings()
    const first = readImdbState()

    fetchMock.mockResolvedValue(new Response(null, { status: 304 }))
    await refreshImdbRatings()

    const headers = new Headers(fetchMock.mock.calls[1]![1]?.headers)

    expect(headers.get('if-none-match')).toBe('"v1"')
    expect(headers.get('if-modified-since')).toBe(
      'Wed, 21 Oct 2026 00:55:16 GMT',
    )
    expect(readImdbState()).toMatchObject({ count: first.count, etag: '"v1"' })
    expect(lookupImdbRatings([`tt${BASE_ID}`]).size).toBe(1)
  }, 20_000)

  it('при ошибке сети и битом файле оставляет прежнюю выгрузку', async () => {
    fetchMock.mockResolvedValue(respond(fullDataset))
    await refreshImdbRatings()

    fetchMock.mockResolvedValue(new Response('fail', { status: 500 }))
    await refreshImdbRatings()
    expect(readImdbState().error?.kind).toBe('unavailable')

    fetchMock.mockResolvedValue(respond(new Uint8Array([1, 2, 3])))
    await refreshImdbRatings()
    expect(readImdbState().error?.kind).toBe('invalid')

    expect(lookupImdbRatings([`tt${BASE_ID}`]).size).toBe(1)
    expect(imdbStatus()).toMatchObject({
      state: 'ready',
      count: IMDB_MIN_ROWS,
    })
  }, 20_000)

  it('не принимает обрезанный файл и чужой заголовок', async () => {
    fetchMock.mockResolvedValue(respond(dataset(10)))
    await refreshImdbRatings()
    expect(imdbStatus()).toMatchObject({
      state: 'error',
      error: { kind: 'invalid' },
    })

    fetchMock.mockResolvedValue(respond(gzipSync('id\tvalue\n')))
    await refreshImdbRatings()
    expect(imdbStatus().state).toBe('error')
    expect(existsSync(config.imdbRatingsPath)).toBe(false)
  })

  it('без файла — пустой ответ, а не ошибка', () => {
    writeFileSync(config.imdbRatingsPath, 'not a database')

    expect(lookupImdbRatings([`tt${BASE_ID}`]).size).toBe(0)
  })

  it('одновременно идёт одно обновление', async () => {
    fetchMock.mockResolvedValue(respond(fullDataset))

    await Promise.all([refreshImdbRatings(), refreshImdbRatings()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
  }, 20_000)
})

describe('включение', () => {
  it('выключение удаляет файл и состояние, поставщик молчит', async () => {
    fetchMock.mockResolvedValue(respond(fullDataset))
    await refreshImdbRatings()

    await setImdbRatingsEnabled(false)

    expect(existsSync(config.imdbRatingsPath)).toBe(false)
    expect(readImdbState()).toEqual({})
    expect(imdbStatus()).toEqual({ enabled: false, state: 'off' })
    expect(imdbRatings.enabled()).toBe(false)
  }, 20_000)

  it('проверяет раз в сутки, после ошибки — через час', () => {
    const now = Date.parse('2026-10-23T12:00:00Z')
    const ago = (ms: number) => new Date(now - ms).toISOString()

    expect(isImdbRefreshDue(now)).toBe(true)

    writeImdbState({
      attemptedAt: ago(10 * 60 * 1000),
      error: { kind: 'unavailable', at: ago(0) },
    })
    expect(isImdbRefreshDue(now)).toBe(false)

    writeImdbState({
      attemptedAt: ago(IMDB_RETRY_MS),
      error: { kind: 'unavailable', at: ago(0) },
    })
    expect(isImdbRefreshDue(now)).toBe(true)

    setImdbEnabled(false)
    expect(isImdbRefreshDue(now)).toBe(false)
  })
})
