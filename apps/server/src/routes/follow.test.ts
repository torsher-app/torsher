import type { Card } from '../dto/catalog.ts'
import { randomUUID } from 'node:crypto'
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
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  devices,
  followEpisodes,
  followProfiles,
  follows,
  followSeasons,
  libraries,
  libraryFolders,
  mediaFiles,
  metaCache,
  serverSettings,
  titleProgress,
  torrents,
  users,
} from '../db/schema.ts'
import { hashToken } from '../services/devices/index.ts'
import { localDay } from '../services/follow/wanted.ts'
import {
  isNearAir,
  refreshFollowSchedules,
} from '../services/follow/tmdbRefresh.ts'
import { withPosterRatings } from '../services/mine/index.ts'
import { createProfile, deleteProfile } from '../services/profiles/index.ts'
import { pinVoice } from '../services/sources/voices.ts'
import { tvOngoing } from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const SERIES = 'tmdb:tv:3000'
const DAY_MS = 24 * 60 * 60 * 1000
const EPISODE = 50 * 60

let ownerProfile = ''
let folderId = ''

function day(offset: number) {
  return localDay(new Date(Date.now() + offset * DAY_MS))
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

// Идёт второй сезон: вышли 4 серии из 10, пятая выйдет через 4 дня, по неделе
function series() {
  return {
    ...tvOngoing,
    id: 3000,
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
      still_path: `/still${index + 1}.jpg`,
    })),
  }
}

let changes: { results: { id: number }[], total_pages: number } = {
  results: [],
  total_pages: 1,
}

function tmdbPaths() {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname)
}

// Устройство с профилем: возрастной порог — у профиля
function tv(ageLimit: 6 | 12 | 16 | 18 | null) {
  const profile = createProfile({
    name: `TV ${randomUUID()}`,
    color: 'violet',
    language: null,
    ageLimit,
  })
  const token = `token-${randomUUID()}`

  getDb()
    .insert(devices)
    .values({
      name: 'TV',
      type: 'tv',
      tokenHash: hashToken(token),
      profileId: profile.id,
    })
    .run()

  return { profileId: profile.id, cookies: { [DEVICE_TOKEN_COOKIE]: token } }
}

function follow(cookies: Record<string, string>, payload: object = {}) {
  return app.inject({
    method: 'PUT',
    url: `/api/titles/${SERIES}/follow?language=ru-RU`,
    cookies,
    payload,
  })
}

function unfollow(cookies: Record<string, string>) {
  return app.inject({
    method: 'DELETE',
    url: `/api/titles/${SERIES}/follow?language=ru-RU`,
    cookies,
  })
}

function followRow() {
  return getDb()
    .select()
    .from(follows)
    .where(eq(follows.titleId, SERIES))
    .get()
}

// Курсор слежения из прежних версий: так тесты видят вышедшие серии
function setCursor(season: number, episode: number) {
  getDb()
    .update(follows)
    .set({ startSeason: season, startEpisode: episode })
    .where(eq(follows.titleId, SERIES))
    .run()
}

function watched(profileId: string, seasonNumber: number, episode: number) {
  getDb()
    .insert(titleProgress)
    .values({
      profileId,
      titleId: SERIES,
      season: seasonNumber,
      episode,
      position: EPISODE,
      duration: EPISODE,
      watchedAt: new Date(),
    })
    .run()
}

function libraryEpisode(seasonNumber: number, episode: number) {
  getDb()
    .insert(mediaFiles)
    .values({
      folderId,
      relPath: `Quiet Harbor/Season ${seasonNumber}/E${episode}.mkv`,
      size: 1000,
      mtime: new Date(),
      titleId: SERIES,
      season: seasonNumber,
      episode,
    })
    .run()
}

function keptTorrent(files: string[], selectedFiles: number[]) {
  getDb()
    .insert(torrents)
    .values({
      infoHash: randomUUID().replaceAll('-', '').padEnd(40, '0'),
      name: 'Quiet.Harbor.S02.1080p.WEB-DL',
      source: 'magnet',
      status: 'ready',
      titleId: SERIES,
      retention: 'keep',
      files: files.map(path => ({ path, size: 1000, padding: false })),
      selectedFiles,
    })
    .run()
}

// Серия пришла: отложенный кандидат ждёт свою студию до `until`
function pendingEpisode(episode: number, until: Date) {
  getDb()
    .insert(followEpisodes)
    .values({
      followId: followRow()!.id,
      season: 2,
      episode,
      firstSeenAt: new Date(),
      waitUntil: until,
      pending: { id: 'r1', title: 'Quiet.Harbor.S02E03.720p', seeders: 5 },
      decisions: [
        {
          id: 'r1',
          title: 'Quiet.Harbor.S02E03.720p',
          indexers: ['Indexer'],
          seeders: 5,
          verdict: 'pending',
          rejections: [
            {
              code: 'wait',
              type: 'temporary',
              params: {
                until: until.toISOString(),
                studio: 'Studio One',
                quality: '1080p',
              },
            },
          ],
        },
      ],
    })
    .run()
}

function getFollow(cookies: Record<string, string>) {
  return app.inject({
    url: `/api/titles/${SERIES}/follow?language=ru-RU`,
    cookies,
  })
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

  const profiles = await app.inject({ url: '/api/profiles', cookies: owner })

  ownerProfile = profiles.json().currentId

  const library = getDb()
    .insert(libraries)
    .values({ kind: 'video', name: 'Library', managed: true })
    .returning()
    .get()

  folderId = getDb()
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: '/library' })
    .returning()
    .get()
    .id
})

beforeEach(() => {
  getDb().delete(follows).run()
  pinVoice(SERIES, 2, null)
  getDb().delete(titleProgress).run()
  getDb().delete(mediaFiles).run()
  getDb().delete(torrents).run()
  getDb().delete(metaCache).run()
  getDb().delete(serverSettings).run()
  changes = { results: [], total_pages: 1 }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))

    if (url.pathname === '/3/tv/3000')
      return json(series())

    if (url.pathname === '/3/tv/3000/season/2')
      return json(season2())

    if (url.pathname === '/3/tv/changes')
      return json({ page: Number(url.searchParams.get('page')), ...changes })

    return json({ status_message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('pUT /titles/:id/follow', () => {
  it('первая подписка создаёт слежение: только новые серии', async () => {
    const res = await follow(owner)

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      canEdit: true,
      follow: {
        kind: 'series',
        state: 'active',
        start: { season: 2, episode: 5 },
        subscribed: true,
        profileCount: 1,
        requireRussian: true,
        waitHours: 24,
        qualityPreset: 'best',
        mode: 'download',
        next: { season: 2, episode: 5, airDate: day(4) },
        ready: null,
      },
    })
    expect(res.json()).not.toHaveProperty('options')
  })

  it('смотрел — всё равно только новые серии', async () => {
    watched(ownerProfile, 1, 1)
    watched(ownerProfile, 1, 2)

    const res = await follow(owner)

    expect(res.json().follow.start).toEqual({ season: 2, episode: 5 })
  })

  it('повторная подписка и правила курсор не сдвигают', async () => {
    await follow(owner)
    setCursor(2, 1)

    expect((await follow(owner)).json().follow.start).toEqual({
      season: 2,
      episode: 1,
    })
    expect(
      (await follow(owner, { start: 'beginning', waitHours: 12 })).json().follow
        .start,
    ).toEqual({ season: 2, episode: 1 })
  })

  it('режим «Только уведомлять» и обратно', async () => {
    await follow(owner)

    expect((await follow(owner, { mode: 'notify' })).json().follow.mode).toBe(
      'notify',
    )
    expect(followRow()?.mode).toBe('notify')
  })

  it('профиль с порогом подписывается, но правила не меняет', async () => {
    const kid = tv(12)
    const res = await follow(kid.cookies)

    expect(res.statusCode).toBe(200)
    expect(res.json().canEdit).toBe(false)
    expect(res.json().follow.subscribed).toBe(true)

    for (const payload of [
      { waitHours: 12 },
      { mode: 'notify' },
      { voiceStudio: 'Studio' },
    ]) {
      const denied = await follow(kid.cookies, payload)

      expect(denied.statusCode).toBe(403)
    }

    expect(followRow()?.waitHours).toBe(24)
  })

  it('профиль без порога и владелец меняют правила', async () => {
    const adult = tv(null)
    const res = await follow(adult.cookies, {
      waitHours: 0,
      voiceStudio: 'Studio',
      voiceStrict: true,
      qualityPreset: 'compact',
    })

    expect(res.json()).toMatchObject({
      canEdit: true,
      follow: {
        waitHours: 0,
        voiceStudio: 'Studio',
        voiceStrict: true,
        qualityPreset: 'compact',
      },
    })
  })

  it('не каталожный ID — 404', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/titles/whatever/follow',
      cookies: owner,
      payload: {},
    })

    expect(res.statusCode).toBe(404)
  })
})

describe('dELETE /titles/:id/follow', () => {
  it('отписывает только свой профиль; последний останавливает слежение', async () => {
    const kid = tv(12)

    await follow(owner)
    await follow(kid.cookies)

    const left = await unfollow(kid.cookies)

    expect(left.json().follow).toMatchObject({
      state: 'active',
      subscribed: false,
      profileCount: 1,
    })

    const own = await app.inject({
      url: `/api/titles/${SERIES}/follow`,
      cookies: owner,
    })

    expect(own.json().follow.subscribed).toBe(true)

    const last = await unfollow(owner)

    expect(last.json().follow).toMatchObject({
      state: 'stopped',
      profileCount: 0,
    })
  })

  it('подписка на остановленное запускает его с новым курсором', async () => {
    await follow(owner)
    setCursor(1, 1)
    await unfollow(owner)

    const res = await follow(owner)

    expect(res.json().follow).toMatchObject({
      state: 'active',
      start: { season: 2, episode: 5 },
    })
  })
})

describe('состояния серий', () => {
  beforeEach(async () => {
    await follow(owner)
    setCursor(2, 1)
    libraryEpisode(2, 1)
    keptTorrent(['Quiet.Harbor.S02E02.mkv', 'Quiet.Harbor.S02E03.mkv'], [0])
  })

  it('панель: библиотека, закачка, нужные и будущие серии с курсора', async () => {
    const id = followRow()!.id
    const res = await app.inject({
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      title: 'Тихая гавань',
      wanted: 2,
      next: { season: 2, episode: 5, airDate: day(4) },
      profiles: [{ id: ownerProfile }],
    })
    expect(
      res
        .json()
        .episodes.slice(0, 6)
        .map((item: { episode: number, state: string }) => [
          item.episode,
          item.state,
        ]),
    ).toEqual([
      [1, 'in_library'],
      [2, 'downloading'],
      [3, 'searching'],
      [4, 'searching'],
      [5, 'upcoming'],
      [6, 'upcoming'],
    ])
  })

  it('карточка: «Следить» в деталях и состояния в сезоне', async () => {
    const details = await app.inject({
      url: `/api/catalog/titles/${SERIES}?language=ru-RU`,
      cookies: owner,
    })

    expect(details.json().follow).toMatchObject({
      state: 'active',
      subscribed: true,
      start: { season: 2, episode: 1 },
      mode: 'download',
    })

    const season = await app.inject({
      url: `/api/catalog/titles/${SERIES}/seasons/2?language=ru-RU`,
      cookies: owner,
    })
    const states = season
      .json()
      .episodes
      .map((item: { follow?: string }) => item.follow)

    expect(states.slice(0, 5)).toEqual([
      'in_library',
      'downloading',
      'searching',
      'searching',
      'upcoming',
    ])
  })

  it('карточка: статус — сезон, счётчики, озвучка и качество', async () => {
    const res = await getFollow(owner)

    expect(res.json().follow).toMatchObject({
      season: 2,
      voice: null,
      quality: { value: '1080p', lowered: false },
      waiting: null,
      counts: { downloading: 1, noSpace: 0, missing: 0, searching: 2 },
      first: {
        downloading: { season: 2, episode: 2 },
        searching: { season: 2, episode: 3 },
      },
    })
    expect(res.json().follow.first).not.toHaveProperty('missing')
  })

  it('карточка: чего ждёт отложенная серия, закреплённая студия', async () => {
    const until = new Date(Date.now() + 6 * 60 * 60 * 1000)

    pendingEpisode(3, until)
    pinVoice(SERIES, 2, { studio: 'Studio One' })

    const res = await getFollow(owner)

    expect(res.json().follow).toMatchObject({
      voice: { studio: 'Studio One', pinned: true },
      waiting: {
        season: 2,
        episode: 3,
        until: until.toISOString(),
        studio: 'Studio One',
        quality: '1080p',
      },
      counts: { searching: 1 },
      first: { searching: { season: 2, episode: 4 } },
    })

    const season = await app.inject({
      url: `/api/catalog/titles/${SERIES}/seasons/2?language=ru-RU`,
      cookies: owner,
    })
    const third = season.json().episodes[2]

    expect(third).toMatchObject({
      follow: 'waiting',
      followWait: { until: until.toISOString(), studio: 'Studio One' },
    })
    expect(season.json().episodes[3].followWait).toBeUndefined()
  })

  it('карточка: верхняя ступень не выходила три серии — cutoff ниже', async () => {
    const id = followRow()!.id

    for (const episode of [1, 2, 3]) {
      getDb()
        .insert(followEpisodes)
        .values({ followId: id, season: 2, episode, firstSeenAt: new Date() })
        .run()
    }

    getDb()
      .insert(followSeasons)
      .values({ followId: id, season: 2, bestQualitySeen: '720p' })
      .run()

    const res = await getFollow(owner)

    expect(res.json().follow.quality).toEqual({ value: '720p', lowered: true })
  })

  it('постер: «слежу» и новые скачанные серии, которые профиль не досмотрел', async () => {
    const id = followRow()!.id
    const now = new Date()

    for (const episode of [1, 2, 3]) {
      getDb()
        .insert(followEpisodes)
        .values({
          followId: id,
          season: 2,
          episode,
          firstSeenAt: now,
          downloadedAt: episode < 3 ? now : null,
        })
        .run()
    }

    watched(ownerProfile, 2, 1)

    const card: Card = {
      id: SERIES,
      kind: 'series',
      title: 'Тихая гавань',
      originalTitle: 'Quiet Harbor',
    }

    expect(withPosterRatings([card], ownerProfile)[0]).toMatchObject({
      followed: true,
      followNew: 1,
    })

    const other = withPosterRatings([card], tv(null).profileId)[0]

    expect(other?.followed).toBeUndefined()
    expect(other?.followNew).toBeUndefined()
  })

  it('курсор дальше — серии до него без состояния', async () => {
    setCursor(2, 4)

    const season = await app.inject({
      url: `/api/catalog/titles/${SERIES}/seasons/2?language=ru-RU`,
      cookies: owner,
    })
    const states = season
      .json()
      .episodes
      .map((item: { follow?: string }) => item.follow ?? null)

    expect(states.slice(0, 5)).toEqual([
      null,
      null,
      null,
      'searching',
      'upcoming',
    ])
  })
})

describe('панель «Слежу»', () => {
  it('список, пауза с правкой правил и удаление', async () => {
    await follow(owner)

    const list = await app.inject({
      url: '/api/follows?language=ru-RU',
      cookies: owner,
    })

    expect(list.json().items).toHaveLength(1)

    const id = list.json().items[0].id
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/follows/${id}?language=ru-RU`,
      cookies: owner,
      payload: { state: 'paused', waitHours: 72, mode: 'notify' },
    })

    expect(patched.statusCode).toBe(200)
    expect(patched.json()).toMatchObject({
      state: 'paused',
      waitHours: 72,
      mode: 'notify',
      start: { season: 2, episode: 5 },
    })

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/follows/${id}`,
      cookies: owner,
    })

    expect(removed.statusCode).toBe(200)
    expect(followRow()).toBeUndefined()

    const gone = await app.inject({
      url: `/api/follows/${id}`,
      cookies: owner,
    })

    expect(gone.statusCode).toBe(404)
  })

  it('устройство в панель не пускают', async () => {
    const adult = tv(null)
    const res = await app.inject({
      url: '/api/follows',
      cookies: adult.cookies,
    })

    expect(res.statusCode).toBe(401)
  })
})

describe('gET /schedule', () => {
  it('ближайшие и недавние серии того, за чем следит профиль', async () => {
    await follow(owner)
    setCursor(2, 1)

    const res = await app.inject({
      url: '/api/schedule?language=ru-RU',
      cookies: owner,
    })
    const { upcoming, recent } = res.json()

    expect(upcoming[0]).toMatchObject({
      titleId: SERIES,
      title: 'Тихая гавань',
      season: 2,
      episode: 5,
      airDate: day(4),
      followed: true,
      state: 'upcoming',
    })
    expect(recent.map((item: { episode: number }) => item.episode)).toEqual([
      4,
      3,
    ])
    expect(recent[0]).toMatchObject({ state: 'searching', airDate: day(-3) })
    expect(recent[0].studio).toBeUndefined()
    expect(recent[0].mediaFileId).toBeUndefined()
  })

  it('своя студия сезона и файл серии из библиотеки', async () => {
    await follow(owner)
    setCursor(2, 1)
    pinVoice(SERIES, 2, { studio: 'Studio One' })
    libraryEpisode(2, 4)

    const res = await app.inject({
      url: '/api/schedule?language=ru-RU',
      cookies: owner,
    })
    const [fourth] = res.json().recent

    expect(fourth).toMatchObject({
      episode: 4,
      state: 'in_library',
      studio: 'Studio One',
      mediaFileId: expect.any(String),
    })
  })

  it('без слежения и просмотров — пусто', async () => {
    const res = await app.inject({
      url: '/api/schedule',
      cookies: tv(null).cookies,
    })

    expect(res.json()).toEqual({ upcoming: [], recent: [] })
  })
})

describe('удаление профиля', () => {
  it('последний подписчик уходит — слежение останавливается', async () => {
    const kid = tv(12)

    await follow(kid.cookies)
    deleteProfile(kid.profileId)

    expect(followRow()?.state).toBe('stopped')
  })

  it('перенос в другой профиль переносит подписку', async () => {
    const kid = tv(12)

    await follow(kid.cookies)
    deleteProfile(kid.profileId, ownerProfile)

    expect(followRow()?.state).toBe('active')
    expect(
      getDb()
        .select()
        .from(followProfiles)
        .all()
        .map(row => row.profileId),
    ).toEqual([ownerProfile])
  })
})

describe('обновление расписания TMDB', () => {
  it('серия рядом — детали и сезон раз в 12 ч на языках кэша', async () => {
    await follow(owner)
    fetchMock.mockClear()

    const now = new Date()

    await refreshFollowSchedules(now)

    expect(tmdbPaths()).toEqual(['/3/tv/3000', '/3/tv/3000/season/2'])
    expect(
      new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('language'),
    ).toBe('ru-RU')
    expect(followRow()?.scheduleRefreshedAt?.getTime()).toBe(now.getTime())

    fetchMock.mockClear()
    await refreshFollowSchedules(new Date(now.getTime() + 60 * 60 * 1000))

    expect(tmdbPaths()).toEqual([])
  })

  it('раз в сутки — детали изменившихся в TMDB', async () => {
    const now = new Date()

    await follow(owner)
    // Принудительное обновление ещё не пора: проверяется только проход изменений
    getDb()
      .update(follows)
      .set({ scheduleRefreshedAt: new Date(now.getTime() + DAY_MS) })
      .run()

    fetchMock.mockClear()
    // Первый проход только запоминает время
    await refreshFollowSchedules(now)
    expect(tmdbPaths()).toEqual([])

    changes = { results: [{ id: 1 }, { id: 3000 }], total_pages: 1 }
    await refreshFollowSchedules(new Date(now.getTime() + DAY_MS))

    expect(tmdbPaths()).toEqual(['/3/tv/changes', '/3/tv/3000'])

    fetchMock.mockClear()
    await refreshFollowSchedules(new Date(now.getTime() + DAY_MS + 60_000))
    expect(tmdbPaths()).toEqual([])
  })

  it('без активных слежений TMDB не трогается', async () => {
    await follow(owner)
    await unfollow(owner)
    fetchMock.mockClear()

    await refreshFollowSchedules()

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('рядом — серия в ближайшие двое суток или за последние 14 дней', () => {
    const now = new Date()

    expect(isNearAir({ next: { airDate: day(2) } }, now)).toBe(true)
    expect(isNearAir({ next: { airDate: day(3) } }, now)).toBe(false)
    expect(isNearAir({ last: { airDate: day(-14) } }, now)).toBe(true)
    expect(isNearAir({ last: { airDate: day(-15) } }, now)).toBe(false)
    expect(isNearAir({}, now)).toBe(false)
  })
})
