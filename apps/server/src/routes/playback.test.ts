import type { AddressInfo } from 'node:net'
import type { Torrent } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { torrents, users } from '../db/schema.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import {
  INFO_HASH,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import { stopAllSessions } from '../services/media/index.ts'
import { resetMediaTools } from '../services/media/tools.ts'
import { rememberChoice } from '../services/sources/progress.ts'
import { signToken } from '../utils/token.ts'

vi.mock('../services/storage/disk.ts', () => ({
  diskUsage: async () => ({ total: 1e12, free: 5e11 }),
}))

function hasFfmpeg() {
  // В `.env.test` ffmpeg нет нарочно: здесь нужен настоящий
  vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
  vi.stubEnv('FFPROBE_PATH', 'ffprobe')
  resetMediaTools()

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }

// Профили как у витрины: Chrome на Mac и webOS
const chrome = {
  containers: ['mp4', 'webm'],
  video: ['h264', 'vp9'],
  audio: ['aac', 'mp3', 'opus'],
  audioTracks: false,
  embeddedSubtitles: false,
  hls: true,
}

const webos = {
  containers: ['mp4', 'webm', 'mkv'],
  video: ['h264', 'hevc'],
  audio: ['aac', 'mp3', 'ac3', 'eac3'],
  audioTracks: true,
  embeddedSubtitles: false,
  hls: true,
}

describe.runIf(hasFfmpeg())('воспроизведение с пробой и перепаковкой', () => {
  const app = createApp()
  let dir = ''
  // Внешние русские субтитры в Windows-1251, как в старых раздачах
  const srt = Buffer.from(
    new Uint8Array([
      ...Buffer.from('1\n00:00:01,000 --> 00:00:02,000\n'),
      0xCF,
      0xF0,
      0xE8,
      0xE2,
      0xE5,
      0xF2,
      ...Buffer.from('\n\n'),
    ]),
  )
  let mkv = Buffer.alloc(0)
  let files: { path: string, size: number, padding: boolean }[] = []
  const engine = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://engine')

    if (request.method === 'POST' && url.pathname === '/torrents') {
      response.setHeader('Content-Type', 'application/json')
      response.end(
        JSON.stringify({
          infoHash: INFO_HASH,
          name: 'Film',
          pieceLength: 262_144,
          pieceCount: 1,
          files: files.map(file => ({
            path: file.path,
            length: file.size,
            padding: false,
          })),
        }),
      )
      return
    }

    if (url.pathname === '/torrents') {
      response.setHeader('Content-Type', 'application/json')
      response.end('[]')
      return
    }

    const match = /\/files\/(\d+)\/stream$/.exec(url.pathname)
    const body = match ? (match[1] === '0' ? mkv : srt) : undefined

    if (!body) {
      response.statusCode = 404
      response.end()
      return
    }

    // Поток с Range, как у движка
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '')
    const start = range ? Number(range[1]) : 0
    const end = range?.[2]
      ? Math.min(Number(range[2]), body.length - 1)
      : body.length - 1

    if (start >= body.length) {
      response.statusCode = 416
      response.end()
      return
    }

    response.statusCode = range ? 206 : 200
    response.setHeader('Accept-Ranges', 'bytes')
    response.setHeader('Content-Length', end - start + 1)

    if (range) {
      response.setHeader(
        'Content-Range',
        `bytes ${start}-${end}/${body.length}`,
      )
    }

    response.end(body.subarray(start, end + 1))
  })

  let torrent: Torrent

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'torsher-playback-'))

    const movie = join(dir, 'Film.mkv')

    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=24',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000',
      '-f',
      'lavfi',
      '-i',
      'sine=f=660:r=48000',
      '-t',
      '20',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2:a',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-g',
      '48',
      '-c:a:0',
      'ac3',
      '-c:a:1',
      'eac3',
      '-metadata:s:a:0',
      'language=rus',
      '-metadata:s:a:0',
      'title=MVO NewStudio',
      '-metadata:s:a:1',
      'language=rus',
      '-metadata:s:a:1',
      'title=MVO LostFilm',
      '-disposition:a:0',
      'default',
      '-disposition:a:1',
      '0',
      movie,
    ])
    mkv = readFileSync(movie)
    files = [
      { path: 'Film (2024)/Film.2024.mkv', size: mkv.length, padding: false },
      {
        path: 'Film (2024)/Film.2024.rus.srt',
        size: srt.length,
        padding: false,
      },
    ]

    await new Promise<void>(resolve =>
      engine.listen(0, '127.0.0.1', resolve),
    )
    setEngineReady(
      `http://127.0.0.1:${(engine.address() as AddressInfo).port}`,
    )

    migrateDb()
    getDb()
      .insert(users)
      .values({
        id: 'owner',
        name: 'Owner',
        email: 'owner@example.com',
        passwordHash: 'hash',
      })
      .run()
    torrent = getDb()
      .insert(torrents)
      .values({
        infoHash: INFO_HASH,
        name: 'Film (2024)',
        source: 'file',
        torrentFile: Buffer.from(sampleTorrentFile()),
        files,
        pieceLength: 262_144,
        status: 'ready',
      })
      .returning()
      .get()
  })

  afterAll(async () => {
    await stopAllSessions()
    setEngineDown('stopped')
    engine.close()
    rmSync(dir, { recursive: true, force: true })
  })

  async function start(payload: Record<string, unknown> = {}) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: { torrentId: torrent.id, fileIndex: 0, ...payload },
    })

    expect(response.statusCode).toBe(200)

    let body = response.json()

    while (body.status === 'probing') {
      await new Promise(resolve => setTimeout(resolve, 100))
      body = (
        await app.inject({
          url: `/api/playback/${body.sessionId}`,
          cookies: owner,
        })
      ).json()
    }

    return body
  }

  it('отдаёт дорожки файла и внешние субтитры', async () => {
    const body = await start()

    expect(body).toMatchObject({
      status: 'ready',
      mode: 'direct',
      duration: 20,
      audioStream: 1,
      media: {
        container: 'mkv',
        video: { codec: 'h264', width: 160, height: 90 },
        audio: [
          {
            index: 1,
            codec: 'ac3',
            language: 'rus',
            studio: 'NewStudio',
            voiceType: 'MVO',
            default: true,
          },
          {
            index: 2,
            codec: 'eac3',
            language: 'rus',
            studio: 'LostFilm',
            voiceType: 'MVO',
            default: false,
          },
        ],
        subtitles: [{ id: 'f1', language: 'rus', external: true }],
      },
    })
    expect(body.streamUrl).toMatch(/^\/api\/stream\//)
  })

  it('webOS играет MKV напрямую и меняет озвучку сам', async () => {
    const body = await start({ device: webos })

    expect(body).toMatchObject({
      mode: 'direct',
      audioSwitch: 'platform',
      reasons: [],
    })
  })

  it('chrome: перепаковка в HLS, плейлист и сегменты по токену', async () => {
    const body = await start({ device: chrome })

    expect(body).toMatchObject({
      mode: 'hls',
      audioSwitch: 'restart',
      reasons: ['ContainerNotSupported', 'AudioCodecNotSupported'],
      transcode: { audio: 'aac' },
    })
    expect(body.streamUrl).toMatch(
      new RegExp(`^/api/hls/${body.sessionId}/main\\.m3u8\\?token=.+`),
    )

    const playlist = await app.inject({ url: body.streamUrl })

    expect(playlist.statusCode).toBe(200)
    expect(playlist.headers['content-type']).toContain('mpegurl')

    const segmentPath = playlist.body
      .split('\n')
      .find(line => line.startsWith('0.ts'))!

    expect(segmentPath).toMatch(/^0\.ts\?token=/)

    const segment = await app.inject({
      url: `/api/hls/${body.sessionId}/${segmentPath}`,
    })

    expect(segment.statusCode).toBe(200)
    expect(segment.headers['content-type']).toBe('video/mp2t')
    expect(segment.rawPayload.length).toBeGreaterThan(1000)
    // Пакеты MPEG-TS начинаются с синхробайта
    expect(segment.rawPayload[0]).toBe(0x47)
  })

  it('озвучка по умолчанию — студия, выбранная для серии', async () => {
    rememberChoice(
      {
        profileId: await defaultProfileId(),
        titleId: 'tmdb:tv:1',
        season: 1,
        episode: 2,
      },
      {
        torrentId: torrent.id,
        fileIndex: 0,
        voice: { type: 'MVO', studio: 'LostFilm' },
      },
    )

    const body = await start({
      device: webos,
      title: { id: 'tmdb:tv:1', season: 1, episode: 2 },
    })

    expect(body.audioStream).toBe(2)
  })

  it('смена озвучки перезапуском продолжает с позиции', async () => {
    const body = await start({
      device: chrome,
      audioStream: 2,
      startPosition: 7.5,
    })

    expect(body).toMatchObject({
      mode: 'hls',
      audioStream: 2,
      startPosition: 7.5,
    })
  })

  it('внешние субтитры в Windows-1251 — реплики в UTF-8', async () => {
    const body = await start()
    const response = await app.inject({
      url: `/api/playback/${body.sessionId}/subtitles/f1?from=0`,
      cookies: owner,
    })

    expect(response.json()).toEqual({
      cues: [{ start: 1, end: 2, text: 'Привет' }],
      done: true,
    })
  })

  it('закрытая сессия — 404', async () => {
    const body = await start({ device: chrome })
    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/playback/${body.sessionId}`,
      cookies: owner,
    })

    expect(removed.statusCode).toBe(200)
    expect(
      (
        await app.inject({
          url: `/api/playback/${body.sessionId}`,
          cookies: owner,
        })
      ).statusCode,
    ).toBe(404)
    expect((await app.inject({ url: body.streamUrl })).statusCode).toBe(404)
  })
})

async function defaultProfileId() {
  const { defaultProfile } = await import('../services/profiles/index.ts')

  return defaultProfile().id
}
