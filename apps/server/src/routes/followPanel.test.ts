import type { FollowDecision } from '../db/schema.ts'
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
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  followEpisodes,
  followHistory,
  follows,
  indexerManagers,
  indexers,
  metaCache,
  releaseBlocklist,
  serverSettings,
  torrents,
  users,
} from '../db/schema.ts'
import { resetServerAudioGuess } from '../services/follow/audio.ts'
import { recordHistory } from '../services/follow/history.ts'
import {
  requestedSearch,
  resetFollowSearch,
} from '../services/follow/search.ts'
import { localDay } from '../services/follow/wanted.ts'
import { tvOngoing } from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const SERIES = 'tmdb:tv:3100'
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const HASH_A = 'a'.repeat(40)
const HASH_B = 'b'.repeat(40)

function day(offset: number) {
  return localDay(new Date(Date.now() + offset * DAY_MS))
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Идёт второй сезон: вышли 4 серии из 10, пятая выйдет через 4 дня
function series() {
  return {
    ...tvOngoing,
    id: 3100,
    name: 'Тихая гавань',
    original_name: 'Quiet Harbor',
    original_language: 'en',
    last_episode_to_air: {
      season_number: 2,
      episode_number: 4,
      air_date: day(-3),
    },
    next_episode_to_air: {
      season_number: 2,
      episode_number: 5,
      air_date: day(4),
    },
    seasons: [
      { season_number: 1, name: 'S1', episode_count: 8, air_date: day(-400) },
      { season_number: 2, name: 'S2', episode_count: 10, air_date: day(-24) },
    ],
  }
}

function season2() {
  return {
    season_number: 2,
    name: 'S2',
    episodes: Array.from({ length: 10 }, (_, index) => ({
      episode_number: index + 1,
      name: `Episode ${index + 1}`,
      overview: 'Overview',
      air_date: day(-24 + index * 7),
      runtime: 50,
    })),
  }
}

async function followSeries() {
  const res = await app.inject({
    method: 'PUT',
    url: `/api/titles/${SERIES}/follow?language=ru-RU`,
    cookies: owner,
    payload: {},
  })

  expect(res.statusCode).toBe(200)

  const id = res.json().follow.id as string

  // Курсор с начала сезона: снимки вышедших серий
  getDb()
    .update(follows)
    .set({ startSeason: 2, startEpisode: 1 })
    .where(eq(follows.id, id))
    .run()
  return id
}

function decision(
  infoHash: string,
  verdict: FollowDecision['verdict'],
  rejections: FollowDecision['rejections'] = [],
): FollowDecision {
  return {
    id: `release-${infoHash[0]}`,
    title: `Quiet.Harbor.S02E03.1080p.${infoHash[0]}`,
    infoHash,
    indexers: ['Indexer'],
    size: 2_000_000_000,
    seeders: 12,
    quality: '1080p',
    studio: 'Studio A',
    verdict,
    rejections,
  }
}

const HASHLESS_A: FollowDecision = {
  id: 'hashless-a',
  title:
    'Тихая гавань / Quiet Harbor / Сезон: 2 / Серия: 3 из 10 (2024) WEB-DL 720p',
  indexers: ['Indexer A'],
  size: 1_400_000_000,
  seeders: 5,
  verdict: 'pending',
  rejections: [],
}
const HASHLESS_B: FollowDecision = {
  id: 'hashless-b',
  title:
    'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-4 из 10 (2024) WEB-DL 720p',
  indexers: ['Indexer B'],
  size: 5_600_000_000,
  seeders: 9,
  verdict: 'rejected',
  rejections: [{ code: 'blocklisted', type: 'permanent' }],
}

function pendingEpisode(followId: string, episode: number, until: Date) {
  getDb()
    .insert(followEpisodes)
    .values({
      followId,
      season: 2,
      episode,
      firstSeenAt: new Date(until.getTime() - 24 * HOUR_MS),
      waitUntil: until,
      pending: {
        id: 'release-a',
        title: 'Quiet.Harbor.S02E03.720p',
        infoHash: HASH_A,
        seeders: 5,
        size: 1_500_000_000,
      },
      decisions: [
        decision(HASH_A, 'pending', [
          {
            code: 'wait',
            type: 'temporary',
            params: { until: until.toISOString(), studio: 'Studio B' },
          },
        ]),
        decision(HASH_B, 'rejected', [
          { code: 'no_russian', type: 'permanent' },
        ]),
      ],
    })
    .run()
}

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({
      id: 'owner',
      username: 'Owner',
      passwordHash: 'hash',
    })
    .run()
  await app.inject({ url: '/api/profiles', cookies: owner })
})

beforeEach(() => {
  getDb().delete(follows).run()
  getDb().delete(followHistory).run()
  getDb().delete(releaseBlocklist).run()
  getDb().delete(torrents).run()
  getDb().delete(metaCache).run()
  getDb().delete(serverSettings).run()
  resetServerAudioGuess()
  resetFollowSearch()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    if (url.pathname === '/3/tv/3100')
      return json(series())

    if (url.pathname === '/3/tv/3100/season/2')
      return json(season2())

    return json({ status_message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('настройки «Слежу»', () => {
  it('умолчания, частичная правка и проверка значений', async () => {
    const initial = await app.inject({
      url: '/api/settings/follow',
      cookies: owner,
    })

    expect(initial.json()).toEqual({
      rssIntervalMin: 15,
      searchesPerHour: 20,
      defaults: {
        waitHours: 24,
        movieWaitHours: 72,
        qualityPreset: 'best',
        requireRussian: 'auto',
        mode: 'download',
      },
      audio: null,
    })

    const saved = await app.inject({
      method: 'PUT',
      url: '/api/settings/follow',
      cookies: owner,
      payload: {
        searchesPerHour: 8,
        defaults: { waitHours: 6, mode: 'notify' },
      },
    })

    expect(saved.statusCode).toBe(200)
    expect(saved.json()).toMatchObject({
      rssIntervalMin: 15,
      searchesPerHour: 8,
      defaults: { waitHours: 6, movieWaitHours: 72, mode: 'notify' },
    })

    for (const payload of [
      { rssIntervalMin: 5 },
      { rssIntervalMin: 121 },
      { searchesPerHour: 0 },
      { defaults: { waitHours: 200 } },
    ]) {
      const bad = await app.inject({
        method: 'PUT',
        url: '/api/settings/follow',
        cookies: owner,
        payload,
      })

      expect(bad.statusCode).toBe(400)
    }

    const off = await app.inject({
      method: 'PUT',
      url: '/api/settings/follow',
      cookies: owner,
      payload: { rssIntervalMin: 0 },
    })

    expect(off.json().rssIntervalMin).toBe(0)
  })

  it('новое слежение берёт правила по умолчанию', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/settings/follow',
      cookies: owner,
      payload: {
        defaults: {
          waitHours: 12,
          qualityPreset: 'compact',
          requireRussian: 'never',
        },
      },
    })

    const id = await followSeries()
    const row = getDb().select().from(follows).where(eq(follows.id, id)).get()

    expect(row).toMatchObject({
      waitHours: 12,
      qualityPreset: 'compact',
      requireRussian: false,
    })
  })
})

describe('язык озвучки', () => {
  async function settings(headers: Record<string, string> = {}) {
    const res = await app.inject({
      url: '/api/settings/follow',
      cookies: owner,
      headers,
    })

    return res.json().audio
  }

  it('подбирается по первому языку браузера', async () => {
    for (const [header, value] of [
      ['de-DE,de;q=0.9,en;q=0.8', 'de'],
      ['pt-BR,pt;q=0.9', 'original'],
      ['ru', 'ru'],
      ['en;q=0.5, fr-CA', 'fr'],
    ]) {
      getDb().delete(serverSettings).run()
      resetServerAudioGuess()

      expect(await settings({ 'accept-language': header! })).toEqual({
        value,
        source: 'auto',
      })
    }
  })

  it('пока языка нет, действует `ru`; подбор не трогает выбор', async () => {
    expect(await settings()).toBeNull()

    const id = await followSeries()
    const brief = await app.inject({
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
    })

    expect(brief.json()).toMatchObject({
      audio: null,
      audioEffective: 'ru',
      audioServer: 'ru',
    })

    await app.inject({
      method: 'PUT',
      url: '/api/settings/follow',
      cookies: owner,
      payload: { audio: 'ja' },
    })
    resetServerAudioGuess()

    expect(await settings({ 'accept-language': 'de-DE' })).toEqual({
      value: 'ja',
      source: 'user',
    })

    // Догадка не перезаписывает и прежнюю догадку
    getDb().delete(serverSettings).run()
    resetServerAudioGuess()
    await settings({ 'accept-language': 'en-US' })
    resetServerAudioGuess()

    expect(await settings({ 'accept-language': 'de-DE' })).toEqual({
      value: 'en',
      source: 'auto',
    })
  })

  it('слежение без своего правила идёт за сервером, своё правило главнее', async () => {
    const id = await followSeries()
    const row = () =>
      getDb().select().from(follows).where(eq(follows.id, id)).get()

    // Новое слежение и прежние после миграции — «как у сервера»
    expect(row()?.audio).toBeNull()

    await app.inject({
      method: 'PUT',
      url: '/api/settings/follow',
      cookies: owner,
      payload: { audio: 'original' },
    })

    const server = await app.inject({
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
    })

    expect(server.json()).toMatchObject({
      audio: null,
      audioEffective: 'original',
    })

    const own = await app.inject({
      method: 'PATCH',
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
      payload: { audio: 'de' },
    })

    expect(own.json()).toMatchObject({
      audio: 'de',
      audioEffective: 'de',
      audioServer: 'original',
    })
    expect(row()?.audio).toBe('de')

    const back = await app.inject({
      method: 'PATCH',
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
      payload: { audio: null },
    })

    expect(back.json()).toMatchObject({
      audio: null,
      audioEffective: 'original',
    })
  })
})

describe('«Искать сейчас»', () => {
  it('ставит поиск в очередь; на паузе — 409, чужой id — 404', async () => {
    const id = await followSeries()
    const res = await app.inject({
      method: 'POST',
      url: `/api/follows/${id}/search`,
      cookies: owner,
    })

    expect(res.statusCode).toBe(200)
    expect(requestedSearch(id)).toBe('manual')

    const details = await app.inject({
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
    })

    expect(details.json()).toMatchObject({
      searchRequested: true,
      lastSearchAt: null,
    })

    getDb()
      .update(follows)
      .set({ state: 'paused' })
      .where(eq(follows.id, id))
      .run()

    const paused = await app.inject({
      method: 'POST',
      url: `/api/follows/${id}/search`,
      cookies: owner,
    })

    expect(paused.statusCode).toBe(409)

    const missing = await app.inject({
      method: 'POST',
      url: '/api/follows/nope/search',
      cookies: owner,
    })

    expect(missing.statusCode).toBe(404)
  })
})

describe('снимок кандидатов и чёрный список', () => {
  it('«Не брать эту раздачу» снимает отложенного и пишет историю', async () => {
    const id = await followSeries()
    const until = new Date(Date.now() + 5 * HOUR_MS)

    pendingEpisode(id, 3, until)

    const details = await app.inject({
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
    })
    const episode = details
      .json()
      .episodes
      .find((item: { episode: number }) => item.episode === 3)

    expect(episode).toMatchObject({ state: 'waiting', candidates: 2 })
    expect(details.json().counts).toMatchObject({ waiting: 1 })
    expect(details.json().waitUntil).toBe(until.toISOString())

    const snapshot = await app.inject({
      url: `/api/follows/${id}/candidates?season=2&episode=3`,
      cookies: owner,
    })

    expect(snapshot.json().items).toHaveLength(2)
    expect(snapshot.json().items[0]).toMatchObject({
      verdict: 'pending',
      blocked: false,
    })

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/follow/blocklist',
      cookies: owner,
      payload: { followId: id, candidateId: 'release-a' },
    })

    expect(blocked.statusCode).toBe(200)

    const row = getDb()
      .select()
      .from(followEpisodes)
      .where(eq(followEpisodes.followId, id))
      .get()!

    expect(row.pending).toBeNull()
    expect(row.waitUntil).toBeNull()
    expect(row.decisions![0]).toMatchObject({
      verdict: 'rejected',
      rejections: expect.arrayContaining([
        { code: 'blocklisted', type: 'permanent' },
      ]),
    })

    const after = await app.inject({
      url: `/api/follows/${id}/candidates?season=2&episode=3`,
      cookies: owner,
    })

    expect(after.json().items[0].blocked).toBe(true)

    const list = await app.inject({
      url: '/api/follow/blocklist',
      cookies: owner,
    })

    expect(list.json().items).toEqual([
      expect.objectContaining({
        infoHash: HASH_A,
        reason: 'user',
        expiresAt: null,
        titleId: SERIES,
      }),
    ])

    const history = await app.inject({
      url: `/api/follow/activity?follow=${id}&kind=blocklisted`,
      cookies: owner,
    })

    expect(history.json().items).toEqual([
      expect.objectContaining({
        season: 2,
        episodes: [3],
        params: { reason: 'user' },
      }),
    ])

    const entry = list.json().items[0].id
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/follow/blocklist/${entry}`,
      cookies: owner,
    })

    expect(removed.statusCode).toBe(200)

    const again = await app.inject({
      method: 'DELETE',
      url: `/api/follow/blocklist/${entry}`,
      cookies: owner,
    })

    expect(again.statusCode).toBe(404)
  })

  it('раздачи нет в снимке — 404', async () => {
    const id = await followSeries()
    const res = await app.inject({
      method: 'POST',
      url: '/api/follow/blocklist',
      cookies: owner,
      payload: { followId: id, candidateId: 'release-c' },
    })

    expect(res.statusCode).toBe(404)
  })

  it('раздача без infohash: в списке по показу, «Не брать» запрещает её показы', async () => {
    const id = await followSeries()
    const until = new Date(Date.now() + 5 * HOUR_MS)
    const page = 'https://tracker.example/topic/42'

    getDb()
      .insert(followEpisodes)
      .values({
        followId: id,
        season: 2,
        episode: 3,
        firstSeenAt: new Date(until.getTime() - 24 * HOUR_MS),
        waitUntil: until,
        pending: {
          id: 'hashless-a',
          title: HASHLESS_A.title,
          indexerId: 'ix-a',
          detailsUrl: page,
          seeders: 5,
          size: HASHLESS_A.size,
        },
        decisions: [
          { ...HASHLESS_A, sources: [{ id: 'ix-a', detailsUrl: page }] },
          { ...HASHLESS_B, sources: [{ id: 'ix-b' }] },
        ],
      })
      .run()
    getDb()
      .insert(releaseBlocklist)
      .values({
        titleId: SERIES,
        releaseTitle: HASHLESS_B.title,
        reason: 'failed_check',
        listings: [
          { indexerId: 'ix-b', title: HASHLESS_B.title, size: HASHLESS_B.size },
        ],
        episodes: ['2:3'],
        createdAt: new Date(),
      })
      .run()

    const candidates = async () =>
      (
        await app.inject({
          url: `/api/follows/${id}/candidates?season=2&episode=3`,
          cookies: owner,
        })
      ).json().items

    expect(await candidates()).toEqual([
      expect.objectContaining({ id: 'hashless-a', blocked: false }),
      expect.objectContaining({ id: 'hashless-b', blocked: true }),
    ])
    expect((await candidates())[0]).not.toHaveProperty('sources')

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/follow/blocklist',
      cookies: owner,
      payload: { followId: id, candidateId: 'hashless-a' },
    })

    expect(blocked.statusCode).toBe(200)
    expect((await candidates())[0]).toMatchObject({
      verdict: 'rejected',
      blocked: true,
    })

    const row = getDb()
      .select()
      .from(followEpisodes)
      .where(eq(followEpisodes.followId, id))
      .get()!

    expect(row.pending).toBeNull()

    const list = await app.inject({
      url: '/api/follow/blocklist',
      cookies: owner,
    })

    expect(list.json().items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          infoHash: null,
          releaseTitle: HASHLESS_A.title,
          reason: 'user',
          episodes: null,
        }),
        expect.objectContaining({
          infoHash: null,
          reason: 'failed_check',
          episodes: [{ season: 2, episode: 3 }],
        }),
      ]),
    )
  })

  it('кандидат без infohash из снимка прежней версии — 409', async () => {
    const id = await followSeries()

    getDb()
      .insert(followEpisodes)
      .values({
        followId: id,
        season: 2,
        episode: 3,
        firstSeenAt: new Date(),
        decisions: [HASHLESS_A],
      })
      .run()

    const res = await app.inject({
      method: 'POST',
      url: '/api/follow/blocklist',
      cookies: owner,
      payload: { followId: id, candidateId: 'hashless-a' },
    })

    expect(res.statusCode).toBe(409)
    expect(res.json()).toMatchObject({ message: 'release_unknown' })
  })
})

describe('очередь', () => {
  it('отложенные, ждущие места и закачки автоматики; остановленные — нет', async () => {
    const id = await followSeries()
    const until = new Date(Date.now() + 5 * HOUR_MS)

    pendingEpisode(id, 3, until)
    getDb()
      .insert(followEpisodes)
      .values({
        followId: id,
        season: 2,
        episode: 4,
        firstSeenAt: new Date(),
        stateNote: 'no_space',
        pending: {
          id: 'release-c',
          title: 'Quiet.Harbor.S02E04.1080p',
          seeders: 3,
          size: 4_000_000_000,
        },
      })
      .run()

    const torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: 'd'.repeat(40),
        name: 'Quiet.Harbor.S02E01-02.1080p',
        source: 'magnet',
        status: 'ready',
        titleId: SERIES,
        retention: 'keep',
        origin: 'follow',
        files: [
          { path: 'E01.mkv', size: 1000, padding: false },
          { path: 'E02.mkv', size: 3000, padding: false },
        ],
        selectedFiles: [0, 1],
      })
      .returning()
      .get()

    for (const [episode, fileIndex] of [
      [1, 0],
      [2, 1],
    ] as const) {
      getDb()
        .insert(followEpisodes)
        .values({
          followId: id,
          season: 2,
          episode,
          firstSeenAt: new Date(),
          torrentId: torrent.id,
          fileIndex,
          grabbedAt: new Date(),
        })
        .run()
    }

    const res = await app.inject({ url: '/api/follow/queue', cookies: owner })

    expect(res.json().items).toEqual([
      expect.objectContaining({
        kind: 'no_space',
        episodes: [4],
        size: 4_000_000_000,
      }),
      expect.objectContaining({
        kind: 'downloading',
        episodes: [1, 2],
        releaseTitle: 'Quiet.Harbor.S02E01-02.1080p',
        size: 4000,
        progress: null,
        resolving: false,
      }),
      expect.objectContaining({
        kind: 'pending',
        episodes: [3],
        until: until.toISOString(),
        waitFor: { studio: 'Studio B' },
        followState: 'active',
      }),
    ])

    getDb()
      .update(follows)
      .set({ state: 'stopped' })
      .where(eq(follows.id, id))
      .run()

    const stopped = await app.inject({
      url: '/api/follow/queue',
      cookies: owner,
    })

    expect(stopped.json().items).toEqual([])
  })
})

describe('история', () => {
  it('свежие сверху, фильтры и порции по курсору', async () => {
    const id = await followSeries()
    const base = Date.now() - 10 * HOUR_MS

    for (let index = 0; index < 5; index++) {
      recordHistory(
        {
          followId: id,
          titleId: SERIES,
          kind: index % 2 ? 'search' : 'found',
          season: 2,
          episodes: [index + 1],
          indexerId: 'gone',
          params: { found: index },
        },
        new Date(base + index * HOUR_MS),
      )
    }

    const first = await app.inject({
      url: '/api/follow/activity?limit=2',
      cookies: owner,
    })

    expect(first.json().hasMore).toBe(true)
    expect(
      first
        .json()
        .items.map((item: { episodes: number[] }) => item.episodes[0]),
    ).toEqual([5, 4])
    expect(first.json().items[0].indexer).toBeNull()

    const next = await app.inject({
      url: `/api/follow/activity?limit=2&before=${first.json().items[1].id}`,
      cookies: owner,
    })

    expect(
      next.json().items.map((item: { episodes: number[] }) => item.episodes[0]),
    ).toEqual([3, 2])

    const found = await app.inject({
      url: '/api/follow/activity?kind=found',
      cookies: owner,
    })

    expect(found.json()).toMatchObject({ hasMore: false })
    expect(found.json().items).toHaveLength(3)

    const other = await app.inject({
      url: '/api/follow/activity?follow=other',
      cookies: owner,
    })

    expect(other.json().items).toEqual([])
  })
})

describe('«похоже, не уверены»', () => {
  function unsure(followId: string, title: string) {
    recordHistory({
      followId,
      titleId: SERIES,
      kind: 'unsure',
      season: 2,
      releaseTitle: title,
      params: {
        issues: ['year'],
        candidate: {
          id: title,
          title,
          seeders: 4,
          magnet:
            'magnet:?xt=urn:btih:0000000000000000000000000000000000000000',
        },
      },
    })
  }

  it('требует внимания, пока не ответили; «Это он» и «Не он»', async () => {
    const id = await followSeries()

    // На паузе «Это он» только запоминает название: решатель ждёт возобновления
    getDb()
      .update(follows)
      .set({ state: 'paused' })
      .where(eq(follows.id, id))
      .run()
    unsure(id, 'Quiet.Harbour.S02E05.1080p')
    unsure(id, 'Quiet.Harbor.Story.S02E05.720p')

    const list = await app.inject({
      url: '/api/follows?language=ru-RU',
      cookies: owner,
    })

    expect(list.json().items[0].unsure).toBe(2)

    const activity = await app.inject({
      url: `/api/follow/activity?kind=unsure`,
      cookies: owner,
    })
    const [first, second] = activity.json().items

    expect(first.params).toEqual({ issues: ['year'] })

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/follow/unsure/${first.id}/confirm`,
      cookies: owner,
    })

    expect(confirmed.statusCode).toBe(200)

    const dismissed = await app.inject({
      method: 'POST',
      url: `/api/follow/unsure/${second.id}/dismiss`,
      cookies: owner,
    })

    expect(dismissed.statusCode).toBe(200)

    const after = await app.inject({
      url: `/api/follow/activity?kind=unsure`,
      cookies: owner,
    })

    expect(
      after
        .json()
        .items.map((item: { params: Record<string, unknown> }) =>
          Object.keys(item.params).sort(),
        ),
    ).toEqual(
      expect.arrayContaining([
        ['confirmedAt', 'issues'],
        ['dismissedAt', 'issues'],
      ]),
    )

    const details = await app.inject({
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
    })

    expect(details.json().unsure).toBe(0)

    const missing = await app.inject({
      method: 'POST',
      url: `/api/follow/unsure/${first.id.slice(0, -1)}x/confirm`,
      cookies: owner,
    })

    expect(missing.statusCode).toBe(404)
  })
})

describe('лента индексатора', () => {
  it('ручной включается и выключается; у Prowlarr её задаёт Prowlarr', async () => {
    getDb().delete(indexers).run()
    getDb().delete(indexerManagers).run()

    const manual = getDb()
      .insert(indexers)
      .values({
        name: 'Manual',
        url: 'https://indexer.example/api',
        rssFailures: 3,
        rssCheckedAt: new Date('2026-10-20T10:00:00Z'),
      })
      .returning()
      .get()
    const manager = getDb()
      .insert(indexerManagers)
      .values({
        kind: 'prowlarr',
        url: 'https://manager.example',
        apiKey: 'secret',
      })
      .returning()
      .get()
    const synced = getDb()
      .insert(indexers)
      .values({
        name: 'Synced',
        url: 'https://manager.example/1/api',
        managerId: manager.id,
        supportsRss: true,
      })
      .returning()
      .get()

    const before = await app.inject({ url: '/api/indexers', cookies: owner })
    const manualView = before
      .json()
      .items
      .find((item: { id: string }) => item.id === manual.id)

    expect(manualView.feed).toEqual({
      supported: null,
      checkedAt: '2026-10-20T10:00:00.000Z',
      probeAt: '2026-10-27T10:00:00.000Z',
    })

    const off = await app.inject({
      method: 'PATCH',
      url: `/api/indexers/${manual.id}`,
      cookies: owner,
      payload: { feed: false },
    })

    expect(off.json().feed).toMatchObject({ supported: false, probeAt: null })

    const on = await app.inject({
      method: 'PATCH',
      url: `/api/indexers/${manual.id}`,
      cookies: owner,
      payload: { feed: true },
    })

    expect(on.json().feed.supported).toBeNull()

    const managed = await app.inject({
      method: 'PATCH',
      url: `/api/indexers/${synced.id}`,
      cookies: owner,
      payload: { feed: false },
    })

    expect(managed.statusCode).toBe(400)
  })
})
