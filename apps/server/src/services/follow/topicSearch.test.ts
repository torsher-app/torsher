import { eq } from 'drizzle-orm'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  follows,
  followSeasons,
  indexers,
  trackedTopics,
} from '../../db/schema.ts'
import { cachedSearch, clearSearchCache } from '../sources/cache.ts'
import { asViewerSearch } from '../sources/search.ts'
import { followById } from './index.ts'
import {
  followSearchStarted,
  requestFollowSearch,
  resetFollowSearch,
  searchPass,
} from './search.ts'

const { decide } = vi.hoisted(() => ({ decide: vi.fn() }))
vi.mock('./pass.ts', () => ({
  followStates: async () => [],
  upgradeNeeded: async () => false,
  movieAvailability: async () => undefined,
  reportMissing: () => [],
  decideFollow: decide,
}))
vi.mock('./notify.ts', () => ({ announceMissing: async () => {} }))

const HOUR = 60 * 60 * 1000
const NOW = new Date('2026-11-08T12:00:00Z')

beforeAll(() => migrateDb())
beforeEach(() => {
  const db = getDb()
  db.delete(follows).run()
  db.delete(indexers).run()
  clearSearchCache()
  resetFollowSearch()
  decide.mockClear()
  const indexer = db
    .insert(indexers)
    .values({ name: 'Topic indexer', url: 'https://indexer.example' })
    .returning()
    .get()
  const topic = db
    .insert(trackedTopics)
    .values({
      titleId: 'tmdb:tv:1',
      indexerId: indexer.id,
      detailsUrl: 'https://indexer.example/topic/1',
      infoHash: 'a'.repeat(40),
      releaseTitle: 'Quiet Harbor S02 1-8 of 12',
      season: 2,
      episodesTo: 8,
      episodesTotal: 12,
      updatedAt: NOW,
      lastSeenAt: NOW,
    })
    .returning()
    .get()
  db.insert(follows)
    .values({
      id: 'follow',
      titleId: topic.titleId,
      kind: 'series',
      state: 'active',
      startSeason: 2,
      startEpisode: 1,
      requireRussian: false,
      waitHours: 24,
      lastSearchAt: new Date(NOW.getTime() - 12 * HOUR),
    })
    .run()
  db.insert(followSeasons)
    .values({
      followId: 'follow',
      season: 2,
      topicId: topic.id,
      expectedTotal: 12,
    })
    .run()
})
afterEach(() => vi.unstubAllGlobals())

function active() {
  return [followById('follow')!]
}
async function cache() {
  await cachedSearch(
    'tmdb:tv:1:all',
    async () => ({ releases: [], unmatched: [], indexerCount: 1, failed: [] }),
    { now: NOW.getTime() },
  )
}

describe('topic searches in the shared pass', () => {
  it('searches with no wanted episodes using the viewer cache without spending network budget', async () => {
    await cache()
    expect(await searchPass(active(), NOW)).toBe(true)
    expect(decide).toHaveBeenCalledOnce()
    expect(followById('follow')?.lastSearchAt).toEqual(NOW)
    expect(followById('follow')?.nextSearchAt).toEqual(
      new Date(NOW.getTime() + 12 * HOUR),
    )
  })

  it('obeys the shared hourly budget and viewer search pause', async () => {
    await cache()
    for (let count = 0; count < 60; count++) followSearchStarted(NOW)
    expect(await searchPass(active(), NOW)).toBe(false)
    resetFollowSearch()
    await asViewerSearch(async () =>
      expect(await searchPass(active(), NOW)).toBe(false),
    )
    expect(decide).not.toHaveBeenCalled()
  })

  it('waits for indexer backoff without advancing lastSearchAt', async () => {
    const next = new Date(NOW.getTime() + HOUR)
    getDb().update(indexers).set({ backoffUntil: next }).run()
    expect(await searchPass(active(), NOW)).toBe(false)
    expect(followById('follow')?.lastSearchAt?.getTime()).toBe(
      NOW.getTime() - 12 * HOUR,
    )
    expect(followById('follow')?.nextSearchAt).toEqual(next)
  })

  it('ignores topics before the cursor', async () => {
    getDb()
      .update(follows)
      .set({ startSeason: 3 })
      .where(eq(follows.id, 'follow'))
      .run()
    expect(await searchPass(active(), NOW)).toBe(false)
    expect(decide).not.toHaveBeenCalled()
  })

  it('keeps manual searches even when no topic is due', async () => {
    getDb().update(follows).set({ startSeason: 3 }).run()
    requestFollowSearch('follow')
    // A manual request skips the viewer cache and budget; no enabled indexer means no network.
    expect(await searchPass(active(), NOW)).toBe(false)
    expect(followById('follow')?.nextSearchAt).toEqual(
      new Date(NOW.getTime() + HOUR),
    )
  })
})
