import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { parseRelease } from '@torsher/release-parser'
import { getDb, migrateDb } from '../../db/index.ts'
import { follows, serverSettings, titleVoices } from '../../db/schema.ts'
import * as tmdb from '../tmdb/index.ts'
import * as aliases from '../sources/aliases.ts'
import * as sources from '../sources/index.ts'
import {
  cachedSearch,
  clearSearchCache,
  peekSearch,
  SEARCH_TTL_MS,
} from '../sources/cache.ts'
import { saveSourceProfile } from '../sources/profile.ts'
import { pinVoice } from '../sources/voices.ts'
import { followVoiceOptions } from './voiceOptions.ts'

const TITLE = 'tmdb:tv:3000'
function release(id: string, title: string) {
  return {
    id,
    title,
    seeders: 12,
    indexers: [],
    parsed: parseRelease(title),
    match: { confidence: 'high' as const, issues: [] },
  }
}
beforeAll(async () => {
  await migrateDb()
})
beforeEach(() => {
  getDb().delete(follows).run()
  getDb().delete(serverSettings).run()
  getDb().delete(titleVoices).run()
  clearSearchCache()
  saveSourceProfile({ audioLanguages: ['original'] })
})
afterEach(() => vi.restoreAllMocks())

describe('follow voice options cache', () => {
  it('cache miss uses saved and inherited choices without identity, aliases or source search', async () => {
    const identity = vi.spyOn(tmdb, 'getTitleIdentity')
    const sync = vi.spyOn(aliases, 'syncTitleAliases')
    const search = vi.spyOn(sources, 'getTitleSources')
    getDb()
      .insert(follows)
      .values({
        titleId: TITLE,
        kind: 'series',
        state: 'active',
        startSeason: 2,
        startEpisode: 1,
        voiceStudio: 'NewStudio',
        requireRussian: true,
        waitHours: 24,
        audio: 'ru',
      })
      .run()
    pinVoice(TITLE, 1, { studio: 'LostFilm' })
    const result = await followVoiceOptions(TITLE, 2)
    expect(result).toMatchObject({ cache: 'miss', updatedAt: null })
    expect(result.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          studio: 'NewStudio',
          saved: true,
          found: false,
        }),
        expect.objectContaining({
          studio: 'LostFilm',
          inherited: true,
          found: false,
        }),
      ]),
    )
    expect(identity).not.toHaveBeenCalled()
    expect(sync).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
  })

  it('merges season and all caches, all russian tracks and packs despite original preset', async () => {
    const multi = release(
      'multi',
      'Quiet Harbor S02E01 1080p | LostFilm, NewStudio',
    )
    const other = release('other', 'Quiet Harbor S03E01 720p | LostFilm')
    const uncertain = {
      ...release('uncertain', 'Quiet Harbor S02E01 1080p | HDRezka Studio'),
      match: { confidence: 'medium' as const, issues: [] },
    }
    await cachedSearch(`${TITLE}:2`, async () => ({
      releases: [multi],
      unmatched: [],
      failed: [],
      indexerCount: 2,
    }))
    await cachedSearch(`${TITLE}:all`, async () => ({
      releases: [multi, other, uncertain],
      unmatched: [],
      failed: [{ id: 'broken', name: 'Indexer B', kind: 'unreachable' }],
      indexerCount: 2,
    }))
    peekSearch(`${TITLE}:all`)!.updatedAt = new Date(
      Date.now() - SEARCH_TTL_MS - 100,
    )
    peekSearch(`${TITLE}:2`)!.updatedAt = new Date(
      Date.now() - SEARCH_TTL_MS - 100,
    )
    const result = await followVoiceOptions(TITLE, 2)
    expect(result).toMatchObject({
      cache: 'hit',
      stale: true,
      indexerCount: 2,
    })
    expect(result.failed).toHaveLength(1)
    expect(result.items.map(item => [item.studio, item.count])).toEqual([
      ['LostFilm', 1],
      ['NewStudio', 1],
    ])
    expect((await followVoiceOptions(TITLE, 4)).items).toEqual([])
  })
})
