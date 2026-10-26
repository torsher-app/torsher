import type { Follow } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import { Buffer } from 'node:buffer'
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
import { createApp } from '../../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  followEpisodes,
  followHistory,
  followProfiles,
  follows,
  followSeasons,
  indexers,
  libraries,
  libraryFolders,
  mediaFiles,
  metaCache,
  notifications,
  profiles,
  releaseBlocklist,
  titleProgress,
  titleVoices,
  torrents,
  trackedTopics,
  users,
} from '../../db/schema.ts'
import { parseRelease } from '@torsher/release-parser'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import { sampleTorrentFile } from '../engine/fixtures/index.ts'
import { logFor } from '../logs/index.ts'
import { clearSearchCache } from '../sources/cache.ts'
import { tvOngoing } from '../tmdb/fixtures/index.ts'
import { pinVoice } from '../sources/voices.ts'
import { confirmUnsure } from './feed.ts'
import {
  continueGrabs,
  pendingMagnet,
  pendingOf,
  resetGrabRetries,
} from './grab.ts'
import { purgeHistory } from './history.ts'
import { followById, updateFollow } from './index.ts'
import { followStates, grabPending, reportMissing } from './pass.ts'
import { followNewEpisodes } from './badges.ts'
import { openPick, PickError, settlePicks } from './pick.ts'
import { followAutomation, followTick, underFollowLock } from './schedule.ts'
import {
  requestedSearch,
  requestFollowSearch,
  resetFollowSearch,
} from './search.ts'
import { checkStalled, resetStallTracking, STALL_AFTER_MS } from './stalled.ts'
import { signToken } from '../../utils/token.ts'
import { localDay } from './wanted.ts'

const disk = vi.hoisted(() => ({ total: 1024 ** 4, free: 512 * 1024 ** 3 }))

vi.mock('../storage/disk.ts', () => ({
  diskUsage: async () => ({ ...disk }),
}))

const SERIES = 'tmdb:tv:3000'
const GB = 1024 ** 3
const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const PACK_HASH = 'a'.repeat(40)
const SINGLE_HASH = 'b'.repeat(40)
const PARTIAL_HASH = 'c'.repeat(40)
const EPISODE_8_TITLE
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | LostFilm'
const fetchMock = vi.fn<typeof fetch>()

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function day(offset: number) {
  return localDay(new Date(Date.now() + offset * DAY_MS))
}

// Идёт второй сезон из 12 серий: вышли 1–8, последняя — вчера
function series() {
  return {
    ...tvOngoing,
    id: 3000,
    name: 'Тихая гавань',
    original_name: 'Quiet Harbor',
    original_language: 'en',
    first_air_date: '2023-05-01',
    status: 'Returning Series',
    last_episode_to_air: {
      season_number: 2,
      episode_number: 8,
      air_date: day(-1),
    },
    next_episode_to_air: {
      season_number: 2,
      episode_number: 9,
      air_date: day(6),
    },
    seasons: [
      {
        season_number: 1,
        name: 'S1',
        episode_count: 8,
        air_date: '2023-05-01',
      },
      { season_number: 2, name: 'S2', episode_count: 12, air_date: day(-50) },
    ],
  }
}

function season2() {
  return {
    season_number: 2,
    name: 'S2',
    episodes: Array.from({ length: 12 }, (_, index) => ({
      episode_number: index + 1,
      name: `Episode ${index + 1}`,
      air_date: day(-1 - (7 - index) * 7),
      runtime: 50,
    })),
  }
}

interface Item {
  title: string
  hash: string
  seeders?: number
  size?: number
  /** Только ссылка на `.torrent`, без infohash */
  noHash?: boolean
  /** Страница раздачи; по умолчанию — по infohash */
  page?: string
}

function searchXml(items: Item[]) {
  const body = items
    .map(
      item => `<item>
  <title>${item.title}</title>
  <guid>${item.page ?? `https://tracker.example/topic/${item.hash.slice(0, 4)}`}</guid>
  <comments>${item.page ?? `https://tracker.example/topic/${item.hash.slice(0, 4)}`}</comments>
  <link>https://a.indexer.example/download/${item.hash}</link>
  <size>${item.size ?? 12 * GB}</size>
  <torznab:attr name="seeders" value="${item.seeders ?? 30}" />
  ${item.noHash ? '' : `<torznab:attr name="infohash" value="${item.hash}" />`}
</item>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${body}</channel></rss>`
}

/** Раздача в движке: серии второго сезона по одной в файле */
function details(hash: string, name: string, episodes: number[]) {
  return {
    infoHash: hash,
    name,
    pieceLength: 4_194_304,
    pieceCount: 100,
    files: episodes.map(number => ({
      path: `${name}/Quiet.Harbor.S02E0${number}.1080p.WEB-DL.mkv`,
      length: 1.5 * GB,
      padding: false,
    })),
  }
}

const PACK_TITLE
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 12 (2024) WEB-DL 1080p | LostFilm'
const pack = details(
  PACK_HASH,
  'Quiet.Harbor.S02.1080p',
  [1, 2, 3, 4, 5, 6, 7, 8],
)
const single = details(SINGLE_HASH, 'Quiet.Harbor.S02E08.1080p', [8])
// В паке «1–8» лежат только шесть серий
const partial = details(
  PARTIAL_HASH,
  'Quiet.Harbor.S02.1080p',
  [1, 2, 3, 4, 5, 6],
)

let items: Item[] = []
let live: EngineTorrentState[] = []
let inspected = pack
let indexerSearches = 0
let indexerRequests = 0
let torrentDownloads = 0
let onIndexerSearch: (() => void) | undefined
let downloadFailure: Response | undefined
let enginePuts: { path: string, body: unknown }[] = []
let engineAdds: string[] = []

let folderId = ''

function liveOf(hash: string, wantedCompleted: number): EngineTorrentState {
  return {
    infoHash: hash,
    paused: false,
    selected: [5, 6, 7],
    bytesCompleted: wantedCompleted,
    bytesWanted: 4.5 * GB,
    wantedCompleted,
    queued: false,
    seeding: false,
    uploaded: 0,
    peers: { connected: 0, found: 3 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    fileProgress: [0, 0, 0, 0, 0, 0, 0, 0],
  }
}

function insertFollow(values: Partial<Follow> = {}) {
  return getDb()
    .insert(follows)
    .values({
      titleId: SERIES,
      kind: 'series',
      state: 'active',
      startSeason: 2,
      startEpisode: 1,
      requireRussian: true,
      waitHours: 24,
      ...values,
    })
    .returning()
    .get()
}

function libraryEpisodes(...numbers: number[]) {
  for (const episode of numbers) {
    getDb()
      .insert(mediaFiles)
      .values({
        folderId,
        relPath: `Quiet Harbor/Season 02/E${episode}.mkv`,
        size: 1000,
        mtime: new Date(),
        titleId: SERIES,
        season: 2,
        episode,
      })
      .run()
  }
}

function rows(followId: string) {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, followId))
    .all()
    .sort((a, b) => a.episode - b.episode)
}

function inbox() {
  return getDb()
    .select()
    .from(notifications)
    .all()
    .map(row => ({ kind: row.kind, params: row.params }))
}

function historyKinds(followId: string) {
  return getDb()
    .select()
    .from(followHistory)
    .where(eq(followHistory.followId, followId))
    .all()
    .map(row => row.kind)
}

const app = createApp()
const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({
      id: 'owner',
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'hash',
    })
    .run()
  await app.inject({ url: '/api/profiles', cookies: owner })
  getDb()
    .insert(indexers)
    .values({
      name: 'Indexer A',
      url: 'https://a.indexer.example/torznab',
      caps: {
        search: { available: true, params: ['q'] },
        tvSearch: { available: true, params: ['q'] },
        movieSearch: { available: false, params: [] },
        categories: [],
      },
    })
    .run()

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
  for (const table of [
    follows,
    followHistory,
    mediaFiles,
    torrents,
    titleVoices,
    releaseBlocklist,
    metaCache,
    trackedTopics,
    notifications,
    titleProgress,
  ])
    getDb().delete(table).run()

  getDb()
    .update(indexers)
    .set({
      backoffUntil: null,
      backoffSince: null,
      failureCount: 0,
      checkStatus: null,
      rssCursor: null,
      rssCheckedAt: null,
      rssFailures: 0,
    })
    .run()
  clearSearchCache()
  resetFollowSearch(0)
  resetGrabRetries()
  resetStallTracking()
  disk.free = 512 * GB
  items = []
  live = []
  inspected = pack
  indexerSearches = 0
  indexerRequests = 0
  torrentDownloads = 0
  onIndexerSearch = undefined
  downloadFailure = undefined
  enginePuts = []
  engineAdds = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'

    if (url.pathname === '/3/tv/3000')
      return json(series())

    if (url.pathname === '/3/tv/3000/season/2')
      return json(season2())

    if (url.hostname === 'api.themoviedb.org')
      return json({ status_message: 'not found' }, 404)

    if (url.hostname === 'a.indexer.example')
      indexerRequests++

    if (url.pathname === '/torznab/api') {
      indexerSearches++
      onIndexerSearch?.()
      return new Response(searchXml(items))
    }

    if (url.pathname.startsWith('/download/')) {
      torrentDownloads++

      if (downloadFailure)
        return downloadFailure.clone()

      inspected = url.pathname.endsWith(SINGLE_HASH)
        ? single
        : url.pathname.endsWith(PARTIAL_HASH)
          ? partial
          : pack
      return new Response(sampleTorrentFile())
    }

    if (url.host === '127.0.0.1:4000') {
      if (
        url.pathname === '/torrents/inspect'
        || (url.pathname === '/torrents' && method === 'POST')
      ) {
        if (method === 'POST')
          engineAdds.push(String(init.body ?? ''))

        return json(inspected)
      }

      if (url.pathname === '/torrents' && method === 'GET')
        return json(live)

      if (method === 'PUT') {
        enginePuts.push({
          path: url.pathname,
          body: JSON.parse(String(init.body ?? 'null')),
        })
        return new Response(null, { status: 204 })
      }
    }

    return json({ kind: 'torrent_not_found', message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  setEngineReady('http://127.0.0.1:4000')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
})

describe('автоматика «Следить»', () => {
  it('ищет при включении и качает из пака только нужные серии своей студии', async () => {
    // Озвучка прошлого сезона переходит в новый
    pinVoice(SERIES, 1, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow()
    const now = new Date()

    await followAutomation(now)

    const torrent = getDb().select().from(torrents).get()

    expect(indexerSearches).toBeGreaterThan(0)
    expect(torrent).toMatchObject({
      infoHash: PACK_HASH,
      titleId: SERIES,
      origin: 'follow',
      retention: 'keep',
      selectedFiles: [5, 6, 7],
    })
    expect(
      rows(follow.id).map(row => [row.episode, row.fileIndex, row.torrentId]),
    ).toEqual([
      [6, 5, torrent!.id],
      [7, 6, torrent!.id],
      [8, 7, torrent!.id],
    ])
    // Первая закачка закрепила студию за сезоном
    expect(
      getDb().select().from(titleVoices).where(eq(titleVoices.season, 2)).get(),
    ).toMatchObject({ studio: 'LostFilm' })
    // Пак сезона с адресом темы — отслеживаемая тема, сезон качается ею
    const topic = getDb().select().from(trackedTopics).get()

    expect(topic).toMatchObject({
      titleId: SERIES,
      detailsUrl: 'https://tracker.example/topic/aaaa',
      torrentId: torrent!.id,
      infoHash: PACK_HASH,
      season: 2,
      episodesTo: 8,
      episodesTotal: 12,
      refresh: null,
    })
    expect(getDb().select().from(followSeasons).get()).toMatchObject({
      season: 2,
      topicId: topic!.id,
    })
    expect(historyKinds(follow.id).sort()).toEqual([
      'found',
      'grabbed',
      'search',
    ])

    const saved = followById(follow.id)!

    expect(saved.lastSearchAt).toEqual(now)
    expect(saved.nextSearchAt!.getTime()).toBeGreaterThan(now.getTime())
    expect(
      (await followStates(saved))
        .filter(item => item.season === 2)
        .map(item => item.state),
    ).toEqual([
      ...Array.from({ length: 5 }).fill('in_library'),
      'downloading',
      'downloading',
      'downloading',
      ...Array.from({ length: 4 }).fill('upcoming'),
    ])
    // Своя студия — ни «ждём», ни «взяли другую»
    expect(inbox()).toEqual([])

    // Серии пака легли в библиотеку: одно сообщение на тайтл
    libraryEpisodes(6, 7, 8)
    await followAutomation(new Date(now.getTime() + 60_000))
    await followAutomation(new Date(now.getTime() + 120_000))

    expect(inbox()).toEqual([
      {
        kind: 'follow_downloaded',
        params: expect.objectContaining({
          titleId: SERIES,
          episodes: 'S2E6–E8',
          count: 3,
          studio: 'LostFilm',
          quality: '1080p',
        }),
      },
    ])
  })

  it('чужая студия ждёт окна, потом качается без нового поиска', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [
      {
        title:
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | NewStudio',
        hash: SINGLE_HASH,
        size: 1.5 * GB,
      },
    ]

    const follow = insertFollow({ voiceStudio: 'LostFilm' })
    const now = new Date()

    await followAutomation(now)

    expect(getDb().select().from(torrents).all()).toEqual([])

    const [episode8] = rows(follow.id)

    expect(episode8).toMatchObject({
      episode: 8,
      firstSeenAt: now,
      waitUntil: new Date(now.getTime() + 24 * HOUR_MS),
      pending: expect.objectContaining({
        infoHash: SINGLE_HASH,
        studio: 'NewStudio',
      }),
    })
    // Ссылка индексатора в базе — шифртекстом
    expect(JSON.stringify(episode8!.pending)).not.toContain(
      'a.indexer.example/download',
    )
    expect(episode8!.decisions![0]).toMatchObject({
      verdict: 'pending',
      rejections: [
        expect.objectContaining({
          code: 'wait',
          params: expect.objectContaining({ studio: 'LostFilm' }),
        }),
      ],
    })

    expect(inbox()).toEqual([
      {
        kind: 'follow_waiting',
        params: expect.objectContaining({
          episodes: 'S2E8',
          studio: 'NewStudio',
          quality: '1080p',
          wait: { studio: 'LostFilm' },
          until: episode8!.waitUntil!.toISOString(),
        }),
      },
    ])

    const waiting = (await followStates(followById(follow.id)!)).find(
      item => item.episode === 8,
    )

    expect(waiting).toMatchObject({
      state: 'waiting',
      waitUntil: episode8!.waitUntil,
    })

    const searches = indexerSearches

    await grabPending(
      followById(follow.id)!,
      new Date(now.getTime() + 23 * HOUR_MS),
    )
    expect(getDb().select().from(torrents).all()).toEqual([])

    await grabPending(
      followById(follow.id)!,
      new Date(now.getTime() + 24 * HOUR_MS),
    )

    expect(indexerSearches).toBe(searches)
    expect(getDb().select().from(torrents).get()).toMatchObject({
      infoHash: SINGLE_HASH,
      origin: 'follow',
      selectedFiles: [0],
    })
    expect(rows(follow.id)[0]).toMatchObject({
      fileIndex: 0,
      pending: null,
      waitUntil: null,
    })
    // Чужая студия против студии из правил сезону не закрепляется
    expect(getDb().select().from(titleVoices).all()).toEqual([])
    expect(inbox().map(item => item.kind)).toEqual([
      'follow_waiting',
      'follow_other_voice',
    ])
    expect(inbox()[1]!.params).toMatchObject({
      episodes: 'S2E8',
      studio: 'NewStudio',
      own: 'LostFilm',
    })
  })

  it('чужая студия по magnet после окна не закрепляется, когда пришли метаданные', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)

    const follow = insertFollow({ voiceStudio: 'LostFilm' })
    const now = new Date()
    const magnet = `magnet:?xt=urn:btih:${SINGLE_HASH}`
    const torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: SINGLE_HASH,
        name: SINGLE_HASH,
        source: 'magnet',
        magnet,
        status: 'resolving',
        origin: 'follow',
        titleId: SERIES,
      })
      .returning()
      .get()

    // Окно ожидания вышло, захват ждёт метаданные magnet
    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 2,
        episode: 8,
        firstSeenAt: new Date(now.getTime() - 24 * HOUR_MS),
        torrentId: torrent.id,
        grabbedAt: now,
        pending: {
          id: 'magnet-candidate',
          title:
            'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | NewStudio',
          infoHash: SINGLE_HASH,
          magnet,
          seeders: 30,
          studio: 'NewStudio',
        },
      })
      .run()

    await continueGrabs(followById, now)
    expect(rows(follow.id)[0]!.fileIndex).toBeNull()

    inspected = single
    getDb()
      .update(torrents)
      .set({
        status: 'ready',
        name: single.name,
        torrentFile: Buffer.from(sampleTorrentFile()),
        pieceLength: single.pieceLength,
        files: single.files.map(file => ({
          path: file.path,
          size: file.length,
          padding: file.padding,
        })),
      })
      .where(eq(torrents.id, torrent.id))
      .run()

    await continueGrabs(followById, new Date(now.getTime() + 60_000))

    expect(rows(follow.id)[0]).toMatchObject({ fileIndex: 0, pending: null })
    expect(getDb().select().from(titleVoices).all()).toEqual([])
  })

  it('нет места — `no_space`, кандидат остаётся; место вернулось — качается', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]
    disk.free = 1 * GB

    const follow = insertFollow()
    const now = new Date()

    await followAutomation(now)

    expect(rows(follow.id).map(row => row.stateNote)).toEqual([
      'no_space',
      'no_space',
      'no_space',
    ])
    expect(
      (await followStates(followById(follow.id)!))
        .filter(item => item.state === 'no_space')
        .map(item => item.episode),
    ).toEqual([6, 7, 8])

    disk.free = 512 * GB
    await grabPending(
      followById(follow.id)!,
      new Date(now.getTime() + 15 * 60_000),
    )

    expect(
      rows(follow.id).map(row => [row.stateNote, row.fileIndex]),
    ).toEqual([
      [null, 5],
      [null, 6],
      [null, 7],
    ])
  })

  it('зависшая раздача — в чёрный список, серии снова нужные, повторный поиск её не берёт', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow()
    const now = Date.now()

    await followAutomation(new Date(now))

    const torrent = getDb().select().from(torrents).get()!
    const state = new Map([[PACK_HASH, liveOf(PACK_HASH, 1 * GB)]])

    await checkStalled(state, followById, now)
    await checkStalled(state, followById, now + STALL_AFTER_MS - 1)
    expect(getDb().select().from(releaseBlocklist).all()).toEqual([])

    await checkStalled(state, followById, now + STALL_AFTER_MS)

    expect(getDb().select().from(releaseBlocklist).get()).toMatchObject({
      infoHash: PACK_HASH,
      reason: 'stalled',
      expiresAt: new Date(now + STALL_AFTER_MS + 7 * DAY_MS),
    })
    expect(
      rows(follow.id).map(row => [row.torrentId, row.fileIndex]),
    ).toEqual([
      [null, null],
      [null, null],
      [null, null],
    ])
    // Выбор снят: раздача вернулась в кэш
    expect(getDb().select().from(torrents).get()).toMatchObject({
      id: torrent.id,
      retention: 'cache',
      selectedFiles: null,
    })
    expect(enginePuts).toContainEqual({
      path: `/torrents/${PACK_HASH}/files`,
      body: { files: [] },
    })
    expect(requestedSearch(follow.id)).toBe('retry')
    expect(historyKinds(follow.id)).toContain('failed')

    // Повторный поиск находит ту же раздачу, но не берёт её
    clearSearchCache()

    const searches = indexerSearches

    await followAutomation(new Date(now + STALL_AFTER_MS + 60_000))

    expect(indexerSearches).toBeGreaterThan(searches)
    expect(requestedSearch(follow.id)).toBeUndefined()

    const episode6 = rows(follow.id)[0]!

    expect(episode6.torrentId).toBeNull()
    expect(episode6.decisions![0]).toMatchObject({
      infoHash: PACK_HASH,
      verdict: 'rejected',
      rejections: [expect.objectContaining({ code: 'blocklisted' })],
    })
  })

  it('нет места — следующая попытка не раньше чем через 15 минут', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]
    disk.free = 1 * GB

    const follow = insertFollow()
    const now = new Date()

    await followAutomation(now)
    expect(rows(follow.id).map(row => row.stateNote)).toEqual([
      'no_space',
      'no_space',
      'no_space',
    ])

    const requests = indexerRequests

    await followAutomation(new Date(now.getTime() + 30_000))
    expect(indexerRequests).toBe(requests)

    disk.free = 512 * GB
    await followAutomation(new Date(now.getTime() + 16 * 60_000))
    expect(rows(follow.id).map(row => row.fileIndex)).toEqual([5, 6, 7])
  })

  it('в паке нет серий 7–8: качаются 1–6, под 7–8 та же раздача не берётся', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    items = [{ title: PACK_TITLE, hash: PARTIAL_HASH }]

    const follow = insertFollow()
    const now = new Date()

    await followAutomation(now)

    expect(rows(follow.id).map(row => [row.episode, row.fileIndex])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
      [5, 4],
      [6, 5],
      [7, null],
      [8, null],
    ])
    expect(getDb().select().from(releaseBlocklist).all()).toEqual([
      expect.objectContaining({
        infoHash: PARTIAL_HASH,
        releaseTitle: 'Quiet.Harbor.S02.1080p',
        detailsUrl: 'https://tracker.example/topic/cccc',
        reason: 'failed_check',
        episodes: ['2:7', '2:8'],
      }),
    ])

    clearSearchCache()
    requestFollowSearch(follow.id)
    await followAutomation(new Date(now.getTime() + 60_000))

    const episode7 = rows(follow.id)[6]!

    expect(episode7.torrentId).toBeNull()
    expect(episode7.decisions![0]).toMatchObject({
      infoHash: PARTIAL_HASH,
      verdict: 'rejected',
      rejections: [expect.objectContaining({ code: 'blocklisted' })],
    })
    expect(
      historyKinds(follow.id).filter(kind => kind === 'grabbed'),
    ).toHaveLength(1)
  })

  it('слежение остановили посреди прохода — раздача не добавляется', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow()

    onIndexerSearch = () =>
      getDb()
        .update(follows)
        .set({ state: 'paused' })
        .where(eq(follows.id, follow.id))
        .run()
    await followAutomation(new Date())

    expect(getDb().select().from(torrents).all()).toEqual([])
    expect(engineAdds).toEqual([])
  })

  it('слежение удалили посреди поиска — без ошибок и без раздачи', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow()
    const warn = vi.spyOn(logFor('catalog'), 'warn')

    onIndexerSearch = () =>
      getDb().delete(follows).where(eq(follows.id, follow.id)).run()

    try {
      await followAutomation(new Date())
      expect(warn).not.toHaveBeenCalled()
    }
    finally {
      warn.mockRestore()
    }

    expect(getDb().select().from(torrents).all()).toEqual([])
  })

  it('отложенный кандидат слежения, остановленного после начала прохода, не захватывается', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)

    const follow = insertFollow()
    const now = new Date()

    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 2,
        episode: 8,
        firstSeenAt: new Date(now.getTime() - 2 * DAY_MS),
        pending: {
          id: 'single',
          title:
            'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | NewStudio',
          infoHash: SINGLE_HASH,
          seeders: 30,
        },
        waitUntil: now,
      })
      .run()

    // Проход взял слежение до паузы
    const taken = followById(follow.id)!

    getDb()
      .update(follows)
      .set({ state: 'paused' })
      .where(eq(follows.id, follow.id))
      .run()
    await grabPending(taken, now)

    expect(getDb().select().from(torrents).all()).toEqual([])
  })

  it('«Это он» во время тика ждёт его: раздача берётся один раз', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow()
    const now = new Date()
    const unsure = getDb()
      .insert(followHistory)
      .values({
        followId: follow.id,
        titleId: SERIES,
        at: now,
        kind: 'unsure',
        season: 2,
        releaseTitle: PACK_TITLE,
        params: {
          issues: ['partialTitle'],
          candidate: {
            id: 'unsure-pack',
            title: PACK_TITLE,
            infoHash: PACK_HASH,
            seeders: 30,
          },
        },
      })
      .returning()
      .get()

    await Promise.all([followTick(now), confirmUnsure(unsure.id, now)])
    // Решение «Это он» идёт в фоне за тиком
    await underFollowLock(async () => {})

    expect(
      historyKinds(follow.id).filter(kind => kind === 'grabbed'),
    ).toHaveLength(1)
  })

  it('magnet кандидата хранится шифртекстом, старая запись с открытым читается', async () => {
    const magnet = `magnet:?xt=urn:btih:${SINGLE_HASH}&tr=https%3A%2F%2Ftracker.example%2Fannounce%3Fpasskey%3D0000`
    const title
      = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | LostFilm'
    const candidate = pendingOf({
      id: 'magnet-release',
      title,
      indexers: [{ id: 'ix', name: 'Indexer A' }],
      magnet,
      infoHash: SINGLE_HASH,
      seeders: 30,
      parsed: parseRelease(title),
      match: { confidence: 'high', issues: [] },
    })

    expect(JSON.stringify(candidate)).not.toContain('tr=')
    expect(pendingMagnet(candidate)).toBe(magnet)

    // Запись прежней версии: magnet лежит открытым текстом
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)

    const follow = insertFollow()
    const now = new Date()

    inspected = single
    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 2,
        episode: 8,
        firstSeenAt: new Date(now.getTime() - 2 * DAY_MS),
        pending: { id: 'old', title, magnet, seeders: 30 },
        waitUntil: now,
      })
      .run()
    await grabPending(followById(follow.id)!, now)

    expect(getDb().select().from(torrents).get()?.magnet).toBe(magnet)
  })

  it('ссылка индексатора ответила 429 с Retry-After — фон не ходит к нему до срока', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [
      {
        title:
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | LostFilm',
        hash: SINGLE_HASH,
        size: 1.5 * GB,
        noHash: true,
      },
    ]
    downloadFailure = new Response('slow down', {
      status: 429,
      headers: { 'Retry-After': '3600' },
    })

    insertFollow()

    const now = new Date()

    await followAutomation(now)

    expect(
      getDb().select().from(indexers).get()!.backoffUntil!.getTime(),
    ).toBeGreaterThan(now.getTime() + 50 * 60_000)

    const requests = indexerRequests

    await followAutomation(new Date(now.getTime() + 20 * 60_000))
    expect(indexerRequests).toBe(requests)
  })

  it('слежение без тайтла в каталоге не занимает очередь поиска', async () => {
    const broken = insertFollow({ titleId: 'tmdb:tv:unknown' })
    const follow = insertFollow()
    const now = new Date()

    requestFollowSearch(broken.id)
    await followAutomation(now)
    await followAutomation(new Date(now.getTime() + 2 * 60_000))

    expect(followById(follow.id)!.lastSearchAt).not.toBeNull()
  })

  it('уборка истории не стирает «не нашли»: событие не повторяется', async () => {
    const follow = insertFollow({ startSeason: 1, lastSearchAt: new Date() })
    const states = await followStates(follow)

    expect(reportMissing(follow, states)).toHaveLength(8)

    const later = Date.now() + 60_000

    for (let chunk = 0; chunk < 11; chunk++) {
      getDb()
        .insert(followHistory)
        .values(
          Array.from({ length: 500 }, (_, index) => ({
            followId: follow.id,
            titleId: SERIES,
            at: new Date(later + chunk * 500 + index),
            kind: 'search' as const,
            params: {},
          })),
        )
        .run()
    }

    getDb()
      .insert(followHistory)
      .values(
        Array.from({ length: 300 }, (_, index) => ({
          followId: follow.id,
          titleId: SERIES,
          at: new Date(later - 1000 + index),
          kind: 'unsure' as const,
          releaseTitle: `Тихая гавань ${index} (2024) WEB-DL`,
          params: {},
        })),
      )
      .run()
    purgeHistory(new Date(later + 10_000))

    expect(reportMissing(follow, states)).toEqual([])
    // «Похоже, не уверены» уходят по общему лимиту
    expect(
      getDb()
        .select()
        .from(followHistory)
        .all()
        .filter(row => row.kind === 'unsure'),
    ).toEqual([])
  })

  it('во время паузы после `no_space` лента не скачивает `.torrent` снова', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]
    disk.free = 1 * GB

    insertFollow()

    const now = new Date()

    await followAutomation(now)

    const downloads = torrentDownloads

    // Лента индексатора приносит того же кандидата
    getDb().update(indexers).set({ checkStatus: 'ok' }).run()
    clearSearchCache()
    await followAutomation(new Date(now.getTime() + 60_000))

    expect(indexerSearches).toBeGreaterThan(1)
    expect(torrentDownloads).toBe(downloads)
  })

  it('раздача без infohash, запрещённая после добавления, узнаётся по странице', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [
      {
        title:
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | LostFilm',
        hash: SINGLE_HASH,
        size: 1.5 * GB,
        noHash: true,
      },
    ]
    getDb()
      .insert(releaseBlocklist)
      .values({
        titleId: SERIES,
        infoHash: SINGLE_HASH,
        releaseTitle: single.name,
        reason: 'stalled',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + DAY_MS),
      })
      .run()

    const follow = insertFollow()
    const now = new Date()

    await followAutomation(now)
    expect(torrentDownloads).toBe(1)

    clearSearchCache()
    requestFollowSearch(follow.id)
    await followAutomation(new Date(now.getTime() + 60_000))

    expect(torrentDownloads).toBe(1)
    expect(rows(follow.id)[0]!.decisions![0]).toMatchObject({
      verdict: 'rejected',
      rejections: [expect.objectContaining({ code: 'blocklisted' })],
    })
  })

  it('раздача без infohash под двумя показами: `.torrent` качается по разу на показ', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    // Одну раздачу показали дважды: другая страница и другое название
    items = [
      {
        title: EPISODE_8_TITLE,
        hash: SINGLE_HASH,
        size: 1.5 * GB,
        noHash: true,
        seeders: 40,
      },
      {
        title:
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серия: 8 из 12 (2024) WEB-DL 1080p | LostFilm',
        hash: SINGLE_HASH,
        size: 1.5 * GB,
        noHash: true,
        seeders: 30,
        page: 'https://tracker.example/topic/mirror',
      },
    ]
    getDb()
      .insert(releaseBlocklist)
      .values({
        titleId: SERIES,
        infoHash: SINGLE_HASH,
        releaseTitle: single.name,
        reason: 'failed_check',
        createdAt: new Date(),
      })
      .run()

    const follow = insertFollow()
    const now = new Date()

    for (const minute of [0, 1, 2, 3]) {
      clearSearchCache()
      requestFollowSearch(follow.id)
      await followAutomation(new Date(now.getTime() + minute * 60_000))
    }

    expect(torrentDownloads).toBe(2)
    expect(rows(follow.id)[0]!.decisions).toEqual([
      expect.objectContaining({ verdict: 'rejected' }),
      expect.objectContaining({ verdict: 'rejected' }),
    ])
  })

  it('тема обновилась на месте: запрет старой версии не переходит на новую без infohash', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    // Старая версия темы зависла; у новой адрес темы тот же, infohash нет
    getDb()
      .insert(releaseBlocklist)
      .values({
        titleId: SERIES,
        infoHash: PACK_HASH,
        detailsUrl: 'https://tracker.example/topic/bbbb',
        releaseTitle: 'Quiet.Harbor.S02.1080p',
        reason: 'stalled',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + DAY_MS),
      })
      .run()
    items = [
      {
        title:
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | LostFilm',
        hash: SINGLE_HASH,
        size: 1.5 * GB,
        noHash: true,
      },
    ]

    const follow = insertFollow()

    await followAutomation(new Date())

    expect(rows(follow.id)[0]).toMatchObject({ episode: 8, fileIndex: 0 })
  })

  it('«Это он» при занятом замке отвечает сразу, решение — после тика', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)

    const follow = insertFollow()
    const indexer = getDb().select().from(indexers).get()!
    const now = new Date()
    const unsure = getDb()
      .insert(followHistory)
      .values({
        followId: follow.id,
        titleId: SERIES,
        at: now,
        kind: 'unsure',
        season: 2,
        releaseTitle: PACK_TITLE,
        params: {
          issues: ['partialTitle'],
          candidate: pendingOf({
            id: 'unsure-pack',
            title: PACK_TITLE,
            indexers: [{ id: indexer.id, name: indexer.name }],
            link: {
              url: `https://a.indexer.example/download/${PACK_HASH}`,
              indexerId: indexer.id,
              indexerOrigin: 'https://a.indexer.example',
            },
            infoHash: PACK_HASH,
            seeders: 30,
            parsed: parseRelease(PACK_TITLE),
            match: { confidence: 'high', issues: [] },
          }),
        },
      })
      .returning()
      .get()
    let release = () => {}
    const tick = underFollowLock(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )

    expect(
      await Promise.race([
        confirmUnsure(unsure.id, now),
        new Promise(resolve => setTimeout(resolve, 500, 'waited')),
      ]),
    ).toBe('ok')
    expect(getDb().select().from(torrents).all()).toEqual([])

    release()
    await tick
    await underFollowLock(async () => {})

    expect(
      historyKinds(follow.id).filter(kind => kind === 'grabbed'),
    ).toHaveLength(1)
  })

  it('запрет раздачи без infohash — одна запись: снятие в панели снова её разрешает', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [
      {
        title: EPISODE_8_TITLE,
        hash: SINGLE_HASH,
        size: 1.5 * GB,
        noHash: true,
      },
    ]

    const created = new Date(Date.now() - 6 * DAY_MS)
    const expires = new Date(created.getTime() + 7 * DAY_MS)
    const block = getDb()
      .insert(releaseBlocklist)
      .values({
        titleId: SERIES,
        infoHash: SINGLE_HASH,
        releaseTitle: single.name,
        reason: 'stalled',
        createdAt: created,
        expiresAt: expires,
      })
      .returning()
      .get()
    const follow = insertFollow()
    const now = new Date()

    await followAutomation(now)

    // Срок запрета не продлился
    expect(getDb().select().from(releaseBlocklist).all()).toEqual([
      expect.objectContaining({ id: block.id, expiresAt: expires }),
    ])

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/follow/blocklist/${block.id}`,
      cookies: owner,
    })

    expect(removed.statusCode).toBe(200)

    clearSearchCache()
    requestFollowSearch(follow.id)
    await followAutomation(new Date(now.getTime() + 60_000))

    expect(rows(follow.id)[0]).toMatchObject({ episode: 8, fileIndex: 0 })
  })

  it('пак без infohash без части серий: под запрещённые серии `.torrent` снова не качается', async () => {
    pinVoice(SERIES, 2, { studio: 'LostFilm' })
    items = [{ title: PACK_TITLE, hash: PARTIAL_HASH, noHash: true }]

    const follow = insertFollow()
    const now = new Date()

    await followAutomation(now)
    expect(
      rows(follow.id).filter(row => row.fileIndex !== null),
    ).toHaveLength(6)

    const downloads = torrentDownloads

    clearSearchCache()
    requestFollowSearch(follow.id)
    await followAutomation(new Date(now.getTime() + 60_000))

    expect(torrentDownloads).toBe(downloads)
    expect(rows(follow.id)[6]!.decisions![0]).toMatchObject({
      verdict: 'rejected',
      rejections: [expect.objectContaining({ code: 'blocklisted' })],
    })
  })

  it('без действующих слежений никуда не ходит', async () => {
    insertFollow({ state: 'paused' })

    await followAutomation(new Date())

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('режим «Только уведомлять»', () => {
  function subscribe(followId: string) {
    const profile = getDb().select().from(profiles).get()!

    getDb()
      .insert(followProfiles)
      .values({ followId, profileId: profile.id })
      .run()
  }

  it('выбирает раздачу вместо закачки и сообщает один раз', async () => {
    pinVoice(SERIES, 1, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow({ mode: 'notify' })
    const now = new Date()

    await followAutomation(now)

    // Фон не качает `.torrent` и не трогает движок
    expect(torrentDownloads).toBe(0)
    expect(engineAdds).toEqual([])
    expect(getDb().select().from(torrents).all()).toEqual([])
    expect(getDb().select().from(trackedTopics).all()).toEqual([])
    expect(
      rows(follow.id).map(row => [
        row.episode,
        row.picked?.infoHash,
        row.pickedAt,
      ]),
    ).toEqual([
      [6, PACK_HASH, now],
      [7, PACK_HASH, now],
      [8, PACK_HASH, now],
    ])
    expect(
      getDb().select().from(titleVoices).where(eq(titleVoices.season, 2)).get(),
    ).toMatchObject({ studio: 'LostFilm' })
    expect(historyKinds(follow.id).sort()).toEqual([
      'found',
      'picked',
      'search',
    ])
    expect(
      (await followStates(followById(follow.id)!))
        .filter(item => item.season === 2)
        .slice(5, 8)
        .map(item => item.state),
    ).toEqual(['ready', 'ready', 'ready'])

    await followAutomation(new Date(now.getTime() + 60_000))
    await followAutomation(new Date(now.getTime() + 120_000))

    expect(inbox()).toEqual([
      {
        kind: 'follow_ready',
        params: expect.objectContaining({
          titleId: SERIES,
          episodes: 'S2E6–E8',
          count: 3,
          studio: 'LostFilm',
          quality: '1080p',
        }),
      },
    ])
  })

  it('чужая студия ждёт окна; своя потом подменяет выбор без закачки', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [
      {
        title:
          'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | NewStudio',
        hash: SINGLE_HASH,
        size: 1.5 * GB,
      },
    ]

    const follow = insertFollow({ mode: 'notify', voiceStudio: 'LostFilm' })
    const now = new Date()

    await followAutomation(now)
    expect(rows(follow.id)[0]).toMatchObject({ picked: null })

    const after = new Date(now.getTime() + 24 * HOUR_MS)

    await grabPending(followById(follow.id)!, after)

    expect(rows(follow.id)[0]).toMatchObject({
      pending: null,
      waitUntil: null,
      pickedAt: after,
      picked: expect.objectContaining({ studio: 'NewStudio' }),
    })

    items = [{ title: EPISODE_8_TITLE, hash: PARTIAL_HASH, size: 1.5 * GB }]
    clearSearchCache()
    requestFollowSearch(follow.id)
    await followAutomation(new Date(after.getTime() + HOUR_MS))

    expect(rows(follow.id)[0]).toMatchObject({
      // Срок апгрейда — от первого выбора
      pickedAt: after,
      picked: expect.objectContaining({
        infoHash: PARTIAL_HASH,
        studio: 'LostFilm',
      }),
    })
    expect(torrentDownloads).toBe(0)
    expect(historyKinds(follow.id)).toContain('upgraded')
    expect(inbox().map(item => item.kind)).toEqual([
      'follow_waiting',
      'follow_other_voice',
      'follow_ready',
      'follow_upgraded',
    ])
  })

  it('переключение на «Скачивать новые» качает готовые серии без поиска', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [{ title: EPISODE_8_TITLE, hash: SINGLE_HASH, size: 1.5 * GB }]

    // Без окна: выбор сразу
    const follow = insertFollow({ mode: 'notify', waitHours: 0 })
    const now = new Date()

    await followAutomation(now)
    await followAutomation(new Date(now.getTime() + 60_000))
    expect(rows(follow.id)[0]!.picked).toBeTruthy()

    const searches = indexerSearches

    updateFollow(follow.id, { rules: { mode: 'download' } })
    // Форма панели присылает окно при любой правке: готовые серии оно не
    // откладывает
    updateFollow(follow.id, { rules: { waitHours: 48 } })
    await grabPending(
      followById(follow.id)!,
      new Date(now.getTime() + 120_000),
    )

    expect(indexerSearches).toBe(searches)
    expect(getDb().select().from(torrents).get()).toMatchObject({
      infoHash: SINGLE_HASH,
      origin: 'follow',
      selectedFiles: [0],
    })
    expect(rows(follow.id)[0]).toMatchObject({
      picked: null,
      fileIndex: 0,
      notifiedAt: null,
    })
  })

  it('«Смотреть» добавляет выбор стримом; серии нет в файлах — выбор снимается', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [{ title: EPISODE_8_TITLE, hash: SINGLE_HASH, size: 1.5 * GB }]

    // Без окна: выбор сразу
    const follow = insertFollow({ mode: 'notify', waitHours: 0 })

    await followAutomation(new Date())

    const opened = await openPick(SERIES, { season: 2, episode: 8 })

    expect(opened.status).toBe('ready')
    expect(getDb().select().from(torrents).get()).toMatchObject({
      id: opened.torrentId,
      infoHash: SINGLE_HASH,
      titleId: SERIES,
      origin: 'search',
      retention: 'cache',
    })
    await expect(openPick(SERIES, { season: 2, episode: 7 })).rejects.toThrow(
      PickError,
    )

    // Раздача выбора на деле без восьмой серии
    getDb()
      .update(followEpisodes)
      .set({
        picked: pendingOf({
          id: 'partial',
          title: PACK_TITLE,
          infoHash: PARTIAL_HASH,
          link: {
            url: `https://a.indexer.example/download/${PARTIAL_HASH}`,
            indexerId: getDb().select().from(indexers).get()!.id,
            indexerOrigin: 'https://a.indexer.example',
          },
          indexers: [],
          seeders: 5,
          parsed: parseRelease(PACK_TITLE),
          match: { confidence: 'high', issues: [] },
        }),
      })
      .where(eq(followEpisodes.followId, follow.id))
      .run()

    await expect(
      openPick(SERIES, { season: 2, episode: 8 }),
    ).rejects.toMatchObject({ kind: 'not_playable' })
    expect(rows(follow.id)[0]).toMatchObject({ picked: null, pickedAt: null })
    expect(getDb().select().from(releaseBlocklist).get()).toMatchObject({
      infoHash: PARTIAL_HASH,
      reason: 'failed_check',
    })
    expect(followById(follow.id)!.nextSearchAt).toBeNull()
  })

  it('раздача пака без метаданных снимает выбор у всех его серий', async () => {
    libraryEpisodes(1, 2, 3, 4, 5)
    pinVoice(SERIES, 1, { studio: 'LostFilm' })
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow({ mode: 'notify' })

    await followAutomation(new Date())
    expect(rows(follow.id).filter(row => row.picked)).toHaveLength(3)

    getDb()
      .insert(torrents)
      .values({
        infoHash: PACK_HASH,
        name: 'Quiet.Harbor.S02.1080p',
        source: 'magnet',
        status: 'failed',
      })
      .run()
    settlePicks(followById(follow.id)!)

    expect(rows(follow.id).map(row => row.picked)).toEqual([
      null,
      null,
      null,
    ])
    expect(getDb().select().from(releaseBlocklist).get()).toMatchObject({
      infoHash: PACK_HASH,
      reason: 'stalled',
      episodes: null,
    })
    expect(followById(follow.id)!.nextSearchAt).toBeNull()
  })

  it('«Продолжить»: новая серия — после самой дальней, начатая — не новость', async () => {
    pinVoice(SERIES, 1, { studio: 'LostFilm' })
    libraryEpisodes(1, 2, 3, 4, 5)
    items = [{ title: PACK_TITLE, hash: PACK_HASH }]

    const follow = insertFollow({ mode: 'notify' })
    const profile = getDb().select().from(profiles).get()!

    subscribe(follow.id)
    await followAutomation(new Date())

    const point = (episode: number, position: number) =>
      getDb()
        .insert(titleProgress)
        .values({
          profileId: profile.id,
          titleId: SERIES,
          season: 2,
          episode,
          position,
          duration: 3000,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            titleProgress.profileId,
            titleProgress.titleId,
            titleProgress.season,
            titleProgress.episode,
          ],
          set: { position },
        })
        .run()

    // Седьмую досмотрели, шестую пропустили — новая только восьмая
    point(7, 2990)
    expect(followNewEpisodes(profile.id).get(SERIES)).toMatchObject({
      season: 2,
      episode: 8,
    })

    // Восьмую начали — это уже «Продолжить», а не новость
    point(8, 600)
    expect(followNewEpisodes(profile.id).has(SERIES)).toBe(false)
  })

  it('новая серия — в «Продолжить» с колокольчиком', async () => {
    libraryEpisodes(1, 2, 3, 4, 5, 6, 7)
    items = [{ title: EPISODE_8_TITLE, hash: SINGLE_HASH, size: 1.5 * GB }]

    // Без окна: выбор сразу
    const follow = insertFollow({ mode: 'notify', waitHours: 0 })

    subscribe(follow.id)
    await followAutomation(new Date())

    const res = await app.inject({
      url: '/api/home/continue?language=ru-RU',
      cookies: owner,
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().items).toEqual([
      expect.objectContaining({
        id: SERIES,
        season: 2,
        episode: 8,
        position: 0,
        next: true,
        file: null,
        followNewEpisode: true,
      }),
    ])
  })
})
