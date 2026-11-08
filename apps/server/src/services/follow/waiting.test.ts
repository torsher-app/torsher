import type { FollowPendingCandidate } from '../../db/schema.ts'
import type { EpisodeWithState } from './wanted.ts'
import { parseRelease } from '@torsher/release-parser'
import { eq } from 'drizzle-orm'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  followEpisodes,
  follows,
  indexers,
  torrents,
  trackedTopics,
} from '../../db/schema.ts'
import { followWait } from '../../dto/catalog.ts'
import { waitTargets } from './episodes.ts'
import { pendingOf } from './grab.ts'
import { followStatus, waitingStatus } from './status.ts'
import { trackTopic } from './topics.ts'

const NOW = new Date('2026-11-08T12:00:00Z')
const candidate: FollowPendingCandidate = {
  id: 'selected',
  title: 'Quiet Harbor S02 (1-8 of 12) 720p',
  seeders: 5,
  quality: '720p',
  studio: 'Studio A',
  voiceType: 'DVO',
  language: 'original',
}

beforeAll(() => migrateDb())
beforeEach(() => {
  const db = getDb()
  db.delete(follows).run()
  db.delete(trackedTopics).run()
  db.delete(torrents).run()
  db.delete(indexers).run()
  db.insert(follows)
    .values({
      id: 'follow',
      titleId: 'tmdb:tv:1',
      kind: 'series',
      state: 'active',
      startSeason: 2,
      startEpisode: 1,
      requireRussian: false,
      waitHours: 24,
    })
    .run()
})

function pending(episode = 8) {
  getDb()
    .insert(followEpisodes)
    .values({
      followId: 'follow',
      season: 2,
      episode,
      firstSeenAt: NOW,
      waitUntil: NOW,
      pending: candidate,
      decisions: [
        {
          ...candidate,
          id: 'other',
          indexers: [],
          verdict: 'pending',
          rejections: [
            { code: 'wait', type: 'temporary', params: { studio: 'Wrong' } },
          ],
        },
        {
          ...candidate,
          indexers: [],
          verdict: 'pending',
          rejections: [
            {
              code: 'wait',
              type: 'temporary',
              params: { quality: '1080p', studio: 'Studio B' },
            },
          ],
        },
      ],
    })
    .run()
}

describe('saved waiting candidate', () => {
  it('uses the selected pending and its matching decision', () => {
    pending()
    const wait = waitTargets('follow').get('2:8')!
    expect(wait).toMatchObject({
      quality: '1080p',
      studio: 'Studio B',
      candidate: {
        quality: '720p',
        studio: 'Studio A',
        voiceType: 'DVO',
        language: 'original',
      },
    })
    expect(wait.candidate).not.toHaveProperty('title')
    expect(followWait.parse(wait).candidate?.language).toBe('original')
  })

  it('reads legacy JSON without inventing language or targets from another pending', () => {
    pending()
    getDb()
      .update(followEpisodes)
      .set({
        pending: {
          id: 'legacy',
          title: 'Quiet Harbor S02E08',
          seeders: 1,
          quality: '720p',
        },
      })
      .run()
    expect(waitTargets('follow').get('2:8')).toEqual({
      until: NOW.toISOString(),
      quality: undefined,
      studio: undefined,
      language: undefined,
      voiceType: undefined,
      candidate: {
        quality: '720p',
        studio: undefined,
        language: undefined,
        voiceType: undefined,
      },
    })
  })

  it('shares nearest waiting selection and ignores no-space deadlines', () => {
    pending()
    const states: EpisodeWithState[] = [
      {
        season: 2,
        episode: 7,
        state: 'no_space',
        aired: true,
        waitUntil: new Date(NOW.getTime() - 1000),
      },
      {
        season: 2,
        episode: 9,
        state: 'waiting',
        aired: true,
        waitUntil: new Date(NOW.getTime() + 1000),
      },
      { season: 2, episode: 8, state: 'waiting', aired: true, waitUntil: NOW },
    ]
    const follow = getDb().select().from(follows).get()!
    const wait = waitingStatus('follow', states)
    expect(wait?.episode).toBe(8)
    expect(followStatus(follow, states).waiting).toEqual(wait)
    expect(waitingStatus('follow', [])).toBeUndefined()
  })

  it('keeps movie 0/0 references and tolerates waiting without a snapshot', () => {
    expect(
      waitingStatus('follow', [
        {
          season: 0,
          episode: 0,
          state: 'waiting',
          aired: true,
          waitUntil: NOW,
        },
      ]),
    ).toEqual({
      season: 0,
      episode: 0,
      until: NOW.toISOString(),
    })
  })

  it('persists the actual ranked audio language', () => {
    expect(
      pendingOf({
        id: 'ranked',
        title: 'Quiet Harbor',
        seeders: 1,
        indexers: [],
        parsed: parseRelease('Quiet Harbor'),
        match: { confidence: 'high', issues: [] },
        audioLanguage: 'original',
      }).language,
    ).toBe('original')
    expect(
      pendingOf({
        id: 'old',
        title: 'Quiet Harbor',
        seeders: 1,
        indexers: [],
        parsed: parseRelease('Quiet Harbor'),
        match: { confidence: 'high', issues: [] },
      }).language,
    ).toBeUndefined()
  })
})

describe('topic version time', () => {
  it('preserves updatedAt for the same hash and advances it for a new version', () => {
    const db = getDb()
    const follow = db.select().from(follows).get()!
    const indexer = db
      .insert(indexers)
      .values({ name: 'Test', url: 'https://indexer.example' })
      .returning()
      .get()
    const torrent = db
      .insert(torrents)
      .values({
        infoHash: 'a'.repeat(40),
        name: 'Quiet Harbor',
        source: 'file',
        status: 'ready',
      })
      .returning()
      .get()
    const topicCandidate = {
      ...candidate,
      title: 'Quiet Harbor / Сезон: 2 / Серии: 1-8 из 12 (2024) WEB-DL 720p',
      indexerId: indexer.id,
      detailsUrl: 'https://indexer.example/topic/1',
    }
    trackTopic(follow, torrent, topicCandidate, 2, NOW)
    const later = new Date(NOW.getTime() + 1000)
    trackTopic(follow, torrent, topicCandidate, 2, later)
    expect(db.select().from(trackedTopics).get()).toMatchObject({
      updatedAt: NOW,
      lastSeenAt: later,
    })
    db.update(torrents)
      .set({ infoHash: 'b'.repeat(40) })
      .where(eq(torrents.id, torrent.id))
      .run()
    trackTopic(
      follow,
      { ...torrent, infoHash: 'b'.repeat(40) },
      topicCandidate,
      2,
      later,
    )
    expect(db.select().from(trackedTopics).get()?.updatedAt).toEqual(later)
  })
})
