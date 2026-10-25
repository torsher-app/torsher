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
import { getDb, migrateDb } from '../../db/index.ts'
import {
  followEpisodes,
  followHistory,
  follows,
  followSeasons,
  indexers,
  libraries,
  libraryFolders,
  mediaFiles,
  metaCache,
  notifications,
  releaseBlocklist,
  titleVoices,
  torrents,
  trackedTopics,
} from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import { sampleTorrentFile } from '../engine/fixtures/index.ts'
import { clearSearchCache } from '../sources/cache.ts'
import { tvOngoing } from '../tmdb/fixtures/index.ts'
import { pinVoice } from '../sources/voices.ts'
import { continueGrabs, resetGrabRetries } from './grab.ts'
import { followById } from './index.ts'
import { followStates, grabPending } from './pass.ts'
import { followAutomation } from './schedule.ts'
import { requestedSearch, resetFollowSearch } from './search.ts'
import { checkStalled, resetStallTracking, STALL_AFTER_MS } from './stalled.ts'
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
}

function searchXml(items: Item[]) {
  const body = items
    .map(
      item => `<item>
  <title>${item.title}</title>
  <guid>https://tracker.example/topic/${item.hash.slice(0, 4)}</guid>
  <comments>https://tracker.example/topic/${item.hash.slice(0, 4)}</comments>
  <link>https://a.indexer.example/download/${item.hash}</link>
  <size>${item.size ?? 12 * GB}</size>
  <torznab:attr name="seeders" value="${item.seeders ?? 30}" />
  <torznab:attr name="infohash" value="${item.hash}" />
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

let items: Item[] = []
let live: EngineTorrentState[] = []
let inspected = pack
let indexerSearches = 0
let enginePuts: { path: string, body: unknown }[] = []

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

beforeAll(async () => {
  await migrateDb()
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
  ])
    getDb().delete(table).run()

  clearSearchCache()
  resetFollowSearch(0)
  resetGrabRetries()
  resetStallTracking()
  disk.free = 512 * GB
  items = []
  live = []
  inspected = pack
  indexerSearches = 0
  enginePuts = []
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

    if (url.pathname === '/torznab/api') {
      indexerSearches++
      return new Response(searchXml(items))
    }

    if (url.pathname.startsWith('/download/')) {
      inspected = url.pathname.endsWith(SINGLE_HASH) ? single : pack
      return new Response(sampleTorrentFile())
    }

    if (url.host === '127.0.0.1:4000') {
      if (
        url.pathname === '/torrents/inspect'
        || (url.pathname === '/torrents' && method === 'POST')
      ) {
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
    await grabPending(followById(follow.id)!, new Date(now.getTime() + 60_000))

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

  it('без действующих слежений никуда не ходит', async () => {
    insertFollow({ state: 'paused' })

    await followAutomation(new Date())

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
