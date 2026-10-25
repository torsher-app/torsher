import type { Follow, Torrent } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import { Buffer } from 'node:buffer'
import {
  link,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  indexers,
  libraryFolders,
  mediaFiles,
  metaCache,
  profiles,
  releaseBlocklist,
  titleProgress,
  titleVoices,
  torrents,
  trackedTopics,
} from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import { managedFolder } from '../library/files.ts'
import { checkLinkMode } from '../library/link.ts'
import { syncLibrary } from '../library/linker.ts'
import { clearSearchCache } from '../sources/cache.ts'
import { pinVoice } from '../sources/voices.ts'
import { tvOngoing } from '../tmdb/fixtures/index.ts'
import { availableFrom } from './availability.ts'
import { resetGrabRetries } from './grab.ts'
import { followById } from './index.ts'
import { completeMovie, followStates } from './pass.ts'
import { followAutomation } from './schedule.ts'
import { requestFollowSearch, resetFollowSearch } from './search.ts'
import { checkStalled, resetStallTracking, STALL_AFTER_MS } from './stalled.ts'
import { settleUpgrades } from './upgrade.ts'
import { localDay } from './wanted.ts'

const disk = vi.hoisted(() => ({ total: 1024 ** 4, free: 512 * 1024 ** 3 }))

vi.mock('../storage/disk.ts', () => ({
  diskUsage: async () => ({ ...disk }),
}))

const SERIES = 'tmdb:tv:3000'
const MOVIE = 'tmdb:movie:4000'
const DAY_MS = 24 * 60 * 60 * 1000
const OLD = 'a'.repeat(40)
const NEW = 'c'.repeat(40)
const OLD_NAME = 'Quiet.Harbor.S02E07-08'
const NEW_NAME = 'Quiet.Harbor.S02E08'
const OLD_TITLE
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 7-8 из 12 (2024) WEB-DL 1080p | NewStudio'
const NEW_TITLE
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 8 из 12 (2024) WEB-DL 1080p | LostFilm'
const LIBRARY_DIR = 'shows/Quiet Harbor (2023) [tmdbid-3000]/Season 02'
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
    name: 'Quiet Harbor',
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
      { season_number: 2, name: 'S2', episode_count: 12, air_date: day(-60) },
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

/** Фильм вышел в прокат месяц назад; цифровых дат нет, если не заданы */
let movieReleases: { iso_3166_1: string, release_dates: object[] }[] = []

function movieDetails() {
  return {
    id: 4000,
    title: 'Signal',
    original_title: 'Signal',
    original_language: 'en',
    release_date: day(-30),
    status: 'Released',
    runtime: 110,
    overview: '',
    genres: [],
    vote_average: 7,
    vote_count: 100,
    alternative_titles: { titles: [] },
    translations: {
      translations: [
        { iso_639_1: 'ru', iso_3166_1: 'RU', data: { title: 'Сигнал' } },
      ],
    },
    release_dates: { results: movieReleases },
  }
}

interface Version {
  name: string
  files: { path: string, content: string }[]
}

const versions = new Map<string, Version>()

function content(number: number, version: number) {
  return `episode ${number} version ${version}`.padEnd(200 + version * 10, '.')
}

/** Вымышленный `.torrent`: подделке движка нужен только infohash */
function torrentBytes(hash: string) {
  return Buffer.from(`d4:hash40:${hash}e`)
}

async function hashOf(body: RequestInit['body']) {
  const text = await new Response(body).text()

  return text.match(/[0-9a-f]{40}/)![0]
}

function details(hash: string) {
  const version = versions.get(hash)!

  return {
    infoHash: hash,
    name: version.name,
    pieceLength: 16_384,
    pieceCount: 1,
    files: version.files.map(file => ({
      path: file.path,
      length: file.content.length,
      padding: false,
    })),
  }
}

interface Item {
  title: string
  hash: string
}

let items: Item[] = []

function searchXml() {
  const body = items
    .map(
      item => `<item>
  <title>${item.title}</title>
  <guid>https://tracker.example/topic/${item.hash.slice(0, 4)}</guid>
  <comments>https://tracker.example/topic/${item.hash.slice(0, 4)}</comments>
  <link>https://a.indexer.example/download/${item.hash}</link>
  <size>${1.5 * 1024 ** 3}</size>
  <torznab:attr name="seeders" value="30" />
  <torznab:attr name="infohash" value="${item.hash}" />
</item>`,
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>${body}</channel></rss>`
}

let live: EngineTorrentState[] = []
let failFiles = false
let torrentDownloads = 0
let root = ''
let folderId = ''
let profileId = ''

function downloadsPath(...parts: string[]) {
  return join(root, 'torrents', ...parts)
}

function libraryFile(name: string) {
  return `${LIBRARY_DIR}/${name}`
}

function libraryPath(name: string) {
  return join(root, 'library', ...libraryFile(name).split('/'))
}

function stateOf(
  torrent: Torrent,
  progress: number[],
  bytesWanted = 0,
): EngineTorrentState {
  return {
    infoHash: torrent.infoHash,
    paused: false,
    selected: torrent.selectedFiles ?? [],
    bytesCompleted: progress.reduce((sum, size) => sum + size, 0),
    bytesWanted,
    wantedCompleted: progress.reduce((sum, size) => sum + size, 0),
    queued: false,
    seeding: false,
    uploaded: 0,
    peers: { connected: 0, found: 3 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    fileProgress: progress,
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

function torrentByHash(hash: string) {
  return getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.infoHash, hash))
    .get()
}

function episodeRow(followId: string, episode: number) {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, followId))
    .all()
    .find(row => row.episode === episode)!
}

function libraryRows(episode: number) {
  return getDb()
    .select()
    .from(mediaFiles)
    .all()
    .filter(row => row.episode === episode)
}

function history(followId: string) {
  return getDb()
    .select()
    .from(followHistory)
    .where(eq(followHistory.followId, followId))
    .all()
}

/**
 * Пак «7–8» чужой студии взят автоматикой после окна: восьмая серия лежит в
 * библиотеке хардлинком с субтитрами рядом, седьмая ещё качается. Серии 1–6
 * — в библиотеке из другого места.
 */
async function seedOld(
  follow: Follow,
  options: { downloadedAgo?: number, automation?: boolean } = {},
) {
  const { downloadedAgo = DAY_MS, automation = true } = options

  versions.set(OLD, {
    name: OLD_NAME,
    files: [
      { path: 'Quiet.Harbor.S02E07.mkv', content: content(7, 1) },
      { path: 'Quiet.Harbor.S02E08.mkv', content: content(8, 1) },
    ],
  })
  await mkdir(downloadsPath(OLD_NAME), { recursive: true })
  await writeFile(
    downloadsPath(OLD_NAME, 'Quiet.Harbor.S02E08.mkv'),
    content(8, 1),
  )
  await mkdir(join(root, 'library', LIBRARY_DIR), { recursive: true })
  await link(
    downloadsPath(OLD_NAME, 'Quiet.Harbor.S02E08.mkv'),
    libraryPath('Quiet Harbor S02E08.mkv'),
  )
  await writeFile(libraryPath('Quiet Harbor S02E08.ru.srt'), 'old subtitles')

  const old = getDb()
    .insert(torrents)
    .values({
      infoHash: OLD,
      name: OLD_NAME,
      source: 'file',
      torrentFile: torrentBytes(OLD),
      files: details(OLD).files.map(file => ({
        path: file.path,
        size: file.length,
        padding: false,
      })),
      pieceLength: 16_384,
      status: 'ready',
      inEngine: true,
      titleId: SERIES,
      retention: 'keep',
      origin: 'follow',
      selectedFiles: [0, 1],
    })
    .returning()
    .get()
  const info = await stat(libraryPath('Quiet Harbor S02E08.mkv'))

  getDb()
    .insert(mediaFiles)
    .values({
      folderId,
      relPath: libraryFile('Quiet Harbor S02E08.mkv'),
      size: info.size,
      mtime: info.mtime,
      inode: info.ino,
      torrentId: old.id,
      fileIndex: 1,
      linkMode: 'hardlink',
      titleId: SERIES,
      season: 2,
      episode: 8,
      matchStatus: 'matched',
      matchSource: 'torrent',
    })
    .run()

  for (const number of [1, 2, 3, 4, 5, 6]) {
    getDb()
      .insert(mediaFiles)
      .values({
        folderId,
        relPath: libraryFile(`Quiet Harbor S02E0${number}.mkv`),
        size: 100,
        mtime: new Date(),
        titleId: SERIES,
        season: 2,
        episode: number,
      })
      .run()
  }

  const downloadedAt = new Date(Date.now() - downloadedAgo)

  getDb()
    .insert(followEpisodes)
    .values([
      {
        followId: follow.id,
        season: 2,
        episode: 7,
        firstSeenAt: new Date(Date.now() - 2 * DAY_MS),
        torrentId: old.id,
        fileIndex: 0,
        grabbedAt: downloadedAt,
        grabbedTitle: OLD_TITLE,
      },
      {
        followId: follow.id,
        season: 2,
        episode: 8,
        firstSeenAt: new Date(Date.now() - 2 * DAY_MS),
        ...(automation && {
          torrentId: old.id,
          fileIndex: 1,
          grabbedAt: downloadedAt,
          grabbedTitle: OLD_TITLE,
          downloadedAt,
        }),
      },
    ])
    .run()
  pinVoice(SERIES, 2, { studio: 'LostFilm' })
  versions.set(NEW, {
    name: NEW_NAME,
    files: [{ path: 'Quiet.Harbor.S02E08.mkv', content: content(8, 2) }],
  })
  items = [{ title: NEW_TITLE, hash: NEW }]

  return { old, downloadedAt }
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
        movieSearch: { available: true, params: ['q'] },
        categories: [],
      },
    })
    .run()
  profileId = getDb()
    .insert(profiles)
    .values({ name: 'Viewer', color: 'blue' })
    .returning()
    .get()
    .id
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-upgrade-'))
  vi.stubEnv('DOWNLOADS_PATH', join(root, 'torrents'))
  vi.stubEnv('LIBRARY_PATH', join(root, 'library'))
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')

  for (const table of [
    follows,
    followHistory,
    trackedTopics,
    mediaFiles,
    torrents,
    titleVoices,
    titleProgress,
    releaseBlocklist,
    metaCache,
  ])
    getDb().delete(table).run()

  clearSearchCache()
  resetFollowSearch(0)
  resetGrabRetries()
  resetStallTracking()
  versions.clear()
  items = []
  live = []
  failFiles = false
  torrentDownloads = 0
  disk.free = 512 * 1024 ** 3
  getDb()
    .update(indexers)
    .set({
      checkStatus: null,
      rssCursor: null,
      rssCheckedAt: null,
      rssFailures: 0,
    })
    .run()
  movieReleases = []
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (input, init = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'

    if (url.pathname === '/3/tv/3000')
      return json(series())

    if (url.pathname === '/3/tv/3000/season/2')
      return json(season2())

    if (url.pathname === '/3/movie/4000')
      return json(movieDetails())

    if (url.hostname === 'api.themoviedb.org')
      return json({ status_message: 'not found' }, 404)

    if (url.pathname === '/torznab/api')
      return new Response(searchXml())

    if (url.pathname.startsWith('/download/')) {
      torrentDownloads++
      return new Response(torrentBytes(url.pathname.slice(-40)))
    }

    if (url.host !== '127.0.0.1:4000')
      return json({ status_message: 'unexpected' }, 404)

    if (url.pathname === '/torrents' && method === 'POST' && failFiles)
      return json({ kind: 'internal', message: 'engine failed' }, 500)

    if (
      url.pathname === '/torrents/inspect'
      || (url.pathname === '/torrents' && method === 'POST')
    ) {
      return json(details(await hashOf(init.body)))
    }

    if (url.pathname === '/torrents' && method === 'GET')
      return json(live)

    if (method === 'PUT')
      return new Response(null, { status: 204 })

    return json({ kind: 'torrent_not_found', message: 'not found' }, 404)
  })
  vi.stubGlobal('fetch', fetchMock)
  setEngineReady('http://127.0.0.1:4000')
  await checkLinkMode()
  folderId = managedFolder().id
})

afterEach(async () => {
  await syncLibrary()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
  await rm(root, { recursive: true, force: true })
})

describe('апгрейд серии', () => {
  it('чужая студия до просмотра заменяется своей: строка, путь и прогресс те же', async () => {
    const follow = insertFollow()
    const { old, downloadedAt } = await seedOld(follow)
    const before = libraryRows(8)[0]!

    getDb()
      .insert(titleProgress)
      .values({
        profileId,
        titleId: SERIES,
        season: 2,
        episode: 8,
        position: 30,
        duration: 3000,
        torrentId: old.id,
        fileIndex: 1,
        mediaFileId: before.id,
      })
      .run()

    await followAutomation(new Date())

    const next = torrentByHash(NEW)!

    expect(next).toMatchObject({
      origin: 'follow',
      retention: 'keep',
      selectedFiles: [0],
    })
    expect(episodeRow(follow.id, 8)).toMatchObject({
      torrentId: next.id,
      fileIndex: 0,
      downloadedAt: null,
      grabbedTitle: NEW_TITLE,
      upgradeFrom: {
        torrentId: old.id,
        fileIndex: 1,
        downloadedAt: downloadedAt.getTime(),
        title: OLD_TITLE,
      },
    })
    expect(libraryRows(8)[0]).toMatchObject({
      id: before.id,
      torrentId: old.id,
      replacementTorrentId: next.id,
      replacementFileIndex: 0,
    })
    expect(
      history(follow.id).find(row => row.kind === 'grabbed')?.params,
    ).toMatchObject({ studio: 'LostFilm', upgrade: true })
    // Пока новая версия качается, серия смотрится с диска
    expect(
      (await followStates(followById(follow.id)!)).find(
        item => item.episode === 8,
      )?.state,
    ).toBe('in_library')

    // Новая версия скачалась — встаёт на место прежней
    await mkdir(downloadsPath(NEW_NAME), { recursive: true })
    await writeFile(
      downloadsPath(NEW_NAME, 'Quiet.Harbor.S02E08.mkv'),
      content(8, 2),
    )
    live = [
      stateOf(torrentByHash(OLD)!, [0, content(8, 1).length]),
      stateOf(next, [content(8, 2).length]),
    ]
    await syncLibrary()
    await syncLibrary()

    const replaced = libraryRows(8)

    expect(replaced).toHaveLength(1)
    expect(replaced[0]).toMatchObject({
      id: before.id,
      relPath: before.relPath,
      torrentId: next.id,
      fileIndex: 0,
      replacementTorrentId: null,
      replaced: [{ torrentId: old.id, fileIndex: 1 }],
    })
    expect(await readFile(libraryPath('Quiet Harbor S02E08.mkv'), 'utf8')).toBe(
      content(8, 2),
    )
    // Субтитры прежней версии убраны
    expect(await readdir(join(root, 'library', LIBRARY_DIR))).not.toContain(
      'Quiet Harbor S02E08.ru.srt',
    )
    expect(getDb().select().from(titleProgress).get()).toMatchObject({
      position: 30,
      torrentId: next.id,
      fileIndex: 0,
      mediaFileId: before.id,
    })
    // Прежняя раздача больше не качает восьмую серию, седьмая — качается
    expect(torrentByHash(OLD)).toMatchObject({
      retention: 'keep',
      selectedFiles: [0],
    })

    // Прежний файл скачан, раздача ещё закреплена — второй версией не ляжет
    live = [
      stateOf(torrentByHash(OLD)!, [10, content(8, 1).length]),
      stateOf(next, [content(8, 2).length]),
    ]
    await syncLibrary()
    expect(libraryRows(8)).toHaveLength(1)

    expect(settleUpgrades(followById(follow.id)!)).toEqual([
      { episode: { season: 2, episode: 8 }, title: NEW_TITLE },
    ])

    expect(episodeRow(follow.id, 8)).toMatchObject({
      upgradeFrom: null,
      downloadedAt,
    })
    expect(
      history(follow.id).find(row => row.kind === 'upgraded'),
    ).toMatchObject({
      season: 2,
      episodes: [8],
      releaseTitle: NEW_TITLE,
      params: {
        from: { studio: 'NewStudio', quality: '1080p' },
        to: { studio: 'LostFilm', quality: '1080p' },
      },
    })
  })

  it('серию уже посмотрели — не заменяем', async () => {
    const follow = insertFollow()

    await seedOld(follow)
    getDb()
      .insert(titleProgress)
      .values({
        profileId,
        titleId: SERIES,
        season: 2,
        episode: 8,
        position: 600,
        duration: 3000,
      })
      .run()
    // Заменять нечего — сам поиск не ставится; ищем кнопкой
    requestFollowSearch(follow.id)
    await followAutomation(new Date())

    expect(torrentByHash(NEW)).toBeUndefined()
    expect(episodeRow(follow.id, 8).decisions![0]).toMatchObject({
      infoHash: NEW,
      verdict: 'rejected',
      rejections: [expect.objectContaining({ code: 'watched' })],
    })
  })

  it('серию выбрали вручную — не заменяем', async () => {
    const follow = insertFollow()

    await seedOld(follow, { automation: false })
    requestFollowSearch(follow.id)
    await followAutomation(new Date())

    expect(torrentByHash(NEW)).toBeUndefined()
    expect(episodeRow(follow.id, 8).decisions![0]).toMatchObject({
      verdict: 'rejected',
      rejections: [expect.objectContaining({ code: 'manual' })],
    })
  })

  it('через 7 дней после закачки серию не заменяем и не ищем', async () => {
    const follow = insertFollow()

    await seedOld(follow, { downloadedAgo: 8 * DAY_MS })
    requestFollowSearch(follow.id)
    await followAutomation(new Date())

    expect(torrentByHash(NEW)).toBeUndefined()
    expect(episodeRow(follow.id, 8).decisions).toBeNull()
  })

  it('сбой закачки после начала апгрейда — серия остаётся прежней, «заменили» нет', async () => {
    const follow = insertFollow()
    const { old, downloadedAt } = await seedOld(follow)

    failFiles = true
    await followAutomation(new Date())

    expect(episodeRow(follow.id, 8)).toMatchObject({
      torrentId: old.id,
      fileIndex: 1,
      downloadedAt,
      upgradeFrom: null,
    })
    expect(settleUpgrades(followById(follow.id)!)).toEqual([])
    expect(history(follow.id).map(row => row.kind)).not.toContain('upgraded')
  })

  it('серию убрали из библиотеки — она качается заново как новая, а не как замена', async () => {
    const follow = insertFollow()
    const { old } = await seedOld(follow)

    // Файла восьмой серии нет, прежняя раздача её больше не качает
    getDb().delete(mediaFiles).where(eq(mediaFiles.torrentId, old.id)).run()
    getDb()
      .update(torrents)
      .set({ selectedFiles: [0] })
      .where(eq(torrents.id, old.id))
      .run()
    await followAutomation(new Date())

    const next = torrentByHash(NEW)!

    expect(episodeRow(follow.id, 8)).toMatchObject({
      torrentId: next.id,
      fileIndex: 0,
      downloadedAt: null,
      upgradeFrom: null,
    })
    expect(
      history(follow.id).find(row => row.kind === 'grabbed')?.params,
    ).not.toHaveProperty('upgrade')
  })

  it('папка библиотеки отключена — серия не забывается, апгрейд потом видит файл своим', async () => {
    const follow = insertFollow()
    const { old, downloadedAt } = await seedOld(follow)

    // Диск отключён: файл «пропал», прежняя раздача его больше не качает
    items = []
    getDb()
      .update(mediaFiles)
      .set({ state: 'missing', missingSince: new Date() })
      .where(eq(mediaFiles.torrentId, old.id))
      .run()
    getDb()
      .update(libraryFolders)
      .set({ status: 'offline' })
      .where(eq(libraryFolders.id, folderId))
      .run()
    getDb()
      .update(torrents)
      .set({ selectedFiles: [0] })
      .where(eq(torrents.id, old.id))
      .run()
    requestFollowSearch(follow.id)
    await followAutomation(new Date())

    expect(episodeRow(follow.id, 8)).toMatchObject({
      torrentId: old.id,
      fileIndex: 1,
      downloadedAt,
    })

    // Диск вернулся: новая версия своей студии заменяет файл автоматики
    getDb()
      .update(mediaFiles)
      .set({ state: 'present', missingSince: null })
      .where(eq(mediaFiles.torrentId, old.id))
      .run()
    getDb()
      .update(libraryFolders)
      .set({ status: 'ok' })
      .where(eq(libraryFolders.id, folderId))
      .run()
    items = [{ title: NEW_TITLE, hash: NEW }]
    clearSearchCache()
    requestFollowSearch(follow.id)
    await followAutomation(new Date(Date.now() + 2 * 60_000))

    expect(episodeRow(follow.id, 8).upgradeFrom).toMatchObject({
      torrentId: old.id,
      fileIndex: 1,
    })
  })

  it('апгрейду не хватило места — во время паузы лента не качает `.torrent`', async () => {
    const follow = insertFollow()
    const { old, downloadedAt } = await seedOld(follow)

    disk.free = 0
    await followAutomation(new Date())

    expect(torrentDownloads).toBe(1)
    expect(episodeRow(follow.id, 8)).toMatchObject({
      torrentId: old.id,
      fileIndex: 1,
      downloadedAt,
      upgradeFrom: null,
    })

    // Лента индексатора приносит ту же версию
    getDb().update(indexers).set({ checkStatus: 'ok' }).run()
    clearSearchCache()
    await followAutomation(new Date(Date.now() + 60_000))

    expect(torrentDownloads).toBe(1)
    expect(
      (await followStates(followById(follow.id)!)).find(
        item => item.episode === 8,
      )?.state,
    ).toBe('in_library')
  })

  it('новая версия зависла — серия возвращается к прежней закачке', async () => {
    const follow = insertFollow()
    const { old, downloadedAt } = await seedOld(follow)
    const now = Date.now()

    await followAutomation(new Date(now))

    const next = torrentByHash(NEW)!
    const state = new Map([[NEW, stateOf(next, [0], content(8, 2).length)]])

    await checkStalled(state, followById, now)
    await checkStalled(state, followById, now + STALL_AFTER_MS)

    expect(episodeRow(follow.id, 8)).toMatchObject({
      torrentId: old.id,
      fileIndex: 1,
      downloadedAt,
      grabbedTitle: OLD_TITLE,
      upgradeFrom: null,
    })
    expect(libraryRows(8)[0]).toMatchObject({
      torrentId: old.id,
      fileIndex: 1,
      replacementTorrentId: null,
    })
    expect(torrentByHash(NEW)).toMatchObject({ retention: 'cache' })
    // Седьмая серия прежней раздачи не тронута
    expect(episodeRow(follow.id, 7)).toMatchObject({
      torrentId: old.id,
      fileIndex: 0,
    })
  })
})

describe('доступность фильма', () => {
  it('цифровой или физический релиз в любой стране, иначе прокат + 90 дней', () => {
    expect(
      availableFrom([
        { type: 3, date: '2026-03-01' },
        { type: 5, date: '2026-07-20' },
        { type: 4, date: '2026-06-10' },
      ]),
    ).toEqual(new Date('2026-06-10T00:00:00'))
    expect(
      availableFrom([
        { type: 3, date: '2026-03-10' },
        { type: 2, date: '2026-03-01' },
      ]),
    ).toEqual(
      new Date(new Date('2026-03-01T00:00:00').getTime() + 90 * DAY_MS),
    )
    expect(availableFrom([], '2026-03-01')).toEqual(
      new Date(new Date('2026-03-01T00:00:00').getTime() + 90 * DAY_MS),
    )
    expect(availableFrom([{ type: 1, date: '2026-03-01' }])).toBeUndefined()
  })
})

describe('слежение за фильмом', () => {
  function insertMovieFollow() {
    return insertFollow({
      titleId: MOVIE,
      kind: 'movie',
      startSeason: 0,
      startEpisode: 0,
      requireRussian: true,
      waitHours: 72,
    })
  }

  /** Фильм лежит в библиотеке из захвата автоматики */
  function seedMovie(follow: Follow, title: string, downloadedAgo: number) {
    const torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: OLD,
        name: 'Signal.2026.1080p',
        source: 'file',
        files: [{ path: 'Signal.2026.1080p.mkv', size: 100, padding: false }],
        status: 'ready',
        titleId: MOVIE,
        retention: 'keep',
        origin: 'follow',
        selectedFiles: [0],
      })
      .returning()
      .get()

    getDb()
      .insert(mediaFiles)
      .values({
        folderId,
        relPath: 'movies/Signal (2026)/Signal (2026).mkv',
        size: 100,
        mtime: new Date(),
        torrentId: torrent.id,
        fileIndex: 0,
        titleId: MOVIE,
        season: 0,
        episode: 0,
      })
      .run()

    const at = new Date(Date.now() - downloadedAgo)

    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 0,
        episode: 0,
        firstSeenAt: at,
        torrentId: torrent.id,
        fileIndex: 0,
        grabbedAt: at,
        grabbedTitle: title,
        downloadedAt: at,
      })
      .run()
  }

  it('без цифровой даты раздача без источника ждёт проката + 90 дней, из цифры — окна', async () => {
    const follow = insertMovieFollow()

    items = [
      { title: 'Сигнал / Signal (2026) 1080p | Дубляж', hash: NEW },
      { title: 'Сигнал / Signal (2026) CAMRip | Дубляж', hash: OLD },
    ]
    await followAutomation(new Date())

    // Экранка и раздача до релиза окна не начинают: строки серии нет
    expect(torrentByHash(NEW)).toBeUndefined()
    expect(episodeRow(follow.id, 0)).toBeUndefined()

    items = [
      ...items,
      {
        title: 'Сигнал / Signal (2026) WEB-DL 1080p | MVO',
        hash: 'd'.repeat(40),
      },
    ]
    requestFollowSearch(follow.id)
    await followAutomation(new Date())

    const decisions = episodeRow(follow.id, 0).decisions!
    const codes = (hash: string) =>
      decisions
        .find(item => item.infoHash === hash)
        ?.rejections
        .map(item => item.code)

    expect(codes('d'.repeat(40))).toEqual(['wait'])
    expect(codes(NEW)).toEqual(['not_available'])
    expect(codes(OLD)).toEqual(['screen_copy'])
  })

  it('цифровой релиз вышел — раздача без источника берётся как обычно', async () => {
    movieReleases = [
      {
        iso_3166_1: 'US',
        release_dates: [
          {
            certification: '',
            type: 4,
            release_date: `${day(-5)}T00:00:00.000Z`,
          },
        ],
      },
    ]

    const follow = insertMovieFollow()

    items = [{ title: 'Сигнал / Signal (2026) 1080p | MVO', hash: NEW }]
    await followAutomation(new Date())

    expect(
      episodeRow(follow.id, 0).decisions![0]!.rejections.map(
        item => item.code,
      ),
    ).toEqual(['wait'])
  })

  it('фильм в библиотеке с дубляжом в верхней ступени — слежение завершено', async () => {
    const follow = insertMovieFollow()

    seedMovie(follow, 'Сигнал / Signal (2026) WEB-DL 1080p | Дубляж', DAY_MS)

    expect(await completeMovie(followById(follow.id)!)).toBe(true)
    expect(followById(follow.id)).toMatchObject({
      state: 'done',
      nextSearchAt: null,
    })
  })

  it('многоголосый ждёт дубляжа 60 дней, потом слежение завершается', async () => {
    const follow = insertMovieFollow()

    seedMovie(follow, 'Сигнал / Signal (2026) WEB-DL 1080p | MVO', 10 * DAY_MS)
    expect(await completeMovie(followById(follow.id)!)).toBe(false)

    getDb()
      .update(followEpisodes)
      .set({ downloadedAt: new Date(Date.now() - 61 * DAY_MS) })
      .where(eq(followEpisodes.followId, follow.id))
      .run()
    expect(await completeMovie(followById(follow.id)!)).toBe(true)
  })
})
