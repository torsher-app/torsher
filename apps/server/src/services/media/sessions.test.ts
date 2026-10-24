import type { Torrent } from '../../db/schema.ts'
import type { DeviceProfile } from './decide.ts'
import type { MediaInfo } from './probe.ts'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import { isStreaming } from '../storage/index.ts'
import { createSession, stopAllSessions, stopSession } from './sessions.ts'

const probe = vi.hoisted(() => ({
  pending: undefined as ((media: MediaInfo) => void) | undefined,
}))

vi.mock('./probe.ts', () => ({
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

const log = { info: () => {}, debug: () => {}, warn: () => {} }

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
})
