import type { MediaFile } from '../../db/schema.ts'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  unlink,
  utimes,
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
import { config } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
  profiles,
  serverSettings,
  torrents,
} from '../../db/schema.ts'
import { removeFolder, removeLibrary } from './folders.ts'
import { removeFromLibrary } from './index.ts'
import { localTitleImage, localTitleImages } from './images.ts'
import {
  queueProbe,
  queueUnprobed,
  regenerateThumbnails,
  thumbnailStatus,
} from './probe.ts'
import { scanFolder } from './scan.ts'
import { setAutomaticThumbnails } from './thumbnailSettings.ts'
import {
  cachedThumb,
  cleanupOrphanThumbs,
  ensureThumb,
  thumbArgs,
  thumbPathOf,
  thumbUrl,
} from './thumbs.ts'

const mock = vi.hoisted(() => ({
  duringRemove: undefined as (() => Promise<void>) | undefined,
  fail: false,
  missing: false,
  tools: true,
  storageError: undefined as string | undefined,
  unlinkError: undefined as string | undefined,
  during: undefined as (() => Promise<void>) | undefined,
}))
vi.mock('node:child_process', async original => ({
  ...(await original<typeof import('node:child_process')>()),
  execFile: vi.fn(),
}))
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return {
    ...actual,
    unlink: async (path: Parameters<typeof actual.unlink>[0]) => {
      if (mock.unlinkError) {
        throw Object.assign(new Error('Cache unavailable'), {
          code: mock.unlinkError,
        })
      }
      return actual.unlink(path)
    },
    writeFile: async (...args: Parameters<typeof actual.writeFile>) => {
      if (mock.storageError && String(args[0]).endsWith('.tmp.jpg')) {
        throw Object.assign(new Error('Output storage unavailable'), {
          code: mock.storageError,
        })
      }
      return actual.writeFile(...args)
    },
  }
})
vi.mock('./link.ts', async (original) => {
  const actual = await original<typeof import('./link.ts')>()
  return {
    ...actual,
    removeFile: async (...args: Parameters<typeof actual.removeFile>) => {
      await mock.duringRemove?.()
      return actual.removeFile(...args)
    },
  }
})
vi.mock('../media/tools.ts', () => ({
  mediaTools: async () => ({ status: mock.tools ? 'ok' : 'missing' }),
}))
vi.mock('../media/probe.ts', () => ({
  probeMedia: async () => ({
    container: 'mp4',
    duration: 0.4,
    video: null,
    audio: [],
    subtitles: [],
  }),
}))
let root = ''
let file: MediaFile
let source = ''

function current() {
  return getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.id, file.id))
    .get()!
}

beforeAll(async () => {
  await migrateDb()
})
beforeEach(async () => {
  mock.duringRemove = undefined
  mock.fail = false
  mock.missing = false
  mock.tools = true
  mock.storageError = undefined
  mock.unlinkError = undefined
  mock.during = undefined
  vi.mocked(execFile)
    .mockReset()
    .mockImplementation((...args: unknown[]) => {
      const callback = args[3] as (err: Error | null, stdout?: Buffer) => void
      void (async () => {
        await mock.during?.()
        if (mock.fail || mock.missing) {
          callback(
            Object.assign(new Error('Cannot render'), {
              code: mock.missing ? 'ENOENT' : 1,
            }),
          )
        }
        else {
          callback(null, Buffer.from('JPEG'))
        }
      })()
      return undefined as never
    })
  getDb().delete(libraries).run()
  getDb().delete(serverSettings).run()
  root = await mkdtemp(join(tmpdir(), 'torsher-thumbnails-'))
  vi.spyOn(config, 'dataDir', 'get').mockReturnValue(join(root, 'data'))
  source = join(root, 'short.mp4')
  await writeFile(source, 'video')
  const info = await stat(source)
  const library = getDb()
    .insert(libraries)
    .values({ kind: 'video', name: 'test' })
    .returning()
    .get()
  const folder = getDb()
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: root })
    .returning()
    .get()
  file = getDb()
    .insert(mediaFiles)
    .values({
      folderId: folder.id,
      relPath: 'short.mp4',
      size: info.size,
      mtime: new Date(info.mtimeMs),
      duration: 0.4,
      titleId: 'tmdb:tv:1',
      season: 0,
      episode: 1,
      episodeTo: 2,
    })
    .returning()
    .get()
})
afterEach(async () => {
  await queueProbe(file.id)
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('background library thumbnails', () => {
  it('backfills an existing file and does not decode it again on an unchanged scan', async () => {
    queueUnprobed()
    await queueProbe(file.id)
    const first = current()
    expect(first.thumb).toBeTruthy()
    await scanFolder(file.folderId)
    await queueProbe(file.id)
    expect(current().thumb).toBe(first.thumb)
    expect(execFile).toHaveBeenCalledTimes(1)
  })

  it('detects a changed size or mtime and repairs a lost image cache', async () => {
    await queueProbe(file.id)
    const first = current().thumb
    await writeFile(source, 'changed video')
    await scanFolder(file.folderId)
    await queueProbe(file.id)
    expect(current().thumb).not.toBe(first)
    const second = current().thumb
    const info = await stat(source)
    await utimes(source, info.atime, new Date(info.mtimeMs + 5000))
    await scanFolder(file.folderId)
    await queueProbe(file.id)
    expect(current().thumb).not.toBe(second)
    await unlink((await cachedThumb(current()))!)
    queueUnprobed()
    await queueProbe(file.id)
    expect(await cachedThumb(current())).toBeTruthy()
    expect(execFile).toHaveBeenCalledTimes(4)
  })

  it('keeps old frames with automatic generation off and accepts one manual job', async () => {
    await queueProbe(file.id)
    const first = current()
    setAutomaticThumbnails(false)
    await queueProbe(file.id)
    expect(execFile).toHaveBeenCalledTimes(1)
    expect(await readFile((await cachedThumb(current()))!, 'utf8')).toBe(
      'JPEG',
    )
    const started = regenerateThumbnails()
    expect(started).toMatchObject({
      running: true,
      total: 1,
      automatic: false,
    })
    regenerateThumbnails()
    await queueProbe(file.id)
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(thumbUrl(current())).not.toBe(thumbUrl(first))
    expect(thumbnailStatus()).toMatchObject({
      running: false,
      completed: 1,
      generated: 1,
    })
  })

  it('does not backfill while automatic generation is off', async () => {
    setAutomaticThumbnails(false)
    queueUnprobed()
    await queueProbe(file.id)
    expect(execFile).not.toHaveBeenCalled()
    expect(current().thumb).toBeNull()
  })

  it('retains old frames on failure, remembers failed revisions, and force retries', async () => {
    await queueProbe(file.id)
    const first = current()
    mock.fail = true
    regenerateThumbnails()
    await queueProbe(file.id)
    expect(current()).toMatchObject({
      thumb: first.thumb,
      thumbKey: first.thumbKey,
      thumbAttemptKey: first.thumbKey,
    })
    await queueProbe(file.id)
    expect(execFile).toHaveBeenCalledTimes(2)
    mock.fail = false
    regenerateThumbnails()
    await queueProbe(file.id)
    expect(execFile).toHaveBeenCalledTimes(3)
    expect(current().thumbAttemptKey).toBeNull()
  })

  it.each(['ENOSPC', 'EDQUOT', 'EIO', 'EROFS'])(
    'retries an unchanged file after output storage error %s',
    async (code) => {
      mock.storageError = code
      await queueProbe(file.id)
      expect(current().thumb).toBeNull()
      expect(current().thumbAttemptKey).toBeNull()
      mock.storageError = undefined
      await scanFolder(file.folderId)
      await queueProbe(file.id)
      expect(current().thumb).toBeTruthy()
      expect(execFile).toHaveBeenCalledTimes(2)
    },
  )

  it('does not record missing tools or inaccessible files as decode failures', async () => {
    mock.tools = false
    await queueProbe(file.id)
    expect(current().thumbAttemptKey).toBeNull()
    mock.tools = true
    mock.missing = true
    await queueProbe(file.id)
    expect(current().thumbAttemptKey).toBeNull()
    await unlink(source)
    await queueProbe(file.id)
    expect(current().thumbAttemptKey).toBeNull()
  })

  it('does not publish a frame when the input changes during rendering', async () => {
    mock.during = () => writeFile(source, 'a changed source')
    expect(await ensureThumb(file, source)).toBe(false)
    expect(current().thumb).toBeNull()
    expect(current().thumbAttemptKey).toBeNull()
    mock.during = undefined
  })

  it('does not publish a frame after the database row is removed', async () => {
    mock.during = async () => {
      getDb().delete(mediaFiles).where(eq(mediaFiles.id, file.id)).run()
    }
    expect(await ensureThumb(file, source)).toBe(false)
    expect(current()).toBeUndefined()
    mock.during = undefined
  })

  it('retains missing previews and only sweeps known orphan cache files at startup', async () => {
    await cleanupOrphanThumbs() // Cache directory has not been created yet.
    await queueProbe(file.id)
    const retained = current().thumb!
    getDb()
      .update(mediaFiles)
      .set({ state: 'missing' })
      .where(eq(mediaFiles.id, file.id))
      .run()
    const legacy = `${randomUUID()}.jpg`
    const revision = `${randomUUID()}-${randomUUID()}.jpg`
    const temp = `${revision}.tmp.jpg`
    const linked = `${randomUUID()}.jpg`
    for (const name of [legacy, revision, temp, 'unrelated.jpg'])
      await writeFile(thumbPathOf(name), 'cache')
    await mkdir(thumbPathOf(`${randomUUID()}.jpg`))
    await symlink(source, thumbPathOf(linked))
    await cleanupOrphanThumbs()
    await cleanupOrphanThumbs()
    expect(await readFile(thumbPathOf(retained), 'utf8')).toBe('JPEG')
    expect(await readFile(thumbPathOf('unrelated.jpg'), 'utf8')).toBe('cache')
    expect(await readFile(source, 'utf8')).toBe('video')
    const remaining = await readdir(join(root, 'data', 'thumbs'))
    for (const name of [legacy, revision, temp, linked])
      expect(remaining).not.toContain(name)
    expect(remaining).toHaveLength(3)
  })

  it.each(['folder', 'library'])(
    'cleans %s previews without removing sources or other previews',
    async (kind) => {
      await queueProbe(file.id)
      const deleted = current().thumb!
      const library = getDb()
        .insert(libraries)
        .values({ kind: 'home', name: 'Other' })
        .returning()
        .get()
      const folder = getDb()
        .insert(libraryFolders)
        .values({ libraryId: library.id, path: join(root, 'other') })
        .returning()
        .get()
      const retained = `${randomUUID()}.jpg`
      getDb()
        .insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath: 'other.mp4',
          size: 1,
          mtime: new Date(),
          thumb: retained,
        })
        .run()
      await writeFile(thumbPathOf(retained), 'other preview')
      const original = getDb()
        .select()
        .from(libraryFolders)
        .where(eq(libraryFolders.id, file.folderId))
        .get()!
      if (kind === 'folder')
        await removeFolder(file.folderId)
      else await removeLibrary(original.libraryId)
      expect(current()).toBeUndefined()
      expect(
        await stat(thumbPathOf(deleted)).catch(() => undefined),
      ).toBeUndefined()
      expect(await readFile(thumbPathOf(retained), 'utf8')).toBe(
        'other preview',
      )
      expect(await readFile(source, 'utf8')).toBe('video')
    },
  )

  it('keeps a successful database deletion when cache removal fails and retries at startup', async () => {
    await queueProbe(file.id)
    const preview = current().thumb!
    mock.unlinkError = 'EACCES'
    await expect(removeFolder(file.folderId)).resolves.toBeUndefined()
    expect(current()).toBeUndefined()
    expect(await readFile(thumbPathOf(preview), 'utf8')).toBe('JPEG')
    mock.unlinkError = undefined
    await cleanupOrphanThumbs()
    expect(await readdir(join(root, 'data', 'thumbs'))).toEqual([])
  })

  it('deleting a folder during regeneration removes old, new and temporary previews', async () => {
    await queueProbe(file.id)
    const previous = current()
    mock.during = () => removeFolder(file.folderId)
    expect(await ensureThumb(previous, source, true)).toBe(false)
    expect(current()).toBeUndefined()
    expect(await readdir(join(root, 'data', 'thumbs'))).toEqual([])
    expect(await readFile(source, 'utf8')).toBe('video')
    mock.during = undefined
  })

  it('unplacing managed media removes the current preview after waiting for file removal', async () => {
    await queueProbe(file.id)
    const previous = current().thumb!
    getDb().update(libraries).set({ managed: true }).run()
    const torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: randomUUID(),
        name: 'test',
        source: 'file',
        status: 'ready',
        retention: 'cache',
      })
      .returning()
      .get()
    getDb()
      .update(mediaFiles)
      .set({ torrentId: torrent.id })
      .where(eq(mediaFiles.id, file.id))
      .run()
    mock.duringRemove = async () => {
      expect(await ensureThumb(current(), source, true)).toBe(true)
      expect(current().thumb).not.toBe(previous)
    }
    await removeFromLibrary(torrent)
    expect(current()).toBeUndefined()
    expect(await readdir(join(root, 'data', 'thumbs'))).toEqual([])
    mock.duringRemove = undefined
  })

  it('preserves a force request arriving during normal thumbnail processing', async () => {
    let release!: () => void
    let entered!: () => void
    const entering = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    mock.during = async () => {
      entered()
      await gate
    }
    const pending = queueProbe(file.id)
    await entering
    regenerateThumbnails()
    regenerateThumbnails()
    mock.during = undefined
    release()
    await pending
    expect(execFile).toHaveBeenCalledTimes(2)
    expect(thumbnailStatus()).toMatchObject({
      running: false,
      completed: 1,
      generated: 1,
    })
  })

  it('returns only profile-visible images, including specials and episode ranges', async () => {
    await queueProbe(file.id)
    const profile = getDb()
      .insert(profiles)
      .values({ name: 'Thumb profile', color: 'blue' })
      .returning()
      .get()
    expect(localTitleImage(profile.id, 'tmdb:tv:1', 0, 2)).toBe(
      thumbUrl(current()),
    )
    expect(localTitleImage(profile.id, 'tmdb:tv:1', 0, 3)).toBeUndefined()
    const folder = getDb()
      .select()
      .from(libraryFolders)
      .where(eq(libraryFolders.id, file.folderId))
      .get()!
    getDb()
      .insert(libraryHiddenProfiles)
      .values({ libraryId: folder.libraryId, profileId: profile.id })
      .run()
    expect(localTitleImage(profile.id, 'tmdb:tv:1', 0, 1)).toBeUndefined()
    expect(
      localTitleImage(profile.id, 'tmdb:tv:1', 0, 1, file.id),
    ).toBeUndefined()
    getDb().delete(libraryHiddenProfiles).run()
    getDb()
      .update(libraryFolders)
      .set({ status: 'offline' })
      .where(eq(libraryFolders.id, file.folderId))
      .run()
    expect(localTitleImage(profile.id, 'tmdb:tv:1', 0, 1)).toBeUndefined()
  })

  it('loads images once for all episodes without loading probe payloads', async () => {
    await queueProbe(file.id)
    const prepare = vi.spyOn(getDb().$client, 'prepare')
    try {
      const image = localTitleImages('viewer', 'tmdb:tv:1')
      expect(image(0, 1)).toBeTruthy()
      for (let episode = 1; episode <= 1000; episode++) image(0, episode)
      expect(prepare).toHaveBeenCalledTimes(1)
      expect(prepare.mock.calls[0]![0]).not.toContain('"probe"')
    }
    finally {
      prepare.mockRestore()
    }
  })

  it('seeks within a subsecond clip and keeps safe FFmpeg input arguments', () => {
    const args = thumbArgs(source, 'out.jpg', 0.4)
    expect(Number(args[args.indexOf('-ss') + 1])).toBeLessThan(0.4)
    expect(args).toContain('-protocol_whitelist')
    expect(args).toContain('scale=640:-2,thumbnail=30')
  })
})
