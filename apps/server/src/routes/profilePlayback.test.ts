import type { PlaybackSession } from '../services/media/index.ts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, PROFILE_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { torrents, users } from '../db/schema.ts'
import {
  createProfile,
  defaultProfile,
  updateProfile,
} from '../services/profiles/index.ts'
import { bindSessionProfile } from '../services/profiles/playbackAccess.ts'
import { storeMetaCache } from '../services/tmdb/cache.ts'
import { movie } from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  stop: vi.fn(),
  cues: vi.fn(),
  playlist: vi.fn(),
  segment: vi.fn(),
}))
vi.mock('../services/media/index.ts', async original => ({
  ...(await original<typeof import('../services/media/index.ts')>()),
  getSession: mocks.get,
  stopSession: mocks.stop,
  sessionCues: mocks.cues,
  buildPlaylist: mocks.playlist,
}))
const app = createApp()
let profileId: string
let sourceId: string
let session: PlaybackSession
let cookies: Record<string, string>
let token: string
beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'hash' })
    .run()
  defaultProfile()
  profileId = createProfile({
    name: 'Child',
    color: 'violet',
    language: null,
    ageLimit: 12,
  }).id
  const torrent = getDb()
    .insert(torrents)
    .values({
      infoHash: 'a'.repeat(40),
      name: 'Synthetic',
      source: 'magnet',
      status: 'ready',
      titleId: 'tmdb:movie:901',
      files: [{ path: 'Synthetic.mp4', size: 100, padding: false }],
    })
    .returning()
    .get()
  sourceId = torrent.id
  storeMetaCache('tmdb:movie:901:ru-RU:v3', {
    ...movie,
    id: 901,
    release_dates: {
      results: [{ iso_3166_1: 'RU', release_dates: [{ certification: '6+' }] }],
    },
  })
  session = {
    id: 'playback-1',
    subject: 'owner',
    torrent,
    library: null,
    fileIndex: 0,
    media: { duration: 120 },
    hls: { starts: [0], segmentCount: 1, segment: mocks.segment },
  } as unknown as PlaybackSession
  bindSessionProfile(session, profileId)
  mocks.get.mockReturnValue(session)
  mocks.playlist.mockReturnValue('#EXTM3U')
  mocks.stop.mockResolvedValue(undefined)
  cookies = {
    [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access'),
    [PROFILE_COOKIE]: profileId,
  }
  token = signToken('owner', 'stream', 0, profileId)
})
afterAll(() => app.close())

it('rechecks cached classification for HLS and denies session metadata/subtitles/progress after age changes', async () => {
  expect(
    (await app.inject({ url: `/api/hls/playback-1/main.m3u8?token=${token}` }))
      .statusCode,
  ).toBe(200)
  updateProfile(profileId, { ageLimit: 6 })
  for (const url of [
    '/api/playback/playback-1',
    '/api/playback/playback-1/subtitles/s0',
    `/api/hls/playback-1/main.m3u8?token=${token}`,
    `/api/hls/playback-1/0.ts?token=${token}`,
  ])
    expect((await app.inject({ url, cookies })).statusCode, url).toBe(404)
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies,
        payload: { profileId, torrentId: sourceId, fileIndex: 0, position: 10 },
      })
    ).statusCode,
  ).toBe(404)
  expect(mocks.segment).not.toHaveBeenCalled()
  expect(mocks.cues).not.toHaveBeenCalled()
  updateProfile(profileId, { ageLimit: 12 })
})
it('profile switch blocks old session reads and progress, while stopping it still releases resources', async () => {
  const switched = { ...cookies, [PROFILE_COOKIE]: defaultProfile().id }
  expect(
    (await app.inject({ url: '/api/playback/playback-1', cookies: switched }))
      .statusCode,
  ).toBe(404)
  expect(
    (
      await app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies: switched,
        payload: { profileId, torrentId: sourceId, fileIndex: 0, position: 10 },
      })
    ).statusCode,
  ).toBe(404)
  expect(
    (
      await app.inject({
        method: 'DELETE',
        url: '/api/playback/playback-1',
        cookies: switched,
      })
    ).statusCode,
  ).toBe(200)
  expect(mocks.stop).toHaveBeenCalledWith(
    'playback-1',
    'client',
    expect.anything(),
  )
})
it('rechecks the actual source after its title mapping changes', async () => {
  getDb()
    .update(torrents)
    .set({ titleId: null })
    .where(eq(torrents.id, sourceId))
    .run()
  expect(
    (await app.inject({ url: `/api/hls/playback-1/main.m3u8?token=${token}` }))
      .statusCode,
  ).toBe(404)
})
