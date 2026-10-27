import { Buffer } from 'node:buffer'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, PROFILE_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
} from '../db/schema.ts'
import { setEngineDown } from '../services/engine/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const thumb = vi.hoisted(() => ({ path: '' }))

// Кадр-превью без ffmpeg: путь к готовому файлу
vi.mock('../services/library/thumbs.ts', () => ({
  ensureThumb: async () => thumb.path,
}))

const app = createApp()
let root = ''
let owner: Record<string, string>
let hiddenFor: Record<string, string>
let visibleFor: Record<string, string>
let fileId = ''

beforeAll(async () => {
  await migrateDb()
  setEngineDown('stopped')
  root = await mkdtemp(join(tmpdir(), 'torsher-hidden-'))
  thumb.path = join(root, 'thumb.jpg')
  await writeFile(thumb.path, 'jpeg')
  await writeFile(join(root, 'Clip.mp4'), Buffer.alloc(4000))

  const user = createOwner({
    username: 'Owner',
    passwordHash: 'x',
  })

  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }

  const kids = (
    await app.inject({
      method: 'POST',
      url: '/api/profiles',
      cookies: owner,
      payload: { name: 'Kids', color: 'blue' },
    })
  ).json()
  const guest = (
    await app.inject({
      method: 'POST',
      url: '/api/profiles',
      cookies: owner,
      payload: { name: 'Guest', color: 'green' },
    })
  ).json()

  hiddenFor = { ...owner, [PROFILE_COOKIE]: kids.id }
  visibleFor = { ...owner, [PROFILE_COOKIE]: guest.id }

  const db = getDb()
  const library = db
    .insert(libraries)
    .values({ kind: 'home', name: 'Family' })
    .returning()
    .get()
  const folder = db
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: root })
    .returning()
    .get()

  fileId = db
    .insert(mediaFiles)
    .values({
      folderId: folder.id,
      relPath: 'Clip.mp4',
      size: 4000,
      mtime: new Date(),
    })
    .returning()
    .get()
    .id
  db.insert(libraryHiddenProfiles)
    .values({ libraryId: library.id, profileId: kids.id })
    .run()
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function stream(cookies: Record<string, string>, query = '') {
  return app.inject({
    url: `/api/library/files/${fileId}/stream${query}`,
    cookies,
  })
}

function thumbOf(cookies: Record<string, string>) {
  return app.inject({ url: `/api/library/files/${fileId}/thumb`, cookies })
}

function play(cookies: Record<string, string>) {
  return app.inject({
    method: 'POST',
    url: '/api/playback',
    cookies,
    payload: { mediaFileId: fileId },
  })
}

describe('files of a library hidden from the profile', () => {
  it('are not found for that profile', async () => {
    expect((await stream(hiddenFor)).statusCode).toBe(404)
    expect((await thumbOf(hiddenFor)).statusCode).toBe(404)
    expect((await play(hiddenFor)).statusCode).toBe(404)

    const position = await app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies: hiddenFor,
      payload: { mediaFileId: fileId, position: 60, duration: 600 },
    })

    expect(position.statusCode).toBe(404)
  })

  it('stay open to a profile that sees the library', async () => {
    expect((await stream(visibleFor)).statusCode).toBe(200)
    expect((await thumbOf(visibleFor)).statusCode).toBe(200)

    const res = await play(visibleFor)

    expect(res.statusCode).toBe(200)
    await app.inject({
      method: 'DELETE',
      url: `/api/playback/${res.json().sessionId}`,
      cookies: visibleFor,
    })
  })

  it('play with the owner stream token', async () => {
    const res = await stream(
      {},
      `?token=${signToken(
        (await app.inject({ url: '/api/users/me', cookies: owner })).json().id,
        'stream',
      )}`,
    )

    expect(res.statusCode).toBe(200)
  })
})
