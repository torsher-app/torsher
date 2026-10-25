import type { Follow, Torrent } from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import { Buffer } from 'node:buffer'
import {
  link,
  mkdir,
  mkdtemp,
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
  followSeasons,
  indexers,
  mediaFiles,
  metaCache,
  profiles,
  releaseBlocklist,
  titleProgress,
  titleVoices,
  torrents,
  trackedTopics,
  watchStates,
} from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import { managedFolder } from '../library/files.ts'
import { checkLinkMode } from '../library/link.ts'
import { syncLibrary } from '../library/linker.ts'
import { clearSearchCache } from '../sources/cache.ts'
import { pinVoice } from '../sources/voices.ts'
import { tvOngoing } from '../tmdb/fixtures/index.ts'
import { carryMap } from '../torrents/refresh.ts'
import { resetGrabRetries } from './grab.ts'
import { followAutomation } from './schedule.ts'
import { resetFollowSearch } from './search.ts'
import { resetStallTracking } from './stalled.ts'
import { continueRefreshes, isTopicUpdate } from './topics.ts'
import { localDay } from './wanted.ts'

const disk = vi.hoisted(() => ({ total: 1024 ** 4, free: 512 * 1024 ** 3 }))

vi.mock('../storage/disk.ts', () => ({
  diskUsage: async () => ({ ...disk }),
}))

const SERIES = 'tmdb:tv:3000'
const DAY_MS = 24 * 60 * 60 * 1000
const OLD = 'a'.repeat(40)
const NEW = 'c'.repeat(40)
const TOPIC = 'https://tracker.example/topic/quiet'
const NAME = 'Quiet.Harbor.S02.1080p'
const OTHER_NAME = 'Quiet.Harbor.S02.1080p.WEB-DL'
const OLD_TITLE
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 12 (2024) WEB-DL 1080p | LostFilm'
const NEW_TITLE
  = 'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-9 из 12 (2024) WEB-DL 1080p | LostFilm'
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

// Идёт второй сезон из 12 серий: вышли 1–9, девятая — вчера
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
      episode_number: 9,
      air_date: day(-1),
    },
    next_episode_to_air: {
      season_number: 2,
      episode_number: 10,
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
      air_date: day(-1 - (8 - index) * 7),
      runtime: 50,
    })),
  }
}

function episodeFile(number: number) {
  return `Quiet.Harbor.S02E0${number}.1080p.WEB-DL.mkv`
}

/** Содержимое серии; перезалитая версия того же размера */
function content(number: number, version = 1) {
  return `episode ${number} version ${version}`.padEnd(200 + number, '.')
}

interface Version {
  name: string
  episodes: number[]
}

const versions = new Map<string, Version>()
// Серии, которые в новой версии перезалиты: на диске — прежнее содержимое
let reuploaded = new Set<number>()
let failCompare = false
let failAdd = 0
let live: EngineTorrentState[] = []
let engineCalls: string[] = []
let root = ''
let folderId = ''
let profileId = ''
let indexerId = ''

function details(hash: string) {
  const version = versions.get(hash)!

  return {
    infoHash: hash,
    name: version.name,
    pieceLength: 16_384,
    pieceCount: 1,
    files: version.episodes.map(number => ({
      path: episodeFile(number),
      length: content(number).length,
      padding: false,
    })),
  }
}

/** Сверка с каталогом, как у движка: содержимое против новой версии */
async function compared(hash: string, dir: string) {
  const version = versions.get(hash)!
  const base = details(hash)
  const files = await Promise.all(
    version.episodes.map(async (number, index) => {
      const data = await readFile(
        join(dir, version.name, episodeFile(number)),
        'utf8',
      ).catch(() => undefined)
      const expected = content(number, reuploaded.has(number) ? 2 : 1)
      const onDisk
        = data === undefined
          ? 'missing'
          : data === expected
            ? 'match'
            : 'differs'

      return { ...base.files[index]!, onDisk }
    }),
  )

  return { ...base, files }
}

/** Вымышленный `.torrent`: подделке движка нужен только infohash */
function torrentBytes(hash: string) {
  return Buffer.from(`d4:hash40:${hash}e`)
}

async function hashOf(body: RequestInit['body']) {
  const text = await new Response(body).text()

  return text.match(/[0-9a-f]{40}/)![0]
}

function searchXml(title: string, hash: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel>
<item>
  <title>${title}</title>
  <guid>${TOPIC}</guid>
  <comments>${TOPIC}</comments>
  <link>https://a.indexer.example/download/${hash}</link>
  <size>${12 * 1024 ** 3}</size>
  <torznab:attr name="seeders" value="30" />
  <torznab:attr name="infohash" value="${hash}" />
</item>
</channel></rss>`
}

let feed = { title: NEW_TITLE, hash: NEW }

function downloadsPath(...parts: string[]) {
  return join(root, 'torrents', ...parts)
}

function libraryFile(number: number) {
  return `${LIBRARY_DIR}/Quiet Harbor S02E0${number}.mkv`
}

function libraryPath(number: number) {
  return join(root, 'library', ...libraryFile(number).split('/'))
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

/**
 * Старая версия темы «1–8 из 12» скачана автоматикой: серии 6–8 выбраны и
 * лежат в библиотеке хардлинками, 1–5 — в библиотеке из другого места.
 * Серию 7 смотрели до 20-й минуты.
 */
async function seedOld(follow: Follow, name = NAME) {
  const episodes = [1, 2, 3, 4, 5, 6, 7, 8]

  versions.set(OLD, { name, episodes })

  for (const number of episodes) {
    await mkdir(downloadsPath(name), { recursive: true })
    await writeFile(downloadsPath(name, episodeFile(number)), content(number))
  }

  const old = getDb()
    .insert(torrents)
    .values({
      infoHash: OLD,
      name,
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
      selectedFiles: [5, 6, 7],
    })
    .returning()
    .get()

  for (const number of episodes) {
    const inLibrary = number >= 6

    if (inLibrary) {
      await mkdir(join(root, 'library', LIBRARY_DIR), { recursive: true })
      await link(downloadsPath(name, episodeFile(number)), libraryPath(number))
    }

    const info = inLibrary ? await stat(libraryPath(number)) : undefined

    getDb()
      .insert(mediaFiles)
      .values({
        folderId,
        relPath: libraryFile(number),
        size: content(number).length,
        mtime: info?.mtime ?? new Date(),
        inode: info?.ino ?? null,
        torrentId: inLibrary ? old.id : null,
        fileIndex: inLibrary ? number - 1 : null,
        linkMode: inLibrary ? 'hardlink' : null,
        titleId: SERIES,
        season: 2,
        episode: number,
        matchStatus: 'matched',
        matchSource: 'torrent',
      })
      .run()
  }

  for (const number of [6, 7, 8]) {
    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 2,
        episode: number,
        firstSeenAt: new Date(Date.now() - 30 * DAY_MS),
        torrentId: old.id,
        fileIndex: number - 1,
        grabbedAt: new Date(Date.now() - 30 * DAY_MS),
        downloadedAt: new Date(Date.now() - 29 * DAY_MS),
      })
      .run()
  }

  const topic = getDb()
    .insert(trackedTopics)
    .values({
      titleId: SERIES,
      indexerId,
      detailsUrl: TOPIC,
      torrentId: old.id,
      infoHash: OLD,
      releaseTitle: OLD_TITLE,
      season: 2,
      episodesTo: 8,
      episodesTotal: 12,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    })
    .returning()
    .get()

  getDb()
    .insert(followSeasons)
    .values({ followId: follow.id, season: 2, topicId: topic.id })
    .run()
  pinVoice(SERIES, 2, { studio: 'LostFilm' })
  getDb()
    .insert(watchStates)
    .values({
      profileId,
      torrentId: old.id,
      fileIndex: 6,
      position: 1200,
      duration: 3000,
    })
    .run()
  getDb()
    .insert(titleProgress)
    .values({
      profileId,
      titleId: SERIES,
      season: 2,
      episode: 7,
      position: 1200,
      duration: 3000,
      torrentId: old.id,
      fileIndex: 6,
      voiceStudio: 'LostFilm',
    })
    .run()

  return { old, topic }
}

function newVersion(name = NAME) {
  versions.set(NEW, { name, episodes: [1, 2, 3, 4, 5, 6, 7, 8, 9] })
}

function torrentByHash(hash: string) {
  return getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.infoHash, hash))
    .get()
}

function libraryRows() {
  return getDb()
    .select()
    .from(mediaFiles)
    .all()
    .sort((a, b) => a.episode! - b.episode!)
}

function episodeRows(followId: string) {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, followId))
    .all()
    .sort((a, b) => a.episode - b.episode)
}

function history(followId: string) {
  return getDb()
    .select()
    .from(followHistory)
    .where(eq(followHistory.followId, followId))
    .all()
}

function topicRow() {
  return getDb().select().from(trackedTopics).get()!
}

/** Новая версия скачана: все выбранные файлы целиком */
function completeState(torrent: Torrent): EngineTorrentState {
  const sizes = (torrent.files ?? []).map(file => file.size)

  return {
    infoHash: torrent.infoHash,
    paused: false,
    selected: torrent.selectedFiles ?? [],
    bytesCompleted: sizes.reduce((sum, size) => sum + size, 0),
    bytesWanted: 0,
    wantedCompleted: 0,
    queued: false,
    seeding: true,
    uploaded: 0,
    peers: { connected: 0, found: 0 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    fileProgress: sizes,
  }
}

beforeAll(async () => {
  await migrateDb()
  indexerId = getDb()
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
    .returning()
    .get()
    .id
  profileId = getDb()
    .insert(profiles)
    .values({ name: 'Viewer', color: 'blue' })
    .returning()
    .get()
    .id
})

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'torsher-topics-'))
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
  reuploaded = new Set()
  failCompare = false
  failAdd = 0
  live = []
  engineCalls = []
  feed = { title: NEW_TITLE, hash: NEW }
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

    if (url.pathname === '/torznab/api')
      return new Response(searchXml(feed.title, feed.hash))

    if (url.pathname.startsWith('/download/'))
      return new Response(torrentBytes(url.pathname.slice(-40)))

    if (url.host !== '127.0.0.1:4000')
      return json({ status_message: 'unexpected' }, 404)

    if (method !== 'GET' || url.pathname !== '/torrents')
      engineCalls.push(`${method} ${url.pathname}${url.search}`)

    if (url.pathname === '/torrents/inspect') {
      const hash = await hashOf(init.body)
      const dir = url.searchParams.get('dir')

      if (!dir)
        return json(details(hash))

      return failCompare
        ? json({ kind: 'internal', message: 'read failed' }, 500)
        : json(await compared(hash, dir))
    }

    if (url.pathname === '/torrents' && method === 'POST') {
      if (failAdd > 0) {
        failAdd--
        return json({ kind: 'internal', message: 'add failed' }, 500)
      }

      return json(details(await hashOf(init.body)))
    }

    if (url.pathname === '/torrents' && method === 'GET')
      return json(live)

    if (method === 'DELETE')
      return json({ deletedBytes: 0 })

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
  // Подмена запускает связыватель в фоне: он не должен писать в удаляемый каталог
  await syncLibrary()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  setEngineDown('stopped')
  await rm(root, { recursive: true, force: true })
})

describe('ключ и разбор темы', () => {
  it('новая версия — тот же сезон, студия и качество, серий не меньше', () => {
    expect(isTopicUpdate(OLD_TITLE, NEW_TITLE)).toBe(true)
    // Пак на весь сезон — тоже продолжение
    expect(
      isTopicUpdate(
        OLD_TITLE,
        'Тихая гавань / Quiet Harbor / Сезон: 2 (2024) WEB-DL 1080p | LostFilm',
      ),
    ).toBe(true)
    expect(isTopicUpdate(OLD_TITLE, NEW_TITLE.replace('1-9', '1-7'))).toBe(
      false,
    )
    expect(
      isTopicUpdate(OLD_TITLE, NEW_TITLE.replace('LostFilm', 'NewStudio')),
    ).toBe(false)
    expect(isTopicUpdate(OLD_TITLE, NEW_TITLE.replace('1080p', '720p'))).toBe(
      false,
    )
    expect(
      isTopicUpdate(OLD_TITLE, NEW_TITLE.replace('Сезон: 2', 'Сезон: 3')),
    ).toBe(false)
    // Раздача одной серии — не тема
    expect(
      isTopicUpdate(
        'Тихая гавань / Quiet Harbor / Сезон: 2 / Серия: 8 (2024) WEB-DL 1080p | LostFilm',
        'Тихая гавань / Quiet Harbor / Сезон: 2 / Серия: 9 (2024) WEB-DL 1080p | LostFilm',
      ),
    ).toBe(false)
  })

  it('карта файлов — по пути внутри раздачи и размеру', () => {
    const file = (path: string, size: number) => ({
      path,
      size,
      padding: false,
    })

    expect([
      ...carryMap(
        { name: 'A', files: [file('e1.mkv', 10), file('e2.mkv', 20)] },
        {
          name: 'B',
          files: [
            file('e0.mkv', 5),
            file('e1.mkv', 10),
            file('e2.mkv', 21),
            file('e3.mkv', 30),
          ],
        },
      ),
    ]).toEqual([[0, 1]])
  })
})

describe('подмена раздачи темы', () => {
  it('то же имя: серии 1–8 не качаются заново, прогресс и библиотека переходят к новой', async () => {
    const follow = insertFollow()
    const { old } = await seedOld(follow)
    const inodes = await Promise.all(
      [6, 7, 8].map(async number => (await stat(libraryPath(number))).ino),
    )

    newVersion()
    await followAutomation(new Date())

    const next = torrentByHash(NEW)!

    expect(torrentByHash(OLD)).toBeUndefined()
    expect(next).toMatchObject({
      titleId: SERIES,
      retention: 'keep',
      inEngine: true,
      origin: 'follow',
      selectedFiles: [5, 6, 7, 8],
      downloadDir: null,
    })

    const compare = engineCalls.findIndex(call =>
      call.startsWith('POST /torrents/inspect?dir='),
    )
    const forget = engineCalls.indexOf(`DELETE /torrents/${OLD}`)

    // Сверка — до `forget`, забывается старая без удаления файлов
    expect(compare).toBeGreaterThan(-1)
    expect(forget).toBeGreaterThan(compare)
    expect(engineCalls).toContain('POST /torrents?files=5,6,7,8')

    // Серии 1–8 лежат на месте: качается только девятая
    for (const number of [1, 2, 3, 4, 5, 6, 7, 8]) {
      expect(
        await readFile(downloadsPath(NAME, episodeFile(number)), 'utf8'),
      ).toBe(content(number))
    }

    expect(
      libraryRows()
        .filter(row => row.episode! >= 6)
        .map(row => [row.episode, row.torrentId, row.fileIndex, row.stale]),
    ).toEqual([
      [6, next.id, 5, false],
      [7, next.id, 6, false],
      [8, next.id, 7, false],
    ])
    expect(
      await Promise.all(
        [6, 7, 8].map(async number => (await stat(libraryPath(number))).ino),
      ),
    ).toEqual(inodes)
    expect(
      episodeRows(follow.id).map(row => [
        row.episode,
        row.torrentId,
        row.fileIndex,
      ]),
    ).toEqual([
      [6, next.id, 5],
      [7, next.id, 6],
      [8, next.id, 7],
      [9, next.id, 8],
    ])
    // Просмотренная серия сохраняет позицию
    expect(getDb().select().from(watchStates).all()).toEqual([
      expect.objectContaining({
        torrentId: next.id,
        fileIndex: 6,
        position: 1200,
      }),
    ])
    expect(getDb().select().from(titleProgress).get()).toMatchObject({
      torrentId: next.id,
      fileIndex: 6,
      position: 1200,
    })
    expect(topicRow()).toMatchObject({
      torrentId: next.id,
      infoHash: NEW,
      releaseTitle: NEW_TITLE,
      episodesTo: 9,
      refresh: null,
    })

    const updated = history(follow.id).find(
      row => row.kind === 'topic_updated',
    )

    expect(updated).toMatchObject({
      season: 2,
      episodes: [9],
      releaseTitle: NEW_TITLE,
      torrentId: next.id,
      params: { from: 8, to: 9, total: 12, carried: 8, redownload: 0 },
    })
    expect(old.id).not.toBe(next.id)

    // Девятая докачалась: в библиотеку ложится только она, без дублей
    await writeFile(downloadsPath(NAME, episodeFile(9)), content(9))
    live = [completeState(torrentByHash(NEW)!)]
    await syncLibrary()
    await syncLibrary()

    expect(libraryRows().map(row => [row.episode, row.torrentId])).toEqual([
      [1, null],
      [2, null],
      [3, null],
      [4, null],
      [5, null],
      [6, next.id],
      [7, next.id],
      [8, next.id],
      [9, next.id],
    ])
  })

  it('другое имя: перенесённые файлы — хардлинки в новой папке, старая папка убрана', async () => {
    const follow = insertFollow()

    await seedOld(follow)

    const inode = (await stat(libraryPath(7))).ino

    newVersion(OTHER_NAME)
    await followAutomation(new Date())

    const next = torrentByHash(NEW)!

    expect(torrentByHash(OLD)).toBeUndefined()
    expect(next.selectedFiles).toEqual([5, 6, 7, 8])
    expect((await stat(downloadsPath(OTHER_NAME, episodeFile(7)))).ino).toBe(
      inode,
    )
    // Старая папка убрана целиком, файлы библиотеки остались
    await expect(stat(downloadsPath(NAME))).rejects.toMatchObject({
      code: 'ENOENT',
    })
    expect(await readFile(libraryPath(7), 'utf8')).toBe(content(7))
    expect(
      libraryRows().filter(row => row.torrentId === next.id),
    ).toHaveLength(3)
    expect(topicRow().refresh).toBeNull()
  })

  it('перезалитая серия качается в новый inode, библиотека заменяет её на месте', async () => {
    const follow = insertFollow()

    await seedOld(follow)

    const before = libraryRows().find(row => row.episode === 7)!

    reuploaded = new Set([7])
    newVersion()
    await followAutomation(new Date())

    const next = torrentByHash(NEW)!

    // Перезалитая серия убрана из загрузок, библиотека пока при старой
    await expect(
      stat(downloadsPath(NAME, episodeFile(7))),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(libraryPath(7), 'utf8')).toBe(content(7))

    const stale = libraryRows().find(row => row.episode === 7)!

    expect(stale).toMatchObject({
      id: before.id,
      torrentId: next.id,
      stale: true,
    })
    expect(
      history(follow.id).find(row => row.kind === 'topic_updated')?.params,
    ).toMatchObject({ redownload: 1 })

    // Новая версия докачалась — встаёт на место прежней
    await writeFile(downloadsPath(NAME, episodeFile(7)), content(7, 2))
    await writeFile(downloadsPath(NAME, episodeFile(9)), content(9))
    live = [completeState(next)]
    await syncLibrary()
    await syncLibrary()

    const replaced = libraryRows().find(row => row.episode === 7)!

    expect(await readFile(libraryPath(7), 'utf8')).toBe(content(7, 2))
    expect(replaced).toMatchObject({
      id: before.id,
      relPath: before.relPath,
      stale: false,
    })
    expect(replaced.inode).not.toBe(before.inode)
    expect(libraryRows().filter(row => row.episode === 7)).toHaveLength(1)
    expect(getDb().select().from(titleProgress).get()).toMatchObject({
      position: 1200,
    })
  })

  it('сбой сверки при другом имени — запасной путь: рядом только новая серия', async () => {
    const follow = insertFollow()
    const { old } = await seedOld(follow)

    failCompare = true
    newVersion(OTHER_NAME)
    await followAutomation(new Date())

    const next = torrentByHash(NEW)!

    // Старая не тронута, ссылки в новой папке убраны
    expect(engineCalls).not.toContain(`DELETE /torrents/${OLD}`)
    expect(torrentByHash(OLD)).toMatchObject({ id: old.id, inEngine: true })
    await expect(
      stat(downloadsPath(OTHER_NAME, episodeFile(7))),
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(next).toMatchObject({ retention: 'keep', selectedFiles: [8] })
    expect(
      libraryRows()
        .filter(row => row.torrentId === old.id)
        .map(row => row.episode),
    ).toEqual([6, 7, 8])
    expect(episodeRows(follow.id).at(-1)).toMatchObject({
      episode: 9,
      torrentId: next.id,
      fileIndex: 8,
    })
    expect(topicRow()).toMatchObject({ torrentId: next.id, refresh: null })
    expect(
      history(follow.id).find(row => row.kind === 'topic_updated')?.params,
    ).toMatchObject({ fallback: true })
  })

  it('сбой сверки при том же имени — повтор позже, старая раздача на месте', async () => {
    const follow = insertFollow()
    const now = new Date()

    await seedOld(follow)
    failCompare = true
    newVersion()
    await followAutomation(now)

    expect(engineCalls).not.toContain(`DELETE /torrents/${OLD}`)
    expect(torrentByHash(OLD)).toMatchObject({ inEngine: true })
    expect(topicRow().refresh).toMatchObject({ stage: 'prepare' })
    // Серия «качается»: захват есть, файла ещё нет
    expect(episodeRows(follow.id).at(-1)).toMatchObject({
      episode: 9,
      torrentId: torrentByHash(NEW)!.id,
      fileIndex: null,
    })

    failCompare = false
    await continueRefreshes(new Date(now.getTime() + 60_000))
    expect(topicRow().refresh).toMatchObject({ stage: 'prepare' })

    await continueRefreshes(new Date(now.getTime() + 16 * 60_000))
    expect(torrentByHash(OLD)).toBeUndefined()
    expect(topicRow()).toMatchObject({ infoHash: NEW, refresh: null })
  })

  it('сбой движка после перепривязки — новая добавляется на следующем проходе', async () => {
    const follow = insertFollow()
    const now = new Date()

    await seedOld(follow)
    failAdd = 1
    newVersion()
    await followAutomation(now)

    const next = torrentByHash(NEW)!

    expect(torrentByHash(OLD)).toBeUndefined()
    expect(next).toMatchObject({ inEngine: false, retention: 'keep' })
    expect(topicRow().refresh).toMatchObject({ stage: 'relinked' })
    expect(
      libraryRows().filter(row => row.torrentId === next.id),
    ).toHaveLength(3)

    await continueRefreshes(new Date(now.getTime() + 16 * 60_000))

    expect(torrentByHash(NEW)).toMatchObject({
      inEngine: true,
      selectedFiles: [5, 6, 7, 8],
    })
    expect(topicRow().refresh).toBeNull()
  })

  it('перезапуск после `forget`: подмена продолжается по строкам, раздача не теряется', async () => {
    const follow = insertFollow()
    const { old, topic } = await seedOld(follow)

    newVersion()

    // Сервер остановился сразу после `forget` старой: новая уже в базе
    const next = getDb()
      .insert(torrents)
      .values({
        infoHash: NEW,
        name: NAME,
        source: 'file',
        torrentFile: torrentBytes(NEW),
        files: details(NEW).files.map(file => ({
          path: file.path,
          size: file.length,
          padding: false,
        })),
        pieceLength: 16_384,
        status: 'ready',
        titleId: SERIES,
        origin: 'follow',
      })
      .returning()
      .get()

    getDb()
      .update(torrents)
      .set({ inEngine: false })
      .where(eq(torrents.id, old.id))
      .run()
    getDb()
      .insert(followEpisodes)
      .values({
        followId: follow.id,
        season: 2,
        episode: 9,
        firstSeenAt: new Date(),
        torrentId: next.id,
        grabbedAt: new Date(),
      })
      .run()
    getDb()
      .update(trackedTopics)
      .set({
        refresh: {
          followId: follow.id,
          torrentId: next.id,
          title: NEW_TITLE,
          episodes: [{ season: 2, episode: 9 }],
          candidate: { id: 'next', title: NEW_TITLE, seeders: 30 },
          stage: 'prepare',
          forgotten: true,
        },
      })
      .where(eq(trackedTopics.id, topic.id))
      .run()

    await continueRefreshes(new Date())

    // Старую второй раз не забывали, новая добавлена с перенесёнными
    expect(engineCalls).not.toContain(`DELETE /torrents/${OLD}`)
    expect(engineCalls).toContain('POST /torrents?files=5,6,7,8')
    expect(torrentByHash(OLD)).toBeUndefined()
    expect(torrentByHash(NEW)).toMatchObject({ inEngine: true })
    expect(getDb().select().from(watchStates).get()).toMatchObject({
      torrentId: next.id,
      position: 1200,
    })
    expect(episodeRows(follow.id).at(-1)).toMatchObject({
      episode: 9,
      fileIndex: 8,
    })
    expect(topicRow().refresh).toBeNull()
  })

  it('та же тема с другой студией — не обновление: качается рядом, тема переходит на новую', async () => {
    const follow = insertFollow({ waitHours: 0 })
    const { old } = await seedOld(follow)

    feed = { title: NEW_TITLE.replace('LostFilm', 'NewStudio'), hash: NEW }
    newVersion(OTHER_NAME)
    await followAutomation(new Date())

    const next = torrentByHash(NEW)!

    expect(engineCalls.some(call => call.includes('inspect?dir='))).toBe(
      false,
    )
    expect(torrentByHash(OLD)).toMatchObject({ id: old.id, inEngine: true })
    expect(next.selectedFiles).toEqual([8])
    expect(topicRow()).toMatchObject({ torrentId: next.id, infoHash: NEW })
    expect(getDb().select().from(followSeasons).get()).toMatchObject({
      topicId: topicRow().id,
    })
  })
})
