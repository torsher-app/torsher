import { afterAll, beforeAll, expect, it } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { torrents, users } from '../db/schema.ts'
import { defaultProfile } from '../services/profiles/index.ts'
import { historySource } from '../services/sources/history.ts'
import {
  getTitleProgress,
  rememberChoice,
  rememberVoice,
} from '../services/sources/progress.ts'
import { getWatchState } from '../services/torrents/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const cookies = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
let torrentId: string
let profileId: string
beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'hash' })
    .run()
  profileId = defaultProfile().id
  torrentId = getDb()
    .insert(torrents)
    .values({
      infoHash: 'a'.repeat(40),
      name: 'Synthetic',
      source: 'magnet',
      status: 'ready',
      files: [{ path: 'Synthetic.mp4', size: 100, padding: false }],
    })
    .returning()
    .get()
    .id
})
afterAll(() => app.close())

function save(
  sequence: number,
  position: number,
  duration = 2000,
  episode = 1,
) {
  return app.inject({
    method: 'PUT',
    url: '/api/watch-state',
    cookies,
    payload: {
      torrentId,
      fileIndex: episode - 1,
      position,
      duration,
      title: { id: 'tmdb:tv:901', season: 1, episode },
      event: { clientId: 'client-A', sequence },
    },
  })
}

it('keeps the latest seek through A/B/A and rejects old or duplicate saves without changing either projection', async () => {
  expect((await save(1, 798)).statusCode).toBe(200)
  expect((await save(3, 921)).statusCode).toBe(200)
  const beforeFile = getWatchState(profileId, torrentId, 0)
  const ref = { profileId, titleId: 'tmdb:tv:901', season: 1, episode: 1 }
  const beforeTitle = getTitleProgress(ref)
  expect((await save(2, 798, 800)).statusCode).toBe(200)
  expect((await save(3, 999, 1000)).statusCode).toBe(200)
  expect(getWatchState(profileId, torrentId, 0)).toEqual(beforeFile)
  expect(getTitleProgress(ref)).toEqual(beforeTitle)
  expect((await save(4, 200, 1200)).statusCode).toBe(200)
  expect((await save(2, 798)).statusCode).toBe(200)
  expect(getWatchState(profileId, torrentId, 0)).toMatchObject({
    position: 200,
    duration: 1200,
  })
  expect(getTitleProgress(ref)).toMatchObject({
    position: 200,
    duration: 1200,
    watchedAt: null,
  })
})

it('does not let a different source roll back the same episode or alter its source reference', async () => {
  const other = getDb()
    .insert(torrents)
    .values({
      infoHash: 'b'.repeat(40),
      name: 'Alternate',
      source: 'magnet',
      status: 'ready',
      files: [{ path: 'Alternate.mp4', size: 100, padding: false }],
    })
    .returning()
    .get()
  const ref = { profileId, titleId: 'tmdb:tv:901', season: 1, episode: 1 }
  const before = getTitleProgress(ref)
  const response = await app.inject({
    method: 'PUT',
    url: '/api/watch-state',
    cookies,
    payload: {
      torrentId: other.id,
      fileIndex: 0,
      position: 999,
      duration: 1000,
      title: { id: ref.titleId, season: 1, episode: 1 },
      event: { clientId: 'client-A', sequence: 2 },
    },
  })
  expect(response.statusCode).toBe(200)
  expect(getTitleProgress(ref)).toEqual(before)
  expect(getWatchState(profileId, other.id, 0)).toBeUndefined()
})

it('orders each resource independently, accepts legacy clients and scopes events to the viewer', async () => {
  const { createProfile } = await import('../services/profiles/index.ts')
  const { PROFILE_COOKIE } = await import('../config.ts')
  const profile = createProfile({
    name: 'Other',
    color: 'violet',
    language: null,
    ageLimit: null,
  })
  const source = { torrentId, fileIndex: 0 }
  const put = (payload: object, viewer = profileId) =>
    app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies: { ...cookies, [PROFILE_COOKIE]: viewer },
      payload: { ...source, ...payload },
    })
  expect(
    (
      await put(
        { position: 10, event: { clientId: 'client-A', sequence: 1 } },
        profile.id,
      )
    ).statusCode,
  ).toBe(200)
  expect(getWatchState(profile.id, torrentId, 0)?.position).toBe(10)
  expect(
    (await put({ position: 20, event: { clientId: 'client-B', sequence: 1 } }))
      .statusCode,
  ).toBe(200)
  expect(getWatchState(profileId, torrentId, 0)?.position).toBe(20)
  expect((await put({ position: 30 })).statusCode).toBe(200)
  expect(getWatchState(profileId, torrentId, 0)?.position).toBe(30)
  // A delayed event for another file is still useful even after newer A saves.
  const other = getDb()
    .insert(torrents)
    .values({
      infoHash: 'c'.repeat(40),
      name: 'B',
      source: 'magnet',
      status: 'ready',
      files: [{ path: 'B.mp4', size: 100, padding: false }],
    })
    .returning()
    .get()
  expect(
    (
      await put({
        torrentId: other.id,
        position: 50,
        event: { clientId: 'client-A', sequence: 1 },
      })
    ).statusCode,
  ).toBe(200)
  expect(getWatchState(profileId, other.id, 0)?.position).toBe(50)
})

it('protects inferred library title and native-file progress as well as torrent progress', async () => {
  const { libraries, libraryFolders, mediaFiles }
    = await import('../db/schema.ts')
  const db = getDb()
  for (const kind of ['video', 'home'] as const) {
    const library = db
      .insert(libraries)
      .values({ kind, name: kind })
      .returning()
      .get()
    const folder = db
      .insert(libraryFolders)
      .values({ libraryId: library.id, path: '/synthetic' })
      .returning()
      .get()
    const file = db
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'Video.mp4',
        size: 10,
        mtime: new Date(),
        titleId: kind === 'video' ? 'tmdb:movie:902' : null,
      })
      .returning()
      .get()
    const put = (sequence: number, position: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies,
        payload: {
          mediaFileId: file.id,
          position,
          duration: 2000,
          event: { clientId: 'client-A', sequence },
        },
      })
    expect((await put(10, 900)).statusCode).toBe(200)
    expect((await put(11, 200)).statusCode).toBe(200)
    const ref = {
      profileId,
      titleId: kind === 'video' ? 'tmdb:movie:902' : `file:${file.id}`,
    }
    const before = getTitleProgress(ref)
    expect(before?.position).toBe(200)
    expect((await put(9, 799)).json().position).toBe(200)
    expect(getTitleProgress(ref)).toEqual(before)
  }
})

it('rolls back watermarks and both projections if the file write fails', async () => {
  const db = getDb()
  const ref = { profileId, titleId: 'tmdb:tv:901', season: 1, episode: 1 }
  const beforeTitle = getTitleProgress(ref)
  const beforeFile = getWatchState(profileId, torrentId, 0)
  db.$client.exec(
    'CREATE TEMP TRIGGER reject_progress BEFORE UPDATE ON watch_states BEGIN SELECT RAISE(ABORT, \'synthetic write failure\'); END',
  )
  try {
    expect((await save(100, 123)).statusCode).toBe(500)
    expect(getTitleProgress(ref)).toEqual(beforeTitle)
    expect(getWatchState(profileId, torrentId, 0)).toEqual(beforeFile)
  }
  finally {
    db.$client.exec('DROP TRIGGER reject_progress')
  }
  expect((await save(100, 123)).statusCode).toBe(200)
  expect(getTitleProgress(ref)?.position).toBe(123)
  expect(getWatchState(profileId, torrentId, 0)?.position).toBe(123)
})

it('keeps factual A history across same-episode B choice, stale events and a late A checkpoint until B plays', async () => {
  const alternate = getDb()
    .insert(torrents)
    .values({
      infoHash: 'd'.repeat(40),
      name: 'Alternate.2160p',
      source: 'magnet',
      status: 'ready',
      files: [{ path: 'Alternate.2160p.mp4', size: 100, padding: false }],
    })
    .returning()
    .get()
  const ref = { profileId, titleId: 'tmdb:tv:902', season: 1, episode: 1 }
  const put = (source: string, sequence: number, position: number) =>
    app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies,
      payload: {
        torrentId: source,
        fileIndex: 0,
        position,
        duration: 2000,
        title: { id: ref.titleId, season: 1, episode: 1 },
        event: { clientId: 'source-history', sequence },
      },
    })
  rememberChoice(ref, {
    torrentId,
    fileIndex: 0,
    voice: { studio: 'Voice A' },
  })
  expect((await put(torrentId, 3, 200)).statusCode).toBe(200)
  const played = getTitleProgress(ref)!
  expect(await historySource(played)).toMatchObject({
    torrentId,
    voice: null,
  })
  expect(played.voiceStudio).toBe('Voice A')
  rememberChoice(ref, {
    torrentId: alternate.id,
    fileIndex: 0,
    voice: { studio: 'Voice B' },
  })
  rememberVoice(
    ref,
    { studio: 'Voice B' },
    { torrentId: alternate.id, fileIndex: 0 },
  )
  const chosen = getTitleProgress(ref)!
  expect(chosen.updatedAt).toEqual(played.updatedAt)
  expect(chosen.lastPlayedAt).toEqual(played.lastPlayedAt)
  expect(await historySource(chosen)).toEqual(await historySource(played))
  expect((await put(alternate.id, 2, 999)).statusCode).toBe(200)
  expect(getTitleProgress(ref)).toEqual(chosen)
  expect((await put(torrentId, 4, 210)).statusCode).toBe(200)
  expect(await historySource(getTitleProgress(ref)!)).toMatchObject({
    torrentId,
    voice: null,
  })
  expect(getTitleProgress(ref)).toMatchObject({
    torrentId: alternate.id,
    voiceStudio: 'Voice B',
  })
  expect((await put(alternate.id, 5, 220)).statusCode).toBe(200)
  expect(await historySource(getTitleProgress(ref)!)).toMatchObject({
    torrentId: alternate.id,
    quality: '2160p',
    voice: null,
  })
  expect(getTitleProgress(ref)?.voiceStudio).toBe('Voice B')
})
