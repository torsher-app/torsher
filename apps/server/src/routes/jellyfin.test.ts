import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import {
  afterAll,
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
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
  profiles,
  titleProgress,
  torrents,
  users,
} from '../db/schema.ts'
import { hashToken, revokeDevice } from '../services/devices/index.ts'
import { itemId } from '../services/jellyfin/library.ts'
import { getMineRow } from '../services/mine/index.ts'
import {
  getTitleProgress,
  saveTitleProgress,
} from '../services/sources/progress.ts'
import {
  signinLimiter,
  updatePassword,
  updateUsername,
} from '../services/users/index.ts'
import { hashPassword } from '../utils/password.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const routes: { method: string, url: string }[] = []
app.addHook('onRoute', (route) => {
  if (!route.url.startsWith('/api') && route.url !== '*') {
    for (const method of Array.isArray(route.method)
      ? route.method
      : [route.method])
      routes.push({ method, url: route.url })
  }
})
let root: string
let token: string
let userId: string
let movieId: string
let movieFile: string
let secondFile: string
let episodeId: string
let videoId: string
const libraryId = randomUUID()
const profileId = randomUUID()
const ownerId = randomUUID()
const PASSWORD = 'example-password'
const ownerCookies = {
  [ACCESS_TOKEN_COOKIE]: signToken(ownerId, 'user_access'),
}
const auth = () => ({ 'X-Emby-Token': token })
async function login(prefix = '') {
  return app.inject({
    method: 'POST',
    url: `${prefix}/Users/AuthenticateByName`,
    payload: { Username: ' owner ', Pw: PASSWORD },
    headers: {
      Authorization:
        'MediaBrowser Client="Test player", Device="Test device", DeviceId="example", Version="1"',
    },
  })
}
async function list(url = '/Items?Recursive=true') {
  const response = await app.inject({ url, headers: auth() })
  expect(response.statusCode, response.body).toBe(200)
  return response.json()
}
beforeAll(async () => {
  await migrateDb()
  root = await mkdtemp(join(tmpdir(), 'torsher-jellyfin-'))
  getDb()
    .insert(users)
    .values({
      id: ownerId,
      username: 'Owner',
      passwordHash: await hashPassword(PASSWORD),
    })
    .run()
  getDb().delete(profiles).run()
  getDb()
    .insert(profiles)
    .values({ id: profileId, name: 'Viewer', color: 'violet', position: 0 })
    .run()
  getDb()
    .insert(libraries)
    .values({ id: libraryId, name: 'Example library', kind: 'video' })
    .run()
  const folder = getDb()
    .insert(libraryFolders)
    .values({ libraryId, path: root })
    .returning()
    .get()
  for (const [name, titleId, season, episode, episodeTo] of [
    ['Example.Movie.mkv', 'tmdb:movie:900001', 0, 0, null],
    ['Example.Movie.1080p.mkv', 'tmdb:movie:900001', 0, 0, null],
    ['Example.Show.S00E01.mkv', 'tmdb:tv:900002', 0, 1, null],
    ['Example.Show.S01E01-E02.mkv', 'tmdb:tv:900002', 1, 1, 2],
    ['Example.Show.S01E03.mkv', 'tmdb:tv:900002', 1, 3, null],
    ['Personal.Video.mp4', null, null, null, null],
  ] as const) {
    await writeFile(join(root, name), Buffer.from('0123456789'))
    const file = getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: name,
        size: 10,
        mtime: new Date(),
        titleId,
        season,
        episode,
        episodeTo,
        duration: 3600,
        matchStatus: titleId ? 'matched' : 'unmatched',
      })
      .returning()
      .get()
    if (name === 'Example.Movie.mkv')
      movieFile = file.id
    if (name === 'Example.Movie.1080p.mkv')
      secondFile = file.id
    if (!titleId)
      videoId = itemId('Video', libraryId, file.id)
  }
  movieId = itemId('Movie', libraryId, 'tmdb:movie:900001')
  episodeId = itemId('Episode', libraryId, 'tmdb:tv:900002', 1, 1, 2)
  await app.ready()
})
beforeEach(async () => {
  signinLimiter.reset('signin:127.0.0.1')
  getDb()
    .update(users)
    .set({ username: 'Owner', sessionVersion: 0, isActive: true })
    .where(eq(users.id, ownerId))
    .run()
  getDb().delete(libraryHiddenProfiles).run()
  getDb().delete(titleProgress).run()
  const response = await login()
  expect(response.statusCode, response.body).toBe(200)
  token = response.json().AccessToken
  userId = response.json().User.Id
})
afterAll(async () => {
  await app.close()
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('jellyfin authentication', () => {
  it('shares the owner verifier and stores only a fixed-profile opaque device credential', async () => {
    const device = getDb()
      .select()
      .from(devices)
      .where(eq(devices.tokenHash, hashToken(token)))
      .get()!
    expect(device).toMatchObject({
      purpose: 'jellyfin',
      profileId,
      ownerSessionVersion: 0,
      name: 'Test player (Test device)',
    })
    expect(token).not.toContain('.')
    const invalid = await app.inject({
      method: 'POST',
      url: '/Users/AuthenticateByName',
      payload: { Username: 'Owner', Pw: 'wrong' },
    })
    expect(invalid.statusCode).toBe(400)
    for (let i = 0; i < 9; i++) signinLimiter.hit('signin:127.0.0.1')
    expect((await login()).statusCode).toBe(429)
  })
  it('supports standard headers and query, rejects conflicts, foreign UserId and native tokens', async () => {
    for (const headers of [
      { 'X-MediaBrowser-Token': token },
      { Authorization: `Emby Token="${token}"` },
      { 'X-Emby-Authorization': `MediaBrowser Token="${token}"` },
    ]) {
      expect((await app.inject({ url: '/Users/Me', headers })).statusCode).toBe(
        200,
      )
    }
    expect(
      (await app.inject({ url: `/emby/Users/Me?api_key=${token}` })).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          url: '/Users/Me',
          headers: { ...auth(), 'X-MediaBrowser-Token': 'other' },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (await app.inject({ url: '/Items?UserId=foreign', headers: auth() }))
        .statusCode,
    ).toBe(403)
    expect(
      (await app.inject({ url: '/Users/foreign/Views', headers: auth() }))
        .statusCode,
    ).toBe(403)
    expect(
      (await app.inject({ url: '/Users/Me', cookies: ownerCookies }))
        .statusCode,
    ).toBe(401)
    getDb()
      .insert(devices)
      .values({ name: 'Native', type: 'tv', tokenHash: hashToken('native') })
      .run()
    expect(
      (
        await app.inject({
          url: '/Users/Me',
          headers: { 'X-Emby-Token': 'native' },
        })
      ).statusCode,
    ).toBe(401)
    const device = getDb()
      .select()
      .from(devices)
      .where(eq(devices.tokenHash, hashToken(token)))
      .get()!
    expect(
      (
        await app.inject({
          url: '/api/profiles',
          cookies: { [DEVICE_TOKEN_COOKIE]: token, ...ownerCookies },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          url: `/api/library/files/${movieFile}/stream?token=${signToken(`device:${device.id}`, 'stream')}`,
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          url: '/api/users/me',
          cookies: { [DEVICE_TOKEN_COOKIE]: token },
        })
      ).statusCode,
    ).toBe(401)
    expect(
      (await app.inject({ url: `/Users/Me?ApiKey=${token}` })).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ url: `/Users/Me?ApiKey=${token}&api_key=conflict` }))
        .statusCode,
    ).toBe(401)
  })
  it('revokes on owner session changes, logout and device deletion', async () => {
    updateUsername(ownerId, 'Changed')
    expect(
      (await app.inject({ url: '/Users/Me', headers: auth() })).statusCode,
    ).toBe(401)
    getDb()
      .update(users)
      .set({ username: 'Owner' })
      .where(eq(users.id, ownerId))
      .run()
    token = (await login()).json().AccessToken
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/Sessions/Logout',
          headers: auth(),
        })
      ).statusCode,
    ).toBe(204)
    expect(
      (await app.inject({ url: '/Users/Me', headers: auth() })).statusCode,
    ).toBe(401)
    token = (await login()).json().AccessToken
    revokeDevice(
      getDb()
        .select()
        .from(devices)
        .where(eq(devices.tokenHash, hashToken(token)))
        .get()!.id,
    )
    expect(
      (await app.inject({ url: '/Users/Me', headers: auth() })).statusCode,
    ).toBe(401)
  })
  it('revokes after password reset and rejects disabled owners', async () => {
    const passwordHash = getDb()
      .select()
      .from(users)
      .where(eq(users.id, ownerId))
      .get()!
      .passwordHash
    updatePassword(ownerId, passwordHash)
    expect(
      (await app.inject({ url: '/Items', headers: auth() })).statusCode,
    ).toBe(401)
    token = (await login()).json().AccessToken
    getDb()
      .update(users)
      .set({ isActive: false })
      .where(eq(users.id, ownerId))
      .run()
    expect(
      (await app.inject({ url: '/Items', headers: auth() })).statusCode,
    ).toBe(401)
  })
  it('never follows a reordered default or falls back after profile deletion', async () => {
    const other = getDb()
      .insert(profiles)
      .values({ name: 'Other', color: 'violet', position: -1 })
      .returning()
      .get()
    expect(
      (await app.inject({ url: '/Users/Me', headers: auth() })).json().Id,
    ).toBe(userId)
    // ON DELETE SET NULL is the actual device state after profile removal.
    getDb()
      .update(devices)
      .set({ profileId: null })
      .where(eq(devices.tokenHash, hashToken(token)))
      .run()
    expect(
      (await app.inject({ url: '/Users/Me', headers: auth() })).statusCode,
    ).toBe(401)
    getDb().delete(profiles).where(eq(profiles.id, other.id)).run()
  })
})

describe('jellyfin library and direct play', () => {
  it('serves the macOS player bootstrap and file metadata without exposing library paths', async () => {
    expect(await list('/UserViews/GroupingOptions')).toEqual([])
    expect(
      await list('/DisplayPreferences/usersettings?client=emby'),
    ).toMatchObject({ Client: 'emby', CustomPrefs: {} })
    const folders = await list('/Library/VirtualFolders')
    expect(
      folders.map((folder: { ItemId: string }) => folder.ItemId).sort(),
    ).toEqual(
      (await list('/UserViews')).Items.map(
        (view: { Id: string }) => view.Id,
      ).sort(),
    )
    expect(
      folders.every(
        (folder: { Locations: string[] }) => folder.Locations.length === 0,
      ),
    ).toBe(true)
    expect(await list('/Items/Counts')).toMatchObject({
      MovieCount: 1,
      SeriesCount: 1,
    })
    expect(await list('/UserItems/Resume')).toEqual(
      await list('/Items/Resume'),
    )
    const item = await list(`/Items/${movieId}`)
    expect(item.Path).toBe(item.MediaSources[0].Path)
    for (const source of item.MediaSources) {
      expect(source.Protocol).toBe('File')
      expect(source.Path).toMatch(
        /^\/Torsher\/[a-f\d]{32}\/Example\.Movie.*\.mkv$/,
      )
    }
    expect(JSON.stringify(item)).not.toContain(root)
    const range = await app.inject({
      url: `/videos/${movieId}/stream.mkv?static=true`,
      headers: { ...auth(), Range: 'bytes=2-5' },
    })
    expect(range.statusCode).toBe(206)
    expect(range.body).toBe('2345')
  })
  it('projects versions, specials and episode ranges with stable ids and offline metadata fallback', async () => {
    const result = await list()
    const movie = result.Items.find(
      (item: { Id: string }) => item.Id === movieId,
    )
    expect(
      movie.MediaSources.map((source: { Id: string }) => source.Id).sort(),
    ).toEqual(
      [movieFile, secondFile].map(id => id.replaceAll('-', '')).sort(),
    )
    expect(movie.MediaSources[0]).toMatchObject({
      SupportsDirectPlay: true,
      SupportsTranscoding: false,
    })
    expect(JSON.stringify(result)).not.toContain(root)
    expect(JSON.stringify(result)).not.toContain('TranscodingUrl')
    expect(
      result.Items.filter((item: { Type: string }) => item.Type === 'Episode'),
    ).toHaveLength(3)
    expect(
      result.Items.find((item: { Id: string }) => item.Id === episodeId),
    ).toMatchObject({
      IndexNumber: 1,
      IndexNumberEnd: 2,
      ParentIndexNumber: 1,
    })
    expect(
      result.Items.some(
        (item: { Type: string, IndexNumber: number }) =>
          item.Type === 'Season' && item.IndexNumber === 0,
      ),
    ).toBe(true)
    expect(
      (await list('/emby/Items?IncludeItemTypes=Movie&Limit=0'))
        .TotalRecordCount,
    ).toBe(1)
    const movies = await list(
      '/Items?Recursive=true&IncludeItemTypes=Movie&SearchTerm=Example&Limit=1',
    )
    expect(movies.TotalRecordCount).toBe(1)
    expect(movies.Items[0].Id).toBe(movieId)
    const views = await list(`/Users/${userId}/Views`)
    expect(
      views.Items.map(
        (item: { CollectionType: string }) => item.CollectionType,
      ).sort(),
    ).toEqual(['homevideos', 'movies', 'tvshows'])
  })
  it('serves Range and HEAD through both route prefixes and rejects foreign media sources', async () => {
    for (const prefix of ['', '/emby']) {
      const response = await app.inject({
        url: `${prefix}/Videos/${movieId}/stream.mkv?Static=true&MediaSourceId=${movieFile.replaceAll('-', '')}`,
        headers: { ...auth(), range: 'bytes=2-5' },
      })
      expect(response.statusCode, response.body).toBe(206)
      expect(response.body).toBe('2345')
      expect(response.headers['content-range']).toBe('bytes 2-5/10')
      const head = await app.inject({
        method: 'HEAD',
        url: `${prefix}/Videos/${movieId}/stream`,
        headers: auth(),
      })
      expect(head.statusCode).toBe(200)
      expect(head.body).toBe('')
      expect(head.headers['content-length']).toBe('10')
    }
    expect(
      (
        await app.inject({
          url: `/Videos/${movieId}/stream?MediaSourceId=foreign`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          url: `/Videos/${movieId}/stream`,
          headers: { ...auth(), range: 'bytes=20-' },
        })
      ).statusCode,
    ).toBe(416)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/Items/${movieId}/PlaybackInfo`,
          headers: auth(),
          payload: { MediaSourceId: 'foreign' },
        })
      ).statusCode,
    ).toBe(404)
  })
  it('hides a library on every item, image, playback, progress, favorite and stream path', async () => {
    getDb()
      .insert(libraryHiddenProfiles)
      .values({ libraryId, profileId })
      .run()
    for (const prefix of ['', '/emby']) {
      for (const [method, path, payload] of [
        ['GET', `/Items/${movieId}`],
        ['GET', `/Users/${userId}/Items/${movieId}`],
        ['GET', `/Items/${movieId}/Images/Primary`],
        ['GET', `/Items/${movieId}/PlaybackInfo`],
        ['GET', `/Videos/${movieId}/stream`],
        ['HEAD', `/Videos/${movieId}/stream.mkv`],
        [
          'POST',
          '/Sessions/Playing/Progress',
          { ItemId: movieId, PositionTicks: 100 },
        ],
        ['POST', `/Users/${userId}/PlayedItems/${movieId}`],
        ['POST', `/Users/${userId}/FavoriteItems/${movieId}`],
      ] as const) {
        const response = await app.inject({
          method,
          url: `${prefix}${path}`,
          headers: auth(),
          ...(payload ? { payload } : {}),
        })
        expect(response.statusCode, `${method} ${path}: ${response.body}`).toBe(
          404,
        )
      }
    }
    expect((await list()).TotalRecordCount).toBe(0)
    expect((await list(`/Users/${userId}/Items/Resume`)).TotalRecordCount).toBe(
      0,
    )
  })
  it('rejects missing files on stream, playback info and progress without leaking paths', async () => {
    await rm(join(root, 'Personal.Video.mp4'))
    try {
      for (const [method, url, payload] of [
        ['GET', `/Videos/${videoId}/stream`],
        ['GET', `/Items/${videoId}/PlaybackInfo`],
        ['GET', `/Items/${videoId}/Images/Primary`],
        ['POST', '/Sessions/Playing', { ItemId: videoId, PositionTicks: 10 }],
      ] as const) {
        const response = await app.inject({
          method,
          url,
          headers: auth(),
          ...(payload ? { payload } : {}),
        })
        expect(response.statusCode).toBe(404)
        expect(response.body).not.toContain(root)
      }
    }
    finally {
      await writeFile(join(root, 'Personal.Video.mp4'), '0123456789')
    }
  })
  it('does not advertise offline folders', async () => {
    getDb()
      .update(libraryFolders)
      .set({ status: 'offline' })
      .where(eq(libraryFolders.libraryId, libraryId))
      .run()
    try {
      expect((await list()).TotalRecordCount).toBe(0)
      expect(
        (
          await app.inject({
            url: `/Items/${movieId}/PlaybackInfo`,
            headers: auth(),
          })
        ).statusCode,
      ).toBe(404)
    }
    finally {
      getDb()
        .update(libraryFolders)
        .set({ status: 'ok' })
        .where(eq(libraryFolders.libraryId, libraryId))
        .run()
    }
  })
})

describe('jellyfin shared progress', () => {
  it('preserves resume when Playing/Stopped omit position and shares native updates', async () => {
    saveTitleProgress(
      { profileId, titleId: 'tmdb:movie:900001' },
      {
        position: 75,
        duration: 3600,
        torrentId: null,
        fileIndex: null,
        mediaFileId: movieFile,
      },
    )
    for (const path of ['Playing', 'Playing/Stopped']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/Sessions/${path}`,
            headers: auth(),
            payload: { ItemId: movieId },
          })
        ).statusCode,
      ).toBe(204)
      expect(
        getTitleProgress({ profileId, titleId: 'tmdb:movie:900001' })?.position,
      ).toBe(75)
    }
    const response = await app.inject({
      method: 'POST',
      url: '/Sessions/Playing/Progress',
      headers: auth(),
      payload: {
        ItemId: movieId,
        MediaSourceId: secondFile.replaceAll('-', ''),
        PositionTicks: 1_250_000_000,
      },
    })
    expect(response.statusCode).toBe(204)
    expect(
      getTitleProgress({ profileId, titleId: 'tmdb:movie:900001' }),
    ).toMatchObject({ position: 125, mediaFileId: secondFile })
    expect(
      (await list(`/Users/${userId}/Items/Resume`)).Items[0].UserData
        .PlaybackPositionTicks,
    ).toBe(1_250_000_000)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/Sessions/Playing/Progress',
          headers: auth(),
          payload: { ItemId: movieId, PositionTicks: -1 },
        })
      ).statusCode,
    ).toBe(400)
  })
  it('round-trips playback position through the native HTTP API', async () => {
    const native = await app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies: ownerCookies,
      payload: { mediaFileId: movieFile, position: 88, duration: 3600 },
    })
    expect(native.statusCode, native.body).toBe(200)
    expect(
      (await list(`/Users/${userId}/Items/Resume`)).Items[0].UserData
        .PlaybackPositionTicks,
    ).toBe(880_000_000)
    const written = await app.inject({
      method: 'POST',
      url: '/Sessions/Playing/Progress',
      headers: auth(),
      payload: { ItemId: movieId, PositionTicks: 9_000_000_000 },
    })
    expect(written.statusCode).toBe(204)
    const progress = await app.inject({
      url: '/api/titles/tmdb:movie:900001/progress',
      cookies: ownerCookies,
    })
    expect(progress.statusCode, progress.body).toBe(200)
    expect(progress.json().resume.position).toBe(900)
  })
  it('preserves torrent and file identity behind a library source', async () => {
    const torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: '0'.repeat(40),
        name: 'Synthetic source',
        source: 'file',
        status: 'ready',
      })
      .returning()
      .get()
    getDb()
      .update(mediaFiles)
      .set({ torrentId: torrent.id, fileIndex: 7 })
      .where(eq(mediaFiles.id, movieFile))
      .run()
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/Sessions/Playing/Progress',
        headers: auth(),
        payload: {
          ItemId: movieId,
          MediaSourceId: movieFile.replaceAll('-', ''),
          PositionTicks: 9_000_000_000,
        },
      })
      expect(response.statusCode).toBe(204)
      expect(
        getTitleProgress({ profileId, titleId: 'tmdb:movie:900001' }),
      ).toMatchObject({
        torrentId: torrent.id,
        fileIndex: 7,
        mediaFileId: movieFile,
        position: 900,
      })
    }
    finally {
      getDb()
        .update(mediaFiles)
        .set({ torrentId: null, fileIndex: null })
        .where(eq(mediaFiles.id, movieFile))
        .run()
      getDb().delete(torrents).where(eq(torrents.id, torrent.id)).run()
    }
  })
  it('keeps the selected version across playback reports that omit source or position', async () => {
    const db = getDb()
    const [first, selected] = [movieFile, secondFile].sort()
    const sources = ['1', '2'].map(digit =>
      db
        .insert(torrents)
        .values({
          infoHash: digit.repeat(40),
          name: 'Synthetic version',
          source: 'file',
          status: 'ready',
        })
        .returning()
        .get(),
    )
    const ref = { profileId, titleId: 'tmdb:movie:900001' }
    db.update(mediaFiles)
      .set({ duration: 1800, torrentId: sources[0]!.id, fileIndex: 3 })
      .where(eq(mediaFiles.id, first!))
      .run()
    db.update(mediaFiles)
      .set({ duration: 7200, torrentId: sources[1]!.id, fileIndex: 9 })
      .where(eq(mediaFiles.id, selected!))
      .run()
    const report = async (
      path: string,
      extra: Record<string, unknown> = {},
    ) => {
      const response = await app.inject({
        method: 'POST',
        url: `/Sessions/${path}`,
        headers: auth(),
        payload: { ItemId: movieId, ...extra },
      })
      expect(response.statusCode, response.body).toBe(204)
    }
    try {
      await report('Playing', {
        MediaSourceId: selected!.replaceAll('-', ''),
        PositionTicks: 33_000_000_000,
      })
      // VidHub resumes the first advertised source unless the viewer overrides it.
      const savedId = selected!.replaceAll('-', '')
      for (const url of [
        `/Items/${movieId}`,
        `/Items/${movieId}/PlaybackInfo`,
      ]) {
        const { MediaSources } = await list(url)
        expect(MediaSources.map((source: { Id: string }) => source.Id)).toEqual(
          [savedId, first!.replaceAll('-', '')],
        )
      }
      for (const path of ['Playing', 'Playing/Progress', 'Playing/Stopped']) {
        await report(path)
        expect(getTitleProgress(ref)).toMatchObject({
          mediaFileId: selected,
          torrentId: sources[1]!.id,
          fileIndex: 9,
          position: 3300,
          duration: 7200,
          watchedAt: null,
        })
        await report(path, { PositionTicks: 33_010_000_000 })
        expect(getTitleProgress(ref)).toMatchObject({
          mediaFileId: selected,
          torrentId: sources[1]!.id,
          fileIndex: 9,
          position: 3301,
          duration: 7200,
          watchedAt: null,
        })
        await report(path, { PositionTicks: 33_000_000_000 })
      }
      // When a probe is unavailable, only this same source may reuse its saved duration.
      db.update(mediaFiles)
        .set({ duration: null })
        .where(eq(mediaFiles.id, selected!))
        .run()
      await report('Playing/Stopped')
      expect(getTitleProgress(ref)).toMatchObject({
        mediaFileId: selected,
        duration: 7200,
        watchedAt: null,
      })
      await report('Playing', {
        MediaSourceId: first!.replaceAll('-', ''),
        PositionTicks: 100_000_000,
      })
      expect(getTitleProgress(ref)).toMatchObject({
        mediaFileId: first,
        torrentId: sources[0]!.id,
        fileIndex: 3,
        position: 10,
        duration: 1800,
        watchedAt: null,
      })

      // A stored source from another item cannot be reused or lend its duration.
      saveTitleProgress(ref, {
        mediaFileId: selected!,
        torrentId: sources[1]!.id,
        fileIndex: 9,
        position: 3300,
        duration: 7200,
      })
      db.update(mediaFiles)
        .set({ titleId: 'tmdb:movie:900003' })
        .where(eq(mediaFiles.id, selected!))
        .run()
      db.update(mediaFiles)
        .set({ duration: null })
        .where(eq(mediaFiles.id, first!))
        .run()
      await report('Playing/Progress')
      expect(getTitleProgress(ref)).toMatchObject({
        mediaFileId: first,
        torrentId: sources[0]!.id,
        fileIndex: 3,
        duration: null,
        watchedAt: null,
      })

      // Likewise, an unavailable previous version is never selected implicitly.
      db.update(mediaFiles)
        .set({ titleId: ref.titleId, state: 'missing' })
        .where(eq(mediaFiles.id, selected!))
        .run()
      saveTitleProgress(ref, {
        mediaFileId: selected!,
        torrentId: sources[1]!.id,
        fileIndex: 9,
        position: 3300,
        duration: 7200,
      })
      await report('Playing/Stopped')
      expect(getTitleProgress(ref)).toMatchObject({
        mediaFileId: first,
        torrentId: sources[0]!.id,
        fileIndex: 3,
        duration: null,
        watchedAt: null,
      })
    }
    finally {
      for (const id of [first!, selected!]) {
        db.update(mediaFiles)
          .set({
            titleId: ref.titleId,
            state: 'present',
            duration: 3600,
            torrentId: null,
            fileIndex: null,
          })
          .where(eq(mediaFiles.id, id))
          .run()
      }
      for (const source of sources)
        db.delete(torrents).where(eq(torrents.id, source.id)).run()
    }
  })
  it('infuse can mark and clear only the selected episode through the per-user alias', async () => {
    const ref = { profileId, titleId: 'tmdb:tv:900002', season: 1, episode: 1 }
    const other = {
      profileId,
      titleId: 'tmdb:tv:900002',
      season: 1,
      episode: 3,
    }
    const before = getTitleProgress(other)
    for (const method of ['POST', 'DELETE'] as const) {
      const response = await app.inject({
        method,
        url: `/UserPlayedItems/${episodeId}?UserId=${userId}`,
        headers: auth(),
      })
      expect(response.statusCode).toBe(200)
      expect(response.json().Played).toBe(method === 'POST')
      expect(!!getTitleProgress(ref)?.watchedAt).toBe(method === 'POST')
      expect(getTitleProgress(other)).toEqual(before)
    }
  })
  it('writes watched/favorites to canonical stores and rejects synthetic video favorites', async () => {
    for (const action of ['PlayedItems', 'FavoriteItems']) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/Users/${userId}/${action}/${movieId}`,
            headers: auth(),
          })
        ).statusCode,
      ).toBe(200)
    }
    expect(
      getTitleProgress({ profileId, titleId: 'tmdb:movie:900001' })?.watchedAt,
    ).toBeInstanceOf(Date)
    expect(
      getMineRow(profileId, 'tmdb:movie:900001')?.favoriteAt,
    ).toBeInstanceOf(Date)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/Users/${userId}/PlayedItems/${movieId}`,
          headers: auth(),
        })
      ).json().Played,
    ).toBe(false)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/Users/${userId}/FavoriteItems/${videoId}`,
          headers: auth(),
        })
      ).statusCode,
    ).toBe(400)
  })
})

it('audits every root and /emby protected route, including HEAD, before validation', async () => {
  const publicPaths = new Set([
    '/System/Info/Public',
    '/System/Ping',
    '/Users/Public',
    '/Users/AuthenticateByName',
  ])
  expect(routes.length).toBeGreaterThan(80)
  for (const route of routes) {
    if (publicPaths.has(route.url.replace(/^\/emby/, '')))
      continue
    const url = route.url
      .replace(/:extension/g, 'mkv')
      .replace(/:\w+/g, 'unknown')
    const response = await app.inject({ method: route.method as 'GET', url })
    expect(
      response.statusCode,
      `${route.method} ${route.url}: ${response.body}`,
    ).toBe(401)
  }
  expect(
    (await app.inject({ url: '/emby/NotImplemented', headers: auth() }))
      .statusCode,
  ).toBe(404)
  expect((await app.inject({ url: '/Users/Public' })).json()).toEqual([])
  expect(
    (
      await app.inject({ url: '/Persons?SearchTerm=Example', headers: auth() })
    ).json().Items,
  ).toEqual([])
})
