import type { Torrent } from '../../db/schema.ts'
import type { DeviceProfile } from './decide.ts'
import type { MediaInfo } from './probe.ts'
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import { isStreaming } from '../storage/index.ts'
import type { SessionLog } from './sessions.ts'
import {
  createSession,
  sessionCues,
  stopAllSessions,
  stopSession,
  validatedCheckpoint,
} from './sessions.ts'

const subtitleIndex = vi.hoisted(() => vi.fn())
const keyframes = vi.hoisted(() => ({ times: null as number[] | null }))
vi.mock('./cueCache.ts', () => ({
  loadTorrentCues: async () =>
    keyframes.times ? { times: keyframes.times } : null,
}))
vi.mock('./accel.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('./accel.ts')>()),
  mediaAccel: async () => ({
    mode: 'software',
    encoder: 'software',
    gpus: [],
    failed: [],
    software: true,
    softwareFps: 100,
    softwareMaxHeight: 720,
    gpuToneMapping: false,
    softwareToneMapping: false,
    toneMappingFps: null,
    toneMappingMaxHeight: 720,
    checkedAt: '2026-11-17',
  }),
}))
vi.mock('./matroska.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('./matroska.ts')>()),
  readSubtitleIndex: subtitleIndex,
}))

const probe = vi.hoisted(() => ({
  pending: undefined as ((media: MediaInfo) => void) | undefined,
}))

vi.mock('./probe.ts', async importOriginal => ({
  ...(await importOriginal<typeof import('./probe.ts')>()),
  probeMedia: () =>
    new Promise<MediaInfo>((resolve) => {
      probe.pending = resolve
    }),
}))

vi.mock('./tools.ts', () => ({
  mediaTools: async () => ({ status: 'ok', version: 'test' }),
}))

// MKV с AC3: Chrome его не играет — решение `hls`
const media: MediaInfo = {
  container: 'mkv',
  duration: 40,
  video: {
    index: 0,
    codec: 'h264',
    profile: 'High',
    width: 160,
    height: 90,
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
      language: 'rus',
      title: null,
      codec: 'ac3',
      channels: 6,
      bitrate: null,
      default: true,
    },
  ],
  subtitles: [],
}

const chrome: DeviceProfile = {
  containers: ['mp4', 'webm'],
  video: ['h264', 'vp9'],
  audio: ['aac', 'mp3', 'opus'],
  audioTracks: false,
  embeddedSubtitles: false,
  hls: true,
}

const log: SessionLog = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  child: () => log,
}

function torrentOf(id: string) {
  return {
    id,
    infoHash: id.padEnd(40, '0'),
    files: [{ path: 'Film.mkv', size: 1000, padding: false }],
  } as unknown as Torrent
}

async function probeStarted() {
  await vi.waitFor(() => expect(probe.pending).toBeDefined())

  const resolve = probe.pending!

  probe.pending = undefined
  return resolve
}

describe('сессии воспроизведения', () => {
  beforeAll(async () => {
    await migrateDb()
    // Порт без сервера: индекс MKV не прочитается, перепаковке он не обязателен
    setEngineReady('http://127.0.0.1:1')
  })

  afterAll(async () => {
    await stopAllSessions()
    setEngineDown('stopped')
  })

  it('раздача защищена с создания сессии до её закрытия', async () => {
    const torrent = torrentOf('direct')
    const session = createSession({
      subject: 'owner',
      torrent,
      fileIndex: 0,
      fileName: 'Film.mkv',
      preference: {},
      log,
    })

    expect(isStreaming(torrent.id)).toBe(true);

    (await probeStarted())(media)
    await session.ready
    expect(session.decision.mode).toBe('direct')
    expect(isStreaming(torrent.id)).toBe(true)

    await stopSession(session.id)
    expect(isStreaming(torrent.id)).toBe(false)
  })

  it('discards factual metadata when a library path changes while probing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'torsher-playback-revision-'))
    const path = join(root, 'movie.1080p.mkv')
    await writeFile(path, 'old')
    const source = {
      mediaFileId: 'checkpoint-file',
      torrentId: null,
      fileIndex: null,
    }
    const ref = { profileId: 'checkpoint-profile', titleId: 'tmdb:movie:1' }
    const session = createSession({
      subject: 'owner',
      progressRef: ref,
      library: { id: source.mediaFileId, path, size: 3 },
      fileIndex: 0,
      fileName: 'movie.1080p.mkv',
      preference: {},
      log,
    })
    let finish: ((result: MediaInfo) => void) | undefined
    try {
      finish = await probeStarted()
      const replacement = join(root, 'replacement')
      await writeFile(replacement, 'replacement')
      await rename(replacement, path)
      finish({
        ...media,
        video: { ...media.video!, width: 3840, height: 2160 },
        audio: [{ ...media.audio[0]!, title: 'MVO NewStudio' }],
      })
      await session.ready
      await stopSession(session.id)
      expect(validatedCheckpoint(session.id, 'owner', ref, source, 1)).toEqual({
        evidence: { ref: source },
        launchSelection: undefined,
        voice: null,
      })
    }
    finally {
      finish?.(media)
      await stopSession(session.id)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('кадр видео из пробы запоминается у раздачи', async () => {
    const torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: 'f'.repeat(40),
        name: 'Film',
        source: 'magnet',
        status: 'ready',
        files: [{ path: 'Film.mkv', size: 1000, padding: false }],
      })
      .returning()
      .get()
    const session = createSession({
      subject: 'owner',
      torrent,
      fileIndex: 0,
      fileName: 'Film.mkv',
      preference: {},
      log,
    });

    (await probeStarted())(media)
    await session.ready

    expect(
      getDb().select().from(torrents).where(eq(torrents.id, torrent.id)).get(),
    ).toMatchObject({ videoWidth: 160, videoHeight: 90 })

    await stopSession(session.id)
  })

  it('сессия, закрытая во время пробы, не держит раздачу и не запускает перепаковку', async () => {
    const torrent = torrentOf('closed')
    const session = createSession({
      subject: 'owner',
      torrent,
      fileIndex: 0,
      fileName: 'Film.mkv',
      device: chrome,
      preference: {},
      log,
    })
    const resolve = await probeStarted()

    await stopSession(session.id)
    resolve(media)
    await session.ready

    expect(isStreaming(torrent.id)).toBe(false)
    expect(session.hls).toBeNull()
  })

  it('uses the studio fallback without confirming or changing the saved voice type', async () => {
    const selected = {
      language: 'rus',
      studio: 'Red Head Sound',
      voiceType: 'MVO',
    }
    const session = createSession({
      subject: 'owner',
      torrent: torrentOf('studio-fallback'),
      fileIndex: 0,
      fileName: 'Film.mkv',
      preference: { selected },
      log,
    });
    (await probeStarted())({
      ...media,
      audio: [
        { ...media.audio[0]!, title: 'MVO NewStudio' },
        {
          ...media.audio[0]!,
          index: 3,
          title: 'Red Head Sound',
          default: false,
        },
      ],
    })
    try {
      await session.ready
      expect(session.audioStream).toBe(3)
      expect(session.preferenceMismatch).toEqual(['audio'])
      expect(selected).toEqual({
        language: 'rus',
        studio: 'Red Head Sound',
        voiceType: 'MVO',
      })
    }
    finally {
      await stopSession(session.id)
    }
  })

  it.each([1, 2])(
    'uses the selected audio end and never cuts beyond video (stream %i)',
    async (audioStream) => {
      keyframes.times = Array.from({ length: 31 }, (_, i) => i * 2)
      const raw = {
        ...media,
        duration: 75,
        video: { ...media.video!, startTime: 0, duration: 60, videoDelay: 0 },
        audio: [
          { ...media.audio[0]!, startTime: 0, duration: 60 },
          { ...media.audio[0]!, index: 2, startTime: 0, duration: 75 },
        ],
      }
      const session = createSession({
        subject: 'owner',
        torrent: torrentOf(`duration-${audioStream}`),
        fileIndex: 0,
        fileName: 'Film.mkv',
        preference: {},
        device: chrome,
        audioStream,
        log,
      });
      (await probeStarted())(raw)
      try {
        await session.ready
        expect(session.hls!.duration).toBe(audioStream === 1 ? 60 : 75)
        expect(session.hls!.starts.every(time => time < 60)).toBe(true)
        expect(session.media).toBe(raw)
        expect(raw.duration).toBe(75)
      }
      finally {
        keyframes.times = null
        await stopSession(session.id)
      }
    },
  )

  it.each([0, 2])(
    'selects exact encoding only for dense reordered keyframes (%i B frames)',
    async (videoDelay) => {
      keyframes.times = Array.from({ length: 61 }, (_, i) => i / 5 + 4)
      const session = createSession({
        subject: 'owner',
        torrent: torrentOf(`dense-${videoDelay}`),
        fileIndex: 0,
        fileName: 'Film.mkv',
        preference: {},
        device: chrome,
        log,
      });
      (await probeStarted())({
        ...media,
        startTime: 4,
        duration: 12,
        video: { ...media.video!, startTime: 4, duration: 12, videoDelay },
        audio: [{ ...media.audio[0]!, startTime: 4, duration: 12 }],
      })
      try {
        await session.ready
        expect(session.decision.mode).toBe('hls')
        expect(session.decision.video).toBe(videoDelay ? 'encode' : 'copy')
        expect(session.hls!.starts[1]).toBeCloseTo(2, 5)
        expect(session.hls!.duration).toBe(12)
      }
      finally {
        keyframes.times = null
        await stopSession(session.id)
      }
    },
  )

  describe('optional subtitle index', () => {
    const extracted = [{ start: 20, end: 25, text: 'Extracted' }]
    const overlapping = { start: 0, end: 40, text: 'Overlapping' }

    async function subtitleSession() {
      const session = createSession({
        subject: 'owner',
        torrent: torrentOf('subtitles'),
        fileIndex: 0,
        fileName: 'Film.mkv',
        preference: {},
        log,
      });
      (await probeStarted())({
        ...media,
        subtitles: [
          {
            index: 2,
            codec: 'subrip',
            language: 'eng',
            title: null,
            forced: false,
            default: false,
            text: true,
            image: false,
          },
        ],
      })
      await session.ready
      session.log = { ...log, warn: vi.fn() }
      session.hls = {
        cues: vi.fn().mockResolvedValue(extracted),
        stop: vi.fn().mockResolvedValue(undefined),
      } as unknown as NonNullable<typeof session.hls>
      return session
    }

    it.each(['builder', 'lookup'])(
      'preserves extracted cues after a rejected %s',
      async (stage) => {
        subtitleIndex.mockReset()
        const lookup = vi
          .fn()
          .mockRejectedValue(new Error('Range unavailable'))
        if (stage === 'builder')
          subtitleIndex.mockRejectedValue(new Error('Index unavailable'))
        else subtitleIndex.mockResolvedValue(lookup)
        const session = await subtitleSession()
        try {
          for (let request = 0; request < 2; request++) {
            expect(await sessionCues(session, 's2', 20)).toEqual({
              cues: extracted,
              done: false,
            })
          }
          expect(subtitleIndex).toHaveBeenCalledTimes(1)
          expect(lookup).toHaveBeenCalledTimes(stage === 'lookup' ? 1 : 0)
          expect(session.log.warn).toHaveBeenCalledTimes(1)
        }
        finally {
          await stopSession(session.id)
        }
      },
    )

    it('keeps extracted cues when an index has no usable subtitle references', async () => {
      const lookup = vi.fn().mockResolvedValue([])
      subtitleIndex.mockReset().mockResolvedValue(lookup)
      const session = await subtitleSession()
      try {
        expect(await sessionCues(session, 's2', 20)).toEqual({
          cues: extracted,
          done: false,
        })
        expect(lookup).toHaveBeenCalledWith(2, 20)
        expect(session.log.warn).not.toHaveBeenCalled()
      }
      finally {
        await stopSession(session.id)
      }
    })

    it('merges overlapping indexed cues with extracted cues', async () => {
      const lookup = vi.fn().mockResolvedValue([overlapping, ...extracted])
      subtitleIndex.mockReset().mockResolvedValue(lookup)
      const session = await subtitleSession()
      try {
        expect(await sessionCues(session, 's2', 20)).toEqual({
          cues: [overlapping, ...extracted],
          done: false,
        })
        expect(lookup).toHaveBeenCalledWith(2, 20)
        expect(session.log.warn).not.toHaveBeenCalled()
      }
      finally {
        await stopSession(session.id)
      }
    })

    it('looks up indexed subtitles in the source clock and returns normalized cues once', async () => {
      const lookup = vi
        .fn()
        .mockResolvedValue([{ start: 120, end: 125, text: 'Indexed' }])
      subtitleIndex.mockReset().mockResolvedValue(lookup)
      const session = await subtitleSession()
      session.media = { ...session.media!, startTime: 100 }
      try {
        expect(await sessionCues(session, 's2', 20)).toEqual({
          cues: [...extracted, { start: 20, end: 25, text: 'Indexed' }],
          done: false,
        })
        expect(lookup).toHaveBeenCalledWith(2, 120)
      }
      finally {
        await stopSession(session.id)
      }
    })

    it('still rejects when the main extraction fails', async () => {
      subtitleIndex.mockReset()
      const session = await subtitleSession()
      const error = new Error('Extraction failed')
      vi.mocked(session.hls!.cues).mockRejectedValue(error)
      try {
        await expect(sessionCues(session, 's2', 20)).rejects.toBe(error)
        expect(subtitleIndex).not.toHaveBeenCalled()
      }
      finally {
        await stopSession(session.id)
      }
    })
  })
})
