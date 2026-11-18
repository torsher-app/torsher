import type { MediaInfo } from '../media/probe.ts'
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  profiles,
  titleProgress,
} from '../../db/schema.ts'
import { historySource } from '../sources/history.ts'
import { preparePlayedSource } from '../sources/playedSource.ts'
import { getTitleProgress, rememberVoice } from '../sources/progress.ts'
import { queueProbe } from './probe.ts'
import { scanFolder } from './scan.ts'
import { setAutomaticThumbnails } from './thumbnailSettings.ts'

const mocks = vi.hoisted(() => ({
  probes: new Map<string, MediaInfo>(),
  duringProbe: vi.fn<(revision: string) => void | Promise<void>>(),
  tools: true,
}))
vi.mock('../media/tools.ts', () => ({
  mediaTools: async () => ({ status: mocks.tools ? 'ok' : 'missing' }),
}))
vi.mock('../media/probe.ts', () => ({
  peekMediaProbe: (key: string) => mocks.probes.get(key),
  probeMedia: async (key: string, path: string) => {
    const cached = mocks.probes.get(key)
    if (cached)
      return cached
    const revision = await readFile(path, 'utf8')
    await mocks.duringProbe(revision)
    const old = revision === 'old'
    const probe: MediaInfo = {
      container: 'mkv',
      duration: 30,
      video: {
        width: old ? 1920 : 3840,
        height: old ? 1080 : 2160,
      } as MediaInfo['video'],
      audio: [],
      subtitles: [],
    }
    mocks.probes.set(key, probe)
    return probe
  },
}))
vi.mock('../segments/index.ts', () => ({ queueAnalysis: () => {} }))

let root: string
let path: string
let folderId: string
let profileId: string
const mtime = 2000.00075

function current() {
  return getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.folderId, folderId))
    .get()!
}

async function replaceWith(contents: string) {
  const replacement = join(root, '.replacement')
  await writeFile(replacement, contents)
  await utimes(replacement, mtime, mtime)
  await rename(replacement, path)
}

beforeAll(async () => {
  await migrateDb()
  profileId = getDb()
    .insert(profiles)
    .values({ name: 'History', color: 'blue' })
    .returning()
    .get()
    .id
  setAutomaticThumbnails(false)
})
beforeEach(async () => {
  mocks.tools = true
  mocks.probes.clear()
  mocks.duringProbe.mockReset()
  root = await mkdtemp(join(tmpdir(), 'torsher-library-revision-'))
  path = join(root, 'movie.mkv')
  await writeFile(path, 'old')
  await utimes(path, mtime, mtime)
  const library = getDb()
    .insert(libraries)
    .values({ name: 'Physical scan', kind: 'video' })
    .returning()
    .get()
  folderId = getDb()
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: root })
    .returning()
    .get()
    .id
})
afterEach(async () => {
  const file = current()
  if (file)
    await queueProbe(file.id)
  getDb()
    .delete(titleProgress)
    .where(eq(titleProgress.profileId, profileId))
    .run()
  getDb().delete(libraries).run()
  await rm(root, { recursive: true, force: true })
})

it('freezes stored quality when voice is chosen while the previous file is missing', async () => {
  await scanFolder(folderId)
  const file = current()
  await queueProbe(file.id)
  const ref = { profileId, titleId: 'tmdb:movie:1', season: 0, episode: 0 }
  getDb()
    .insert(titleProgress)
    .values({ ...ref, position: 10, mediaFileId: file.id })
    .run()
  await rename(path, join(root, '.offline'))
  await scanFolder(folderId)
  expect(current().state).toBe('missing')
  rememberVoice(ref, { studio: 'New studio' })
  expect(getTitleProgress(ref)).toMatchObject({
    playedSource: { mediaFileId: file.id, quality: '1080p', voice: null },
    voiceStudio: 'New studio',
    position: 10,
  })
})

it.each(['movie.mkv', 'movie.2160p.mkv'])(
  'freezes legacy basename quality before a rename to %s',
  async (nextPath) => {
    mocks.tools = false
    const original = join(root, 'movie.1080p.mkv')
    await rename(path, original)
    await scanFolder(folderId)
    const file = current()
    await queueProbe(file.id)
    const ref = { profileId, titleId: 'tmdb:movie:1', season: 0, episode: 0 }
    getDb()
      .insert(titleProgress)
      .values({ ...ref, position: 10, mediaFileId: file.id })
      .run()
    await rename(original, join(root, nextPath))
    expect(await scanFolder(folderId)).toMatchObject({
      added: [],
      changed: [],
      missing: 0,
    })
    await queueProbe(file.id)
    expect(current()).toMatchObject({
      id: file.id,
      relPath: nextPath,
      inode: file.inode,
      state: 'present',
    })
    expect(getTitleProgress(ref)).toMatchObject({
      playedSource: { mediaFileId: file.id, quality: '1080p' },
      position: 10,
    })
    expect(mocks.duringProbe).not.toHaveBeenCalled()
  },
)

it.each(['new size', 'missing then replaced', 'same size and mtime'] as const)(
  'freezes legacy quality before changing a stored file revision (%s)',
  async (replacement) => {
    await scanFolder(folderId)
    const id = current().id
    await queueProbe(id)
    const old = current()
    const info = await stat(path)
    expect(Math.round(info.mtimeMs)).toBe(old.mtime.getTime() + 1)
    expect(old.probe?.video?.height).toBe(1080)
    const ref = { profileId, titleId: 'tmdb:movie:1', season: 0, episode: 0 }
    getDb()
      .insert(titleProgress)
      .values({ ...ref, position: 10, mediaFileId: id })
      .run()
    expect(await historySource(getTitleProgress(ref)!)).toMatchObject({
      quality: '1080p',
    })

    if (replacement === 'missing then replaced') {
      await rename(path, join(root, '.previous'))
      await scanFolder(folderId)
      expect(current().state).toBe('missing')
    }
    await replaceWith(replacement === 'new size' ? 'new byte pattern' : 'new')
    const changed = await stat(path)
    expect(changed.ino).not.toBe(old.inode)
    if (replacement === 'same size and mtime') {
      expect(changed.size).toBe(old.size)
      expect(changed.mtimeMs).toBe(info.mtimeMs)
      const beforeScan = await preparePlayedSource({
        mediaFileId: id,
        torrentId: null,
        fileIndex: null,
      })
      expect(beforeScan?.video).toBeUndefined()
    }

    expect((await scanFolder(folderId))?.changed).toEqual([id])
    await queueProbe(id)
    expect(current()).toMatchObject({
      id,
      state: 'present',
      probe: { video: { height: 2160 } },
    })
    expect(getTitleProgress(ref)?.playedSource).toMatchObject({
      mediaFileId: id,
      quality: '1080p',
    })
    expect(await historySource(getTitleProgress(ref)!)).toMatchObject({
      quality: '1080p',
    })
  },
)

it('discards a late probe after a new inode was scanned and retries the new revision', async () => {
  let began!: () => void
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const entered = new Promise<void>((resolve) => {
    began = resolve
  })
  let beforeNewProbe: ReturnType<typeof current> | undefined
  mocks.duringProbe.mockImplementation((revision) => {
    if (revision === 'old') {
      began()
      return gate
    }
    beforeNewProbe = current()
  })
  await scanFolder(folderId)
  const old = current()
  const pending = queueProbe(old.id)
  try {
    await entered
    await replaceWith('new')
    expect((await scanFolder(folderId))?.changed).toEqual([old.id])
  }
  finally {
    release()
    await pending
  }
  expect(beforeNewProbe).toMatchObject({
    id: old.id,
    probeKey: null,
    probe: null,
  })
  expect(current().probe?.video?.height).toBe(2160)
})
