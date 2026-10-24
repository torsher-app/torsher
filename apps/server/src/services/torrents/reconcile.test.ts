import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { setEngineReady } from '../engine/index.ts'
import { engineError, liveState } from '../engine/fixtures/index.ts'
import { reconcileTorrentsAfterRestore } from './reconcile.ts'

const hash = (char: string) => char.repeat(40)
const fetchMock = vi.fn<typeof fetch>()
let downloads: string

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function calls() {
  return fetchMock.mock.calls
    .map(([input, init]) => {
      const url = new URL(String(input))

      return `${init?.method ?? 'GET'} ${url.pathname}${url.search}`
    })
    .filter(call => call !== 'GET /torrents')
}

function row(id: string, infoHash: string, retention: 'cache' | 'keep') {
  return {
    id,
    infoHash,
    name: `Sample ${id}`,
    source: 'file' as const,
    status: 'ready' as const,
    retention,
    inEngine: true,
    files: [{ path: `Sample.${id}.mkv`, size: 10, padding: false }],
  }
}

beforeAll(async () => {
  await migrateDb()
  downloads = mkdtempSync(join(tmpdir(), 'torsher-reconcile-'))
  vi.stubEnv('DOWNLOADS_PATH', downloads)
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
})

afterAll(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  rmSync(downloads, { recursive: true, force: true })
})

describe('сверка раздач после восстановления', () => {
  it('лишняя в движке снята без файлов, кэш без данных удалён, закреплённая без данных на паузе', async () => {
    getDb()
      .insert(torrents)
      .values([
        row('cache-gone', hash('a'), 'cache'),
        row('keep-gone', hash('b'), 'keep'),
        row('keep-here', hash('c'), 'keep'),
        row('cache-here', hash('d'), 'cache'),
      ])
      .run()

    mkdirSync(join(downloads, 'Sample keep-here'))
    writeFileSync(join(downloads, 'Sample.cache-here.mkv'), 'data')

    const live = ['a', 'b', 'c', 'd', 'e'].map(char => ({
      ...liveState,
      infoHash: hash(char),
    }))

    fetchMock.mockImplementation(async (input, init = {}) => {
      const key = `${init.method ?? 'GET'} ${new URL(String(input)).pathname}`

      if (key === 'GET /torrents')
        return json(live)

      if (key.startsWith('DELETE '))
        return json({ deletedBytes: 0 })

      if (key.endsWith('/pause'))
        return new Response(null, { status: 204 })

      return json(engineError('not_found', 'not found'), 404)
    })

    const counts = await reconcileTorrentsAfterRestore()

    expect(counts).toEqual({ removedFromEngine: 1, deleted: 1, paused: 1 })
    expect(calls()).toEqual([
      `DELETE /torrents/${hash('e')}`,
      `DELETE /torrents/${hash('a')}`,
      `POST /torrents/${hash('b')}/pause`,
    ])

    const rows = getDb().select().from(torrents).all()

    expect(rows.map(item => item.id).sort()).toEqual([
      'cache-here',
      'keep-gone',
      'keep-here',
    ])
    expect(rows.find(item => item.id === 'keep-gone')?.pauseReason).toBe(
      'user',
    )
    expect(
      rows.find(item => item.id === 'keep-here')?.pauseReason,
    ).toBeNull()
  })
  it('каталог загрузок недоступен — сверки нет, ничего не удаляется', async () => {
    const before = getDb().select().from(torrents).all()

    vi.stubEnv('DOWNLOADS_PATH', join(downloads, 'not-mounted'))
    fetchMock.mockClear()

    expect(await reconcileTorrentsAfterRestore()).toEqual({
      skipped: 'downloads_unavailable',
    })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getDb().select().from(torrents).all()).toEqual(before)
    vi.stubEnv('DOWNLOADS_PATH', downloads)
  })
  it('ни у одной раздачи нет файлов (пустая точка монтирования) — сверки нет', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'torsher-reconcile-empty-'))
    const before = getDb().select().from(torrents).all()

    vi.stubEnv('DOWNLOADS_PATH', empty)
    fetchMock.mockClear()

    try {
      expect(before.length).toBeGreaterThan(0)
      expect(await reconcileTorrentsAfterRestore()).toEqual({
        skipped: 'downloads_unavailable',
      })
      expect(calls()).toEqual([])
      expect(getDb().select().from(torrents).all()).toEqual(before)
    }
    finally {
      vi.stubEnv('DOWNLOADS_PATH', downloads)
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
