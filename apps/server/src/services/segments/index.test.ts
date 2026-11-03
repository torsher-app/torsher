import type { MediaInfo } from '../media/probe.ts'
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
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
  libraries,
  libraryFolders,
  mediaAnalysis,
  mediaFiles,
} from '../../db/schema.ts'
import { trackStream } from '../storage/streams.ts'
import { playbackActive, trackPlayback } from './activity.ts'
import {
  identity,
  queueAnalysis,
  readySegments,
  startAnalysis,
  stopAnalysis,
} from './index.ts'
import { ANALYSIS_VERSION } from './model.ts'
import { credits, fingerprint } from './process.ts'

vi.mock('./process.ts', () => ({ credits: vi.fn(), fingerprint: vi.fn() }))
const probe: MediaInfo = {
  container: 'mp4',
  duration: 300,
  video: {
    index: 0,
    codec: 'h264',
    profile: null,
    width: 320,
    height: 180,
    highBitDepth: false,
    hdr: false,
    frameRate: 24,
    interlaced: false,
    bitrate: null,
    pixelAspect: 1,
  },
  audio: [
    {
      index: 1,
      codec: 'aac',
      language: 'eng',
      title: null,
      channels: 2,
      bitrate: null,
      default: true,
    },
  ],
  subtitles: [],
}
let root: string
let folderId: string
async function add(episode: number, suffix = '') {
  const name = `episode-${episode}${suffix}.mp4`
  await writeFile(join(root, name), 'synthetic')
  const info = await stat(join(root, name))
  return getDb()
    .insert(mediaFiles)
    .values({
      folderId,
      relPath: name,
      size: info.size,
      mtime: info.mtime,
      titleId: 'tmdb:tv:1',
      season: 1,
      episode,
      matchStatus: 'matched',
      probe,
      duration: 300,
      probeKey: `${info.size}:${info.mtimeMs}`,
    })
    .returning()
    .get()
}
beforeAll(async () => {
  await migrateDb()
})
beforeEach(async () => {
  vi.clearAllMocks()
  getDb().delete(libraries).run()
  root = await mkdtemp(join(tmpdir(), 'torsher-segments-'))
  const library = getDb()
    .insert(libraries)
    .values({ kind: 'video', name: 'Synthetic' })
    .returning()
    .get()
  folderId = getDb()
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: root })
    .returning()
    .get()
    .id
  vi.mocked(credits).mockResolvedValue([])
  vi.mocked(fingerprint).mockResolvedValue(
    Array.from({ length: 300 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0),
  )
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  startAnalysis()
})
afterEach(async () => {
  await stopAnalysis()
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})

// Fake timers are advanced separately; this wait uses the original timer.
const wait = vi.waitFor

describe('revisioned background analysis', () => {
  it('reads only current version, bytes and identity, with cascade deletion', async () => {
    const file = await add(1)
    getDb()
      .insert(mediaAnalysis)
      .values({
        fileId: file.id,
        revision: file.probeKey!,
        identity: identity(file),
        version: ANALYSIS_VERSION,
        updatedAt: new Date(),
        data: {
          status: 'ready',
          visualDone: true,
          audioTrack: 1,
          fingerprint: null,
          window: 300,
          references: [],
          segments: [
            {
              id: 'credits',
              kind: 'credits',
              source: 'visual',
              start: 250,
              end: 290,
            },
          ],
        },
      })
      .run()
    expect(await readySegments(file.id)).toHaveLength(1)
    getDb()
      .update(mediaFiles)
      .set({ episode: 2 })
      .where(eq(mediaFiles.id, file.id))
      .run()
    expect(await readySegments(file.id)).toEqual([])
    getDb()
      .update(mediaFiles)
      .set({ episode: 1 })
      .where(eq(mediaFiles.id, file.id))
      .run()
    await writeFile(join(root, file.relPath), 'replacement bytes')
    expect(await readySegments(file.id)).toEqual([])
    getDb().delete(mediaFiles).where(eq(mediaFiles.id, file.id)).run()
    expect(getDb().select().from(mediaAnalysis).all()).toEqual([])
  })
  it('blocks during playback, cancels running work and waits for shutdown', async () => {
    const file = await add(1)
    let aborted = false
    vi.mocked(credits).mockImplementation(
      (_path, _duration, signal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            'abort',
            () => {
              aborted = true
              reject(new Error('cancelled'))
            },
            { once: true },
          ),
        ),
    )
    const release = trackStream('synthetic-torrent')
    queueAnalysis(file.id)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(credits).not.toHaveBeenCalled()
    release()
    await vi.advanceTimersByTimeAsync(30_000)
    await wait(() => expect(credits).toHaveBeenCalled())
    const releaseDirect = trackPlayback()
    expect(aborted).toBe(true)
    releaseDirect()
    await stopAnalysis()
    expect(playbackActive()).toBe(false)
    expect(
      getDb()
        .select()
        .from(mediaAnalysis)
        .where(eq(mediaAnalysis.fileId, file.id))
        .get()
        ?.data
        .status,
    ).toBe('cancelled')
  })
  it('does not discard an ambiguous triangle when a fourth episode supports just one core', async () => {
    const files = await Promise.all(
      [1, 2, 3, 4].map(episode => add(episode)),
    )
    const noise = (seed: number, length: number) =>
      Array.from({ length }, () => {
        seed ^= seed << 13
        seed ^= seed >>> 17
        seed ^= seed << 5
        return seed >>> 0
      })
    const x = noise(10, 250)
    const y = noise(11, 250)
    vi.mocked(fingerprint).mockImplementation(async (path) => {
      const episode = Number(/episode-(\d+)/.exec(path)![1])
      return [
        ...noise(episode, 100),
        ...x,
        ...noise(episode + 20, 100),
        ...(episode === 4 ? noise(24, 250) : y),
        ...noise(episode + 30, 100),
      ]
    })
    queueAnalysis(files[0].id)
    await vi.advanceTimersByTimeAsync(30_000)
    await wait(() =>
      expect(
        getDb()
          .select()
          .from(mediaAnalysis)
          .where(eq(mediaAnalysis.fileId, files[0].id))
          .get()
          ?.data
          .status,
      ).toBe('no-match'),
    )
    expect(await readySegments(files[0].id)).toEqual([])
  })
  it('keeps confirmed credits when the optional fingerprint tool fails', async () => {
    const file = await add(1)
    vi.mocked(credits).mockResolvedValue([{ start: 270, end: 290 }])
    vi.mocked(fingerprint).mockRejectedValue(new Error('missing executable'))
    queueAnalysis(file.id)
    await vi.advanceTimersByTimeAsync(30_000)
    await wait(async () =>
      expect(await readySegments(file.id)).toHaveLength(1),
    )
    const result = getDb()
      .select()
      .from(mediaAnalysis)
      .where(eq(mediaAnalysis.fileId, file.id))
      .get()!
    expect(result.data.audioStatus).toBe('error')
    expect(result.data.segments[0].kind).toBe('credits')
  })
  it('does not publish analysis when bytes change during decoding', async () => {
    const file = await add(1)
    vi.mocked(credits).mockImplementation(async () => {
      await writeFile(join(root, file.relPath), 'changed during decoding')
      return [{ start: 270, end: 290 }]
    })
    queueAnalysis(file.id)
    await vi.advanceTimersByTimeAsync(30_000)
    await wait(() => expect(credits).toHaveBeenCalled())
    await stopAnalysis()
    expect(await readySegments(file.id)).toEqual([])
    expect(
      getDb()
        .select()
        .from(mediaAnalysis)
        .where(eq(mediaAnalysis.fileId, file.id))
        .get(),
    ).toBeUndefined()
  })
  it('does not analyze unresolved or short library files', async () => {
    const file = await add(1)
    getDb()
      .update(mediaFiles)
      .set({ matchStatus: 'unsure' })
      .where(eq(mediaFiles.id, file.id))
      .run()
    queueAnalysis(file.id)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(credits).not.toHaveBeenCalled()
    getDb()
      .update(mediaFiles)
      .set({ matchStatus: 'matched', duration: 60 })
      .where(eq(mediaFiles.id, file.id))
      .run()
    queueAnalysis(file.id)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(credits).not.toHaveBeenCalled()
  })
  it('needs three distinct episodes and retries the season when the third arrives', async () => {
    const a = await add(1)
    await add(1, '-alternate')
    await add(2)
    queueAnalysis(a.id)
    await vi.advanceTimersByTimeAsync(30_000)
    await wait(() =>
      expect(
        getDb()
          .select()
          .from(mediaAnalysis)
          .where(eq(mediaAnalysis.fileId, a.id))
          .get()
          ?.data
          .status,
      ).toBe('insufficient'),
    )
    expect(await readySegments(a.id)).toEqual([])
    const c = await add(3)
    queueAnalysis(c.id)
    await stopAnalysis()
    // Restart+queue models startup and verifies no stale insufficient-result latch.
    startAnalysis()
    queueAnalysis(c.id)
    await vi.advanceTimersByTimeAsync(30_000)
    await wait(async () =>
      expect(
        (await readySegments(a.id)).some(segment => segment.kind === 'intro'),
      ).toBe(true),
    )
  })
})
