import type { AddressInfo } from 'node:net'
import type { Torrent } from '../db/schema.ts'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import pino from 'pino'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import {
  ACCESS_TOKEN_COOKIE,
  config,
  DEVICE_TOKEN_COOKIE,
  PROFILE_COOKIE,
} from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  cycleProgress,
  devices,
  downloadedSubtitles,
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
  profiles,
  rewatchCycles,
  subtitleJobs,
  subtitleOffsets,
  torrents,
  users,
  viewingAttempts,
} from '../db/schema.ts'
import { hashToken } from '../services/devices/index.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import { setNetTransport } from '../services/net/index.ts'
import {
  deleteSetting,
  getSetting,
  setSetting,
} from '../services/settings/index.ts'
import { SUBTITLE_SETTINGS_KEY } from '../services/subtitles/settings.ts'
import {
  INFO_HASH,
  liveStats,
  sampleTorrentFile,
} from '../services/engine/fixtures/index.ts'
import {
  createLogger,
  installLogger,
  queryLogs,
} from '../services/logs/index.ts'
import { stopAllSessions } from '../services/media/index.ts'
import { libraryProbeKey } from '../services/library/playedSource.ts'
import { removeFromLibrary } from '../services/library/index.ts'
import {
  downloadedSubtitleId,
  registerDownloadedSubtitle,
  saveSubtitleOffset,
} from '../services/media/downloadedSubtitles.ts'
import * as subtitleService from '../services/media/downloadedSubtitles.ts'
import { clearProbeCache } from '../services/media/probe.ts'
import { getSession, probeDeps } from '../services/media/sessions.ts'
import { resetMediaTools } from '../services/media/tools.ts'
import {
  getTitleProgress,
  rememberChoice,
} from '../services/sources/progress.ts'
import { isStreaming } from '../services/storage/index.ts'
import * as torrentService from '../services/torrents/index.ts'
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
  // Xvid в AVI с AC3: браузер не играет ни контейнер, ни видео, ни звук
  let avi = Buffer.alloc(0)
  let files: { path: string, size: number, padding: boolean }[] = []
  // Сколько следующих запросов ffprobe к фильму оборвать, как при падении движка
  let probeResets = 0
  // Чтения индекса MKV с конца файла висят, пока движок ждёт куски
  let holdTail = false
  let tailClosed = false
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

    if (url.pathname.endsWith('/stats')) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ ...liveStats, badPieces: 3 }))
      return
    }

    const match = /\/files\/(\d+)\/stream$/.exec(url.pathname)
    const body = match ? [mkv, srt, avi][Number(match[1])] : undefined

    if (!body) {
      response.statusCode = 404
      response.end()
      return
    }

    const fromFfprobe = request.headers['user-agent']?.startsWith('Lavf')

    if (body === mkv && fromFfprobe && probeResets > 0) {
      probeResets--
      request.socket.destroy()
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

    if (body === mkv && !fromFfprobe && holdTail && start > 0) {
      response.on('close', () => {
        tailClosed = true
      })
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

    const old = join(dir, 'Old.avi')

    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x90:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000',
      '-t',
      '20',
      '-c:v',
      'mpeg4',
      '-vtag',
      'XVID',
      '-bf',
      '2',
      '-c:a',
      'ac3',
      old,
    ])
    avi = readFileSync(old)
    files = [
      { path: 'Film (2024)/Film.2024.mkv', size: mkv.length, padding: false },
      {
        path: 'Film (2024)/Film.2024.rus.srt',
        size: srt.length,
        padding: false,
      },
      { path: 'Film (2024)/Old.avi', size: avi.length, padding: false },
    ]

    await new Promise<void>(resolve =>
      engine.listen(0, '127.0.0.1', resolve),
    )
    setEngineReady(
      `http://127.0.0.1:${(engine.address() as AddressInfo).port}`,
    )

    await migrateDb()
    getDb()
      .insert(users)
      .values({
        id: 'owner',
        username: 'Owner',
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

  async function start(payload: Record<string, unknown> = {}, cookies = owner) {
    const response = await app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies,
      payload:
        'mediaFileId' in payload
          ? payload
          : { torrentId: torrent.id, fileIndex: 0, ...payload },
    })

    expect(response.statusCode, response.body).toBe(200)

    let body = response.json()

    while (body.status === 'probing') {
      await new Promise(resolve => setTimeout(resolve, 100))
      body = (
        await app.inject({
          url: `/api/playback/${body.sessionId}`,
          cookies,
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
    // Внешнему плееру — прямой поток файла, а не перепаковка этой сессии
    expect(body.externalUrl).toMatch(/^\/api\/stream\/.+\?token=.+/)

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

  it('uses the effective HLS duration in both playback state and playlist', async () => {
    const body = await start({ device: chrome })
    const session = getSession(body.sessionId, 'owner')!
    const raw = session.media!
    session.media = { ...raw, duration: 75 }
    try {
      const state = await app.inject({
        url: `/api/playback/${body.sessionId}`,
        cookies: owner,
      })
      expect(state.json().duration).toBeCloseTo(session.hls!.duration, 5)
      const playlist = await app.inject({ url: body.streamUrl })
      expect(playlist.statusCode).toBe(200)
      const duration = [...playlist.body.matchAll(/#EXTINF:([\d.]+)/g)].reduce(
        (sum, match) => sum + Number(match[1]),
        0,
      )
      expect(duration).toBeCloseTo(session.hls!.duration, 5)
    }
    finally {
      session.media = raw
    }
  })

  it('chrome: Xvid в AVI — перекодирование видео в H.264', async () => {
    const body = await start({ device: chrome, fileIndex: 2 })

    expect(body).toMatchObject({
      mode: 'hls',
      reasons: [
        'ContainerNotSupported',
        'AudioCodecNotSupported',
        'VideoCodecNotSupported',
      ],
      transcode: {
        audio: 'aac',
        video: { width: 160, height: 90, toneMapping: null },
      },
    })

    const segment = await app.inject({
      url: `/api/hls/${body.sessionId}/0.ts?${body.streamUrl.split('?')[1]}`,
    })

    expect(segment.statusCode).toBe(200)
    expect(segment.rawPayload[0]).toBe(0x47)

    const path = join(dir, 'segment.ts')

    writeFileSync(path, segment.rawPayload)
    expect(
      execFileSync('ffprobe', [
        '-v',
        'error',
        '-select_streams',
        'v',
        '-show_entries',
        'stream=codec_name',
        '-of',
        'csv=p=0',
        path,
      ])
        .toString()
        .split('\n')[0],
    ).toBe('h264')
  })

  it('проба, сорванная движком, повторяется', async () => {
    const pause = vi.spyOn(probeDeps, 'pause').mockResolvedValue(undefined)

    try {
      clearProbeCache()
      probeResets = 2

      expect(await start({ device: chrome })).toMatchObject({ mode: 'hls' })
      expect(probeResets).toBe(0)
      expect(pause).toHaveBeenCalledTimes(2)
    }
    finally {
      probeResets = 0
      pause.mockRestore()
    }
  })

  it('проба падает и на повторах — прямой поток с `ProbeFailed`', async () => {
    const pause = vi.spyOn(probeDeps, 'pause').mockResolvedValue(undefined)

    try {
      clearProbeCache()
      probeResets = Number.POSITIVE_INFINITY

      expect(await start({ device: chrome })).toMatchObject({
        mode: 'direct',
        reasons: ['ProbeFailed'],
      })
      expect(pause).toHaveBeenCalledTimes(2)
    }
    finally {
      probeResets = 0
      pause.mockRestore()
    }
  })

  it('закрытие сессии обрывает чтение индекса MKV', async () => {
    clearProbeCache()
    holdTail = true
    tailClosed = false

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: owner,
        payload: { torrentId: torrent.id, fileIndex: 0, device: chrome },
      })
      const { sessionId } = response.json()

      // Проба прошла, перепаковка ждёт индекс с конца файла
      await vi.waitFor(async () => {
        const status = await app.inject({
          url: `/api/playback/${sessionId}`,
          cookies: owner,
        })

        expect(status.json()).toMatchObject({ status: 'probing' })
        expect(status.json().media).toBeTruthy()
      })
      expect(tailClosed).toBe(false)

      await app.inject({
        method: 'DELETE',
        url: `/api/playback/${sessionId}`,
        cookies: owner,
      })
      await vi.waitFor(() => expect(tailClosed).toBe(true))
    }
    finally {
      holdTail = false
    }
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

  it('при смене раздачи — студия, которую слушали в прошлой', async () => {
    rememberChoice(
      {
        profileId: await defaultProfileId(),
        titleId: 'tmdb:tv:1',
        season: 1,
        episode: 5,
      },
      {
        torrentId: torrent.id,
        fileIndex: 0,
        voice: { type: 'MVO', studio: 'LostFilm' },
      },
    )

    const title = { id: 'tmdb:tv:1', season: 1, episode: 5 }

    // Для серии выбрана LostFilm, а слушали NewStudio
    expect(
      (await start({ device: webos, title, voiceStudio: 'NewStudio' }))
        .audioStream,
    ).toBe(1)
    // Такой студии в файле нет — дорожка на языке профиля
    expect(
      (await start({ device: webos, title, voiceStudio: 'Кубик в Кубе' }))
        .audioStream,
    ).toBe(1)
  })

  it('выбранная в плеере озвучка запоминается для серии и следующих серий', async () => {
    const title = { id: 'tmdb:tv:7', season: 1, episode: 3 }

    // По умолчанию — дорожка с default (NewStudio), выбор — LostFilm
    expect((await start({ device: webos, title })).audioStream).toBe(1)
    expect(
      (await start({ device: webos, title, audioStream: 2, startPosition: 5 }))
        .audioStream,
    ).toBe(2)

    // Запоминание идёт после пробы: ждём, пока сессия ответит готовностью
    await vi.waitFor(async () => {
      expect((await start({ device: webos, title })).audioStream).toBe(2)
    })
    expect(
      (await start({ device: webos, title: { ...title, episode: 4 } }))
        .audioStream,
    ).toBe(2)
  })

  it('does not remember a delayed explicit audio probe after a newer choice', async () => {
    const title = { id: 'tmdb:tv:924', season: 1, episode: 1 }
    const ref = {
      profileId: await defaultProfileId(),
      titleId: title.id,
      season: 1,
      episode: 1,
    }
    let entered!: () => void
    let release!: () => void
    const probing = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<undefined>((resolve) => {
      release = () => resolve(undefined)
    })
    const pause = vi.spyOn(probeDeps, 'pause').mockImplementation(() => {
      entered()
      return gate
    })
    clearProbeCache()
    probeResets = 1
    const launch = start({ device: webos, title, audioStream: 1 })
    try {
      await probing
      rememberChoice(ref, {
        torrentId: torrent.id,
        fileIndex: 2,
        voice: { studio: 'Newer choice' },
      })
      release()
      expect(await launch).toMatchObject({ status: 'ready', audioStream: 1 })
      expect(getTitleProgress(ref)).toMatchObject({
        fileIndex: 2,
        voiceStudio: 'Newer choice',
        voiceSelectionRevision: 1,
      })
    }
    finally {
      release()
      await launch
      pause.mockRestore()
      probeResets = 0
    }
  })

  it.each([false, true])(
    'rechecks playback access when the probe finishes (after response=%s)',
    async (afterResponse) => {
      const suffix = afterResponse ? 'late' : 'initial'
      const title = {
        id: `tmdb:tv:${afterResponse ? 928 : 929}`,
        season: 1,
        episode: 1,
      }
      const ref = {
        profileId: `playback-probe-${suffix}`,
        titleId: title.id,
        season: 1,
        episode: 1,
      }
      const db = getDb()
      db.insert(profiles)
        .values({ id: ref.profileId, name: 'Viewer', color: 'blue' })
        .run()
      const entered = Promise.withResolvers<void>()
      const release = Promise.withResolvers<undefined>()
      const pause = vi.spyOn(probeDeps, 'pause').mockImplementation(() => {
        entered.resolve()
        return release.promise
      })
      clearProbeCache()
      probeResets = 1
      const pending = app.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: { ...owner, [PROFILE_COOKIE]: ref.profileId },
        payload: {
          torrentId: torrent.id,
          fileIndex: 0,
          title,
          device: webos,
          audioStream: 2,
          viewing: {
            requestId: `probe-${suffix}`,
            clientId: 'probe-client',
            playerId: 'probe-player',
            intent: 'join',
          },
        },
      })
      try {
        expect(
          await Promise.race([
            entered.promise.then(() => true),
            pending.then(() => false),
          ]),
        ).toBe(true)
        const early = afterResponse ? await pending : undefined
        if (early)
          expect(early.json().status).toBe('probing')
        db.update(profiles)
          .set({ ageLimit: 6 })
          .where(eq(profiles.id, ref.profileId))
          .run()
        release.resolve(undefined)
        if (early) {
          const { sessionId } = early.json()
          await getSession(sessionId, 'owner')!.ready
        }
        else {
          const denied = await pending
          expect(denied.statusCode, denied.body).toBe(404)
          expect(
            db
              .select()
              .from(viewingAttempts)
              .where(eq(viewingAttempts.profileId, ref.profileId))
              .all(),
          ).toEqual([])
        }
        expect(getTitleProgress(ref)).toBeUndefined()
      }
      finally {
        release.resolve(undefined)
        await pending
        pause.mockRestore()
        probeResets = 0
      }
    },
    10_000,
  )

  it('protects a choice made while the new torrent file is waiting for prepareStream', async () => {
    const title = { id: 'tmdb:tv:925', season: 1, episode: 1 }
    const ref = {
      profileId: await defaultProfileId(),
      titleId: title.id,
      season: 1,
      episode: 1,
    }
    let entered!: () => void
    let release!: () => void
    const waiting = new Promise<void>((resolve) => {
      entered = resolve
    })
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = torrentService.prepareStream
    const preparing = vi
      .spyOn(torrentService, 'prepareStream')
      .mockImplementationOnce(async (...args) => {
        entered()
        await gate
        return original(...args)
      })
    const pending = start({ device: webos, title })
    try {
      await waiting
      rememberChoice(ref, {
        torrentId: torrent.id,
        fileIndex: 2,
        voice: { studio: 'Newer choice' },
      })
      release()
      const playing = await pending
      const checkpoint = await app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies: owner,
        payload: {
          torrentId: torrent.id,
          fileIndex: 0,
          title,
          sessionId: playing.sessionId,
          position: 5,
          duration: 20,
          appliedAudioStream: 1,
        },
      })
      expect(checkpoint.statusCode).toBe(200)
      expect(getTitleProgress(ref)).toMatchObject({
        fileIndex: 2,
        voiceStudio: 'Newer choice',
        playedSource: { fileIndex: 0, voice: { studio: 'NewStudio' } },
        position: 5,
      })
    }
    finally {
      release()
      await pending
      preparing.mockRestore()
    }
  })

  it.each([
    {
      device: webos,
      expected: 'LostFilm',
      mode: 'direct',
      switching: 'platform',
    },
    {
      device: chrome,
      expected: 'NewStudio',
      mode: 'hls',
      switching: 'restart',
    },
  ])(
    'keeps the checkpoint tied to the applied audio ($mode/$switching)',
    async ({ device, expected, mode, switching }) => {
      const title = { id: 'tmdb:tv:919', season: 1, episode: 1 }
      const ref = {
        profileId: await defaultProfileId(),
        titleId: title.id,
        season: 1,
        episode: 1,
      }
      const playing = await start({ device, title, audioStream: 1 })
      expect(playing).toMatchObject({ mode, audioSwitch: switching })
      const checkpoint = (
        position: number,
        appliedAudioStream: number | null,
      ) =>
        app.inject({
          method: 'PUT',
          url: '/api/watch-state',
          cookies: owner,
          payload: {
            torrentId: torrent.id,
            fileIndex: 0,
            title,
            sessionId: playing.sessionId,
            appliedAudioStream,
            position,
            duration: 20,
          },
        })
      expect((await checkpoint(2, 1)).statusCode).toBe(200)
      expect(getTitleProgress(ref)?.playedSource).toMatchObject({
        voice: { studio: 'NewStudio' },
      })
      const first = getTitleProgress(ref)!
      const changed = await app.inject({
        method: 'PUT',
        url: `/api/playback/${playing.sessionId}/preferences`,
        cookies: owner,
        payload: { audioStream: 2 },
      })
      expect(changed.statusCode).toBe(200)
      expect(getTitleProgress(ref)?.playedSource).toEqual(first.playedSource)
      expect(getTitleProgress(ref)?.updatedAt).toEqual(first.updatedAt)
      expect(getTitleProgress(ref)?.voiceSelectionRevision).toBe(
        first.voiceSelectionRevision + 1,
      )
      const acceptedChoice = getTitleProgress(ref)!
      const rejected = await app.inject({
        method: 'PUT',
        url: `/api/playback/${playing.sessionId}/preferences`,
        cookies: owner,
        payload: { audioStream: 1, subtitle: 's999' },
      })
      expect(rejected.statusCode).toBe(400)
      expect(getTitleProgress(ref)).toEqual(acceptedChoice)
      expect((await checkpoint(3, 2)).statusCode).toBe(200)
      expect(getTitleProgress(ref)?.playedSource).toMatchObject({
        voice: { studio: expected },
      })
      expect((await checkpoint(4, null)).statusCode).toBe(200)
      expect(getTitleProgress(ref)).toMatchObject({
        // HLS maps its selected stream. Direct can no longer attest a track.
        playedSource: {
          voice: mode === 'hls' ? { studio: 'NewStudio' } : null,
        },
        voiceStudio: mode === 'direct' ? 'LostFilm' : 'NewStudio',
        position: 4,
      })
    },
  )

  it('keeps separate HLS tracks across sessions of the same file and a late save after DELETE', async () => {
    const title = { id: 'tmdb:tv:920', season: 1, episode: 1 }
    const ref = {
      profileId: await defaultProfileId(),
      titleId: title.id,
      season: 1,
      episode: 1,
    }
    rememberChoice(ref, {
      torrentId: torrent.id,
      fileIndex: 0,
      voice: { studio: 'LostFilm' },
    })
    const a = await start({ device: chrome, title, voiceStudio: 'NewStudio' })
    const b = await start({ device: chrome, title, voiceStudio: 'LostFilm' })
    expect(a).toMatchObject({ status: 'ready', mode: 'hls', audioStream: 1 })
    expect(b).toMatchObject({ status: 'ready', mode: 'hls', audioStream: 2 })
    const checkpoint = (sessionId: string, position: number) =>
      app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies: owner,
        payload: {
          torrentId: torrent.id,
          fileIndex: 0,
          title,
          sessionId,
          position,
          duration: 20,
        },
      })
    expect((await checkpoint(b.sessionId, 2)).statusCode).toBe(200)
    expect(getTitleProgress(ref)?.playedSource).toMatchObject({
      voice: { studio: 'LostFilm' },
    })
    expect((await checkpoint(a.sessionId, 3)).statusCode).toBe(200)
    expect(getTitleProgress(ref)?.playedSource).toMatchObject({
      voice: { studio: 'NewStudio' },
    })
    rememberChoice(ref, {
      torrentId: torrent.id,
      fileIndex: 2,
      voice: { studio: 'Pending' },
    })
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/playback/${a.sessionId}`,
          cookies: owner,
        })
      ).statusCode,
    ).toBe(200)
    expect((await checkpoint(a.sessionId, 4)).statusCode).toBe(200)
    expect(getTitleProgress(ref)).toMatchObject({
      position: 4,
      fileIndex: 2,
      voiceStudio: 'Pending',
      playedSource: { fileIndex: 0, voice: { studio: 'NewStudio' } },
    })
  })

  it('ignores session facts across title, episode, file and profile boundaries', async () => {
    const title = { id: 'tmdb:tv:921', season: 1, episode: 1 }
    const profileId = await defaultProfileId()
    const playing = await start({
      device: chrome,
      title,
      voiceStudio: 'NewStudio',
    })
    const otherProfile = 'other-progress-profile'
    getDb()
      .insert(profiles)
      .values({ id: otherProfile, name: 'Other progress', color: 'violet' })
      .run()
    const foreignDevice = 'foreign-progress-device'
    getDb()
      .insert(devices)
      .values({
        name: 'Playback fixture',
        type: 'tv',
        profileId,
        tokenHash: hashToken(foreignDevice),
      })
      .run()
    const cases = [
      { profileId, title: { ...title, id: 'tmdb:tv:922' }, fileIndex: 0 },
      { profileId, title: { ...title, episode: 2 }, fileIndex: 0 },
      { profileId, title, fileIndex: 2 },
      { profileId: otherProfile, title, fileIndex: 0 },
      { profileId, title, fileIndex: 0, device: foreignDevice },
    ]
    for (const target of cases) {
      const response = await app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies: target.device
          ? { [DEVICE_TOKEN_COOKIE]: target.device }
          : { ...owner, [PROFILE_COOKIE]: target.profileId },
        payload: {
          torrentId: torrent.id,
          fileIndex: target.fileIndex,
          title: target.title,
          sessionId: playing.sessionId,
          position: 5,
          duration: 20,
        },
      })
      expect(response.statusCode).toBe(200)
      expect(
        getTitleProgress({
          profileId: target.profileId,
          titleId: target.title.id,
          season: target.title.season,
          episode: target.title.episode,
        }),
      ).toMatchObject({ position: 5, playedSource: { voice: null } })
    }
    const late = await app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies: { ...owner, [PROFILE_COOKIE]: otherProfile },
      payload: {
        torrentId: torrent.id,
        fileIndex: 0,
        title,
        profileId,
        sessionId: playing.sessionId,
        position: 10,
        duration: 20,
      },
    })
    expect(late.statusCode).toBe(404)
    expect(
      getTitleProgress({
        profileId: otherProfile,
        titleId: title.id,
        season: 1,
        episode: 1,
      })?.position,
    ).toBe(5)
  })

  it('keeps legacy and unapplied direct fallback audio unknown without erasing the requested choice', async () => {
    const title = { id: 'tmdb:tv:923', season: 1, episode: 1 }
    const ref = {
      profileId: await defaultProfileId(),
      titleId: title.id,
      season: 1,
      episode: 1,
    }
    const fallback = await start({
      device: { ...chrome, hls: false },
      title,
      audioStream: 2,
    })
    expect(fallback).toMatchObject({
      mode: 'direct',
      audioStream: 2,
      reasons: expect.arrayContaining(['HlsNotSupported']),
    })
    for (const [position, context] of [
      [2, {}],
      [3, { sessionId: fallback.sessionId, appliedAudioStream: null }],
    ] as const) {
      const checkpoint = await app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies: owner,
        payload: {
          torrentId: torrent.id,
          fileIndex: 0,
          title,
          position,
          duration: 20,
          ...context,
        },
      })
      expect(checkpoint.statusCode).toBe(200)
      expect(getTitleProgress(ref)).toMatchObject({
        position,
        voiceStudio: 'LostFilm',
        playedSource: { voice: null },
      })
    }
  })

  it('saves explicit tracks for the title, restores them on another episode and preserves Off', async () => {
    const title = { id: 'tmdb:tv:909', season: 1, episode: 1 }
    const first = await start({ device: webos, title })
    const save = (body: object) =>
      app.inject({
        method: 'PUT',
        url: `/api/playback/${first.sessionId}/preferences`,
        cookies: owner,
        payload: body,
      })
    expect((await save({ audioStream: 2, subtitle: 'f1' })).statusCode).toBe(
      200,
    )
    const next = await start({
      device: webos,
      title: { ...title, episode: 2 },
      voiceStudio: 'NewStudio',
    })
    expect(next.audioStream).toBe(2)
    expect(next.subtitle).toBe('f1')
    expect((await save({ subtitle: null })).statusCode).toBe(200)
    expect((await start({ device: webos, title })).subtitle).toBeNull()
    expect((await save({ audioStream: 999 })).statusCode).toBe(400)
    getDb()
      .insert(profiles)
      .values({
        id: 'other-playback-profile',
        name: 'Other',
        color: 'violet',
      })
      .run()
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/playback/${first.sessionId}/preferences`,
          cookies: { ...owner, [PROFILE_COOKIE]: 'other-playback-profile' },
          payload: { audioStream: 1 },
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: `/api/playback/${first.sessionId}/preferences`,
          payload: { subtitle: null },
        })
      ).statusCode,
    ).toBe(401)
    await app.inject({
      method: 'DELETE',
      url: `/api/playback/${first.sessionId}`,
      cookies: owner,
    })
    expect((await save({ subtitle: 'f1' })).statusCode).toBe(404)
  })

  it('keeps cycle subtitles across episodes and restarts with independent cycle audio', async () => {
    const title = { id: 'tmdb:tv:926', season: 1, episode: 1 }
    const profileId = await defaultProfileId()
    const now = new Date()
    const cycleId = getDb()
      .insert(rewatchCycles)
      .values({
        profileId,
        titleId: title.id,
        startSeason: 1,
        startEpisode: 1,
        targetSeason: 1,
        targetEpisode: 1,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
      .id
    const save = (sessionId: string, payload: object) =>
      app.inject({
        method: 'PUT',
        url: `/api/playback/${sessionId}/preferences`,
        cookies: owner,
        payload,
      })
    const normal = await start({ device: webos, title })
    expect(
      (await save(normal.sessionId, { audioStream: 2, subtitle: 'f1' }))
        .statusCode,
    ).toBe(200)
    const command = {
      cycleId,
      clientId: 'cycle-tracks',
      playerId: 'cycle-player',
    }
    const first = await start({
      device: webos,
      title,
      voiceStudio: 'NewStudio',
      viewing: {
        ...command,
        requestId: 'cycle-preferences-first',
        intent: 'join',
      },
    })
    expect(first).toMatchObject({ audioStream: 1, subtitle: 'f1' })
    expect(
      (await save(first.sessionId, { audioStream: 1, subtitle: null }))
        .statusCode,
    ).toBe(200)
    const nextTitle = { ...title, episode: 2 }
    const next = await start({
      device: webos,
      title: nextTitle,
      viewing: {
        ...command,
        requestId: 'cycle-preferences-next',
        intent: 'join',
      },
    })
    expect(next.subtitle).toBeNull()
    expect((await save(next.sessionId, { subtitle: 'f1' })).statusCode).toBe(
      200,
    )
    const reset = await start({
      device: webos,
      title: nextTitle,
      viewing: {
        ...command,
        requestId: 'cycle-preferences-restart',
        intent: 'restart',
        expectedGeneration: 1,
      },
    })
    expect(reset.subtitle).toBe('f1')
    expect(await start({ device: webos, title: nextTitle })).toMatchObject({
      audioStream: 2,
      subtitle: 'f1',
    })
  })

  it('rechecks a cycle torrent file against current library visibility', async () => {
    const db = getDb()
    const profileId = await defaultProfileId()
    const title = { id: 'tmdb:tv:930', season: 1, episode: 1 }
    const now = new Date()
    const cycleId = db
      .insert(rewatchCycles)
      .values({
        profileId,
        titleId: title.id,
        startSeason: 1,
        startEpisode: 1,
        targetSeason: 1,
        targetEpisode: 1,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get()
      .id
    const command = {
      cycleId,
      clientId: 'cycle-visibility',
      playerId: 'cycle-visibility-player',
      intent: 'join',
    }
    const started = await start({
      device: webos,
      title,
      viewing: { ...command, requestId: 'cycle-visible' },
    })
    const { id: libraryId } = db
      .insert(libraries)
      .values({ kind: 'video', name: 'Cycle test library' })
      .returning()
      .get()
    const folder = db
      .insert(libraryFolders)
      .values({ libraryId, path: join(dir, 'cycle-files') })
      .returning()
      .get()
    try {
      db.insert(mediaFiles)
        .values({
          folderId: folder.id,
          relPath: 'episode.mkv',
          size: 1024,
          mtime: now,
          torrentId: torrent.id,
          fileIndex: 0,
        })
        .run()
      db.insert(libraryHiddenProfiles).values({ libraryId, profileId }).run()
      const sessionUrl = `/api/playback/${started.sessionId}`
      const status = await app.inject({ url: sessionUrl, cookies: owner })
      expect(status.statusCode, status.body).toBe(404)
      const preferences = await app.inject({
        method: 'PUT',
        url: `${sessionUrl}/preferences`,
        cookies: owner,
        payload: { subtitle: 'f1' },
      })
      expect(preferences.statusCode, preferences.body).toBe(404)
      const checkpoint = await app.inject({
        method: 'PUT',
        url: '/api/watch-state',
        cookies: owner,
        payload: {
          torrentId: torrent.id,
          fileIndex: 0,
          title,
          sessionId: started.sessionId,
          position: 12,
          duration: 20,
          event: { clientId: command.clientId, sequence: 1 },
          viewing: { kind: 'playback', line: 0, playerId: command.playerId },
        },
      })
      expect(checkpoint.statusCode, checkpoint.body).toBe(404)
      expect(
        db
          .select()
          .from(cycleProgress)
          .where(eq(cycleProgress.cycleId, cycleId))
          .all(),
      ).toEqual([])
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: sessionUrl,
            cookies: owner,
          })
        ).statusCode,
      ).toBe(200)
      const next = await app.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: owner,
        payload: {
          torrentId: torrent.id,
          fileIndex: 0,
          device: webos,
          title,
          viewing: { ...command, requestId: 'cycle-hidden' },
        },
      })
      expect(next.statusCode, next.body).toBe(404)
      expect((await start({ device: webos, title })).status).toBe('ready')
    }
    finally {
      db.delete(libraries).where(eq(libraries.id, libraryId)).run()
    }
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

  it('keeps imported text and subtitle timing bound to the source and profile', async () => {
    const dataDir = vi.spyOn(config, 'dataDir', 'get').mockReturnValue(dir)
    const primaryCookies = {
      ...owner,
      [PROFILE_COOKIE]: await defaultProfileId(),
    }
    const otherProfile = 'subtitle-offset-other-profile'
    const otherCookies = { ...owner, [PROFILE_COOKIE]: otherProfile }
    const db = getDb()
    const video = join(dir, 'Synthetic.mkv')
    writeFileSync(video, mkv)
    const videoStat = statSync(video)
    const { id: libraryId } = db
      .insert(libraries)
      .values({ kind: 'video', name: 'Subtitle fixtures' })
      .returning()
      .get()
    const { id: folderId } = db
      .insert(libraryFolders)
      .values({ libraryId, path: dir })
      .returning()
      .get()
    const { id: mediaFileId } = db
      .insert(mediaFiles)
      .values({
        folderId,
        relPath: 'Synthetic.mkv',
        size: videoStat.size,
        mtime: videoStat.mtime,
      })
      .returning()
      .get()
    const source = libraryProbeKey(mediaFileId, videoStat)

    db.insert(profiles)
      .values({ id: otherProfile, name: 'Other', color: 'teal', position: 100 })
      .run()

    try {
      const payload = {
        language: 'eng',
        title: null,
        forced: false,
        ownerOnly: false,
      }
      const bytes = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n\n')
      const imported = await registerDownloadedSubtitle(source, payload, bytes)
      const duplicate = await registerDownloadedSubtitle(
        source,
        payload,
        bytes,
      )
      expect(duplicate.id).toBe(imported.id)
      const trackId = downloadedSubtitleId(imported)
      const playback = { mediaFileId, device: webos, subtitle: trackId }
      const body = await start(playback, primaryCookies)
      expect(body).toMatchObject({ mode: 'direct', subtitle: trackId })
      expect(body.media.subtitles).toContainEqual(
        expect.objectContaining({
          id: trackId,
          offsetMs: 0,
          external: true,
          burnIn: false,
        }),
      )

      const cueUrl = [
        '/api/playback',
        body.sessionId,
        'subtitles',
        trackId,
      ].join('/')
      const cueResponse = await app.inject({
        url: cueUrl,
        cookies: primaryCookies,
      })
      expect(cueResponse.statusCode, cueResponse.body).toBe(200)
      expect(cueResponse.json()).toEqual({
        cues: [{ start: 1, end: 2, text: 'Hello' }],
        done: true,
      })

      const setOffset = (
        offsetMs: number,
        cookies = primaryCookies,
        headers?: Record<string, string>,
      ) =>
        app.inject({
          method: 'PUT',
          url: `${cueUrl}/offset`,
          cookies,
          headers,
          payload: { offsetMs },
        })
      expect((await setOffset(500, otherCookies)).statusCode).toBe(404)
      expect(
        (
          await setOffset(500, primaryCookies, {
            'sec-fetch-site': 'cross-site',
          })
        ).statusCode,
      ).toBe(403)
      expect((await setOffset(30001)).statusCode).toBe(400)
      expect((await setOffset(-600)).json()).toEqual({ offsetMs: -600 })
      expect(
        (await app.inject({ url: cueUrl, cookies: primaryCookies })).json(),
      ).toEqual(cueResponse.json())

      const reopened = await start(
        { ...playback, startPosition: 4.5 },
        primaryCookies,
      )
      expect(reopened).toMatchObject({ subtitle: trackId, startPosition: 4.5 })
      expect(reopened.media.subtitles).toContainEqual(
        expect.objectContaining({ id: trackId, offsetMs: -600 }),
      )

      const statusUrl = ['/api/playback', body.sessionId].join('/')
      const status = () =>
        app.inject({ url: statusUrl, cookies: primaryCookies })
      const cues = () => app.inject({ url: cueUrl, cookies: primaryCookies })
      const privateDir = join(dir, 'subtitles')
      const subtitleFile = join(privateDir, `${imported.id}.srt`)
      rmSync(subtitleFile)
      expect((await cues()).statusCode).toBe(404)
      expect((await status()).json().subtitle).toBeNull()
      expect((await status()).json().media.subtitles).not.toContainEqual(
        expect.objectContaining({ id: trackId }),
      )
      expect((await setOffset(500)).statusCode).toBe(404)

      db.insert(downloadedSubtitles)
        .values({
          ...imported,
          id: '11111111-1111-4111-a111-111111111111',
          sha256: '0'.repeat(64),
          bytes: 128 * 1024 * 1024,
        })
        .run()
      const orphan = join(
        privateDir,
        '22222222-2222-4222-a222-222222222222.srt',
      )
      const temp = join(
        privateDir,
        '.33333333-3333-4333-a333-333333333333.tmp',
      )
      const unrelated = join(privateDir, 'preserve.tmp')
      for (const path of [orphan, temp, unrelated]) writeFileSync(path, 'text')

      const restored = await registerDownloadedSubtitle(source, payload, bytes)
      expect(restored.id).toBe(imported.id)
      expect(existsSync(orphan)).toBe(false)
      expect(existsSync(temp)).toBe(false)
      expect(existsSync(unrelated)).toBe(true)
      expect((await cues()).json()).toEqual(cueResponse.json())
      expect((await status()).json().media.subtitles).toContainEqual(
        expect.objectContaining({ id: trackId, offsetMs: -600 }),
      )

      const other = await start(playback, otherCookies)
      expect(other.media.subtitles).toContainEqual(
        expect.objectContaining({ id: trackId, offsetMs: 0 }),
      )
      expect((await setOffset(0)).json()).toEqual({ offsetMs: 0 })

      const entered = Promise.withResolvers<void>()
      const resumeProjection = Promise.withResolvers<void>()
      const checkPresent = subtitleService.availableDownloadedSubtitles
      const projection = vi
        .spyOn(subtitleService, 'availableDownloadedSubtitles')
        .mockImplementationOnce(async (tracks) => {
          entered.resolve()
          await resumeProjection.promise
          return checkPresent(tracks)
        })
      const reopenedUrl = ['/api/playback', reopened.sessionId].join('/')
      const pending = app.inject({ url: reopenedUrl, cookies: primaryCookies })
      try {
        await entered.promise
        const closed = await app.inject({
          method: 'DELETE',
          url: reopenedUrl,
          cookies: primaryCookies,
        })
        expect(closed.statusCode).toBe(200)
      }
      finally {
        resumeProjection.resolve()
        projection.mockRestore()
      }
      expect((await pending).statusCode).toBe(404)

      const replacement = join(dir, 'Replacement.mkv')
      writeFileSync(replacement, mkv)
      renameSync(replacement, video)
      expect((await status()).json().subtitle).toBeNull()
      expect((await status()).json().media.subtitles).not.toContainEqual(
        expect.objectContaining({ id: trackId }),
      )
      expect(
        (await app.inject({ url: cueUrl, cookies: primaryCookies })).statusCode,
      ).toBe(404)
      expect((await setOffset(1000)).statusCode).toBe(404)
      expect((await start(playback, primaryCookies)).subtitle).toBeNull()
    }
    finally {
      dataDir.mockRestore()
      db.delete(subtitleOffsets)
        .where(eq(subtitleOffsets.sourceRevision, source))
        .run()
      db.delete(downloadedSubtitles)
        .where(eq(downloadedSubtitles.sourceRevision, source))
        .run()
      db.delete(profiles).where(eq(profiles.id, otherProfile)).run()
      db.delete(libraries).where(eq(libraries.id, libraryId)).run()
    }
  })

  it('finds, attaches and removes a provider sidecar for the confirmed managed video', async () => {
    const video = join(dir, 'Synthetic.Release.1080p.WEB-DL.mkv')
    writeFileSync(video, mkv)
    const info = statSync(video)
    const db = getDb()
    const library = db
      .insert(libraries)
      .values({ name: 'Subtitle test', kind: 'video', managed: true })
      .returning()
      .get()
    const folder = db
      .insert(libraryFolders)
      .values({ libraryId: library.id, path: dir })
      .returning()
      .get()
    const file = db
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'Synthetic.Release.1080p.WEB-DL.mkv',
        size: info.size,
        mtime: info.mtime,
        inode: info.ino,
        titleId: 'tmdb:movie:767',
        matchStatus: 'matched',
      })
      .returning()
      .get()
    const sidecar = join(dir, 'Synthetic.Release.1080p.WEB-DL.en.srt')
    const cues = '1\n00:00:01,000 --> 00:00:03,000\nMocked subtitle\n'
    const transfer = vi.fn(async (address: string, options: RequestInit) => {
      const url = new URL(address)
      if (url.pathname === '/api/v1/login')
        return Response.json({ token: 'private-provider-auth' })
      if (url.pathname === '/api/v1/infos/user')
        return Response.json({ data: { remaining_downloads: 5 } })
      if (url.pathname === '/api/v1/subtitles') {
        expect(url.searchParams.get('tmdb_id')).toBe('767')
        return Response.json({
          data: [
            {
              attributes: {
                language: 'en',
                release: 'Synthetic.Release.1080p.WEB-DL',
                feature_details: { tmdb_id: 767 },
                files: [{ file_id: 425 }],
              },
            },
          ],
        })
      }
      if (url.pathname === '/api/v1/download') {
        return Response.json({
          link: 'https://www.opensubtitles.com/file.srt',
          remaining: 4,
        })
      }
      expect(new Headers(options.headers).get('api-key')).toBeNull()
      return new Response(cues)
    })
    setNetTransport(transfer)
    const settingsUrl = '/api/settings/subtitles'
    const settings = (payload: object) =>
      app.inject({ url: settingsUrl, method: 'PUT', cookies: owner, payload })
    try {
      const configured = await settings({
        openSubtitles: {
          apiKey: 'private-key',
          username: 'private-name',
          password: 'private-password',
          languages: ['en'],
          autoDownload: true,
        },
      })
      expect(configured.statusCode, configured.body).toBe(200)
      expect(configured.body).not.toContain('private')
      expect(JSON.stringify(getSetting(SUBTITLE_SETTINGS_KEY))).not.toContain(
        'private-password',
      )
      const status = await app.inject({
        method: 'POST',
        url: `${settingsUrl}/opensubtitles/test`,
        cookies: owner,
      })
      expect(status.json()).toMatchObject({
        kind: 'ready',
        remainingDownloads: 5,
      })
      const player = await start({ mediaFileId: file.id, device: webos })
      expect(player.subtitleSearch.providers).toEqual(['opensubtitles'])
      const apiUrl = ['/api/playback', player.sessionId, 'subtitles'].join('/')
      const search = await app.inject({
        method: 'POST',
        url: `${apiUrl}/search`,
        payload: { language: 'en' },
        cookies: owner,
      })
      expect(search.statusCode, search.body).toBe(200)
      const [item] = search.json().items
      expect(item).toMatchObject({
        provider: 'opensubtitles',
        match: 'release',
      })
      expect(item).not.toHaveProperty('remoteId')

      const apply = () =>
        app.inject({
          method: 'POST',
          url: `${apiUrl}/apply`,
          cookies: owner,
          payload: { resultId: item.id },
        })
      setSetting('maintenanceRestoreHold', true)
      try {
        const held = await apply()
        expect(held.statusCode, held.body).toBe(409)
        expect(
          transfer.mock.calls.some(([url]) => url.endsWith('/api/v1/download')),
        ).toBe(false)
      }
      finally {
        deleteSetting('maintenanceRestoreHold')
      }

      const entered = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      const register = subtitleService.registerDownloadedSubtitle
      const paused = vi
        .spyOn(subtitleService, 'registerDownloadedSubtitle')
        .mockImplementationOnce(async (...args) => {
          entered.resolve()
          await resume.promise
          return register(...args)
        })
      const pending = apply()
      try {
        await entered.promise
        const concurrent = await apply()
        expect(concurrent.statusCode, concurrent.body).toBe(200)
        expect(
          transfer.mock.calls.filter(([url]) =>
            url.endsWith('/api/v1/download'),
          ),
        ).toHaveLength(1)
      }
      finally {
        resume.resolve()
        paused.mockRestore()
      }
      const applied = await pending
      expect(applied.statusCode, applied.body).toBe(200)
      const track = applied.json()
      expect(track).toMatchObject({
        downloaded: true,
        external: true,
        offsetMs: 0,
      })
      expect(player.sessionId).toBe(getSession(player.sessionId, 'owner')?.id)
      expect(readFileSync(sidecar, 'utf8')).toBe(cues)
      expect((await apply()).json().id).toBe(track.id)
      expect(
        transfer.mock.calls.filter(([url]) => url.endsWith('/api/v1/download')),
      ).toHaveLength(1)

      const reopened = await start({
        mediaFileId: file.id,
        device: webos,
        subtitle: track.id,
      })
      expect(
        reopened.media.subtitles.filter(
          (item: { external: boolean }) => item.external,
        ),
      ).toEqual([expect.objectContaining({ id: track.id, downloaded: true })])
      const cueResponse = await app.inject({
        url: `${apiUrl}/${track.id}`,
        cookies: owner,
      })
      expect(cueResponse.json()).toMatchObject({
        cues: [{ start: 1, end: 3, text: 'Mocked subtitle' }],
      })

      const edited = cues.replace('Mocked', 'Edited')
      writeFileSync(sidecar, edited)
      expect((await apply()).statusCode).toBe(409)
      expect(
        transfer.mock.calls.filter(([url]) => url.endsWith('/api/v1/download')),
      ).toHaveLength(1)

      expect(
        (await settings({ openSubtitles: { disconnect: true } })).statusCode,
      ).toBe(200)
      const afterDisconnect = await app.inject({
        url: `/api/playback/${player.sessionId}`,
        cookies: owner,
      })
      expect(afterDisconnect.json().subtitleSearch).toMatchObject({
        providers: [],
        canRemove: true,
      })
      expect((await apply()).statusCode).toBe(404)
      const removed = await app.inject({
        method: 'DELETE',
        url: `${apiUrl}/${track.id}`,
        cookies: owner,
      })
      expect(removed.statusCode, removed.body).toBe(204)
      expect(readFileSync(sidecar, 'utf8')).toBe(edited)
      const queued = db
        .select()
        .from(subtitleJobs)
        .where(eq(subtitleJobs.mediaFileId, file.id))
        .all()
      expect(queued).toMatchObject([{ language: 'en', state: 'suppressed' }])
      expect(
        (await app.inject({ url: `${apiUrl}/${track.id}`, cookies: owner }))
          .statusCode,
      ).toBe(404)
    }
    finally {
      setNetTransport(null)
      deleteSetting(SUBTITLE_SETTINGS_KEY)
      db.delete(libraries).where(eq(libraries.id, library.id)).run()
      rmSync(sidecar, { force: true })
    }
  })

  it('removes private payloads and offsets on ordinary library file deletion while preserving edited sidecars', async () => {
    const dataDir = vi.spyOn(config, 'dataDir', 'get').mockReturnValue(dir)
    const relPath = 'Ordinary.Remove.1080p.WEB-DL.mkv'
    const path = join(dir, relPath)
    writeFileSync(path, mkv)
    const info = statSync(path)
    const db = getDb()
    const profileId = await defaultProfileId()
    const library = db
      .insert(libraries)
      .values({ name: 'Subtitle deletion test', kind: 'video', managed: true })
      .returning()
      .get()
    const folder = db
      .insert(libraryFolders)
      .values({ libraryId: library.id, path: dir })
      .returning()
      .get()
    const file = db
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath,
        size: info.size,
        mtime: info.mtime,
        inode: info.ino,
        titleId: 'tmdb:movie:768',
        matchStatus: 'matched',
        torrentId: torrent.id,
        fileIndex: 0,
      })
      .returning()
      .get()
    const revision = libraryProbeKey(file.id, info)
    const bytes = Buffer.from('1\n00:00:01,000 --> 00:00:03,000\nSubtitle\n')
    const target = { id: file.id, path, managed: true }
    try {
      const artifact = await registerDownloadedSubtitle(
        revision,
        {
          language: 'en',
          title: null,
          forced: false,
          ownerOnly: false,
        },
        bytes,
        {
          library: target,
          provider: 'opensubtitles',
          providerFile: 'fixture-open',
        },
      )
      const privateTrack = await registerDownloadedSubtitle(
        revision,
        {
          language: 'en',
          title: null,
          forced: false,
          ownerOnly: true,
        },
        bytes,
        { library: target, provider: 'subdl', providerFile: 'fixture-subdl' },
      )
      const managedPath = join(dir, artifact.managedName!)
      const privatePath = join(dir, 'subtitles', `${privateTrack.id}.srt`)
      saveSubtitleOffset(
        profileId,
        revision,
        downloadedSubtitleId(privateTrack),
        100,
      )
      saveSubtitleOffset(profileId, revision, 's2', 200)
      writeFileSync(managedPath, 'Owner’s local subtitle edit')

      await removeFromLibrary(torrent)
      expect(existsSync(path)).toBe(false)
      expect(existsSync(privatePath)).toBe(false)
      expect(readFileSync(managedPath, 'utf8')).toBe(
        'Owner’s local subtitle edit',
      )
      expect(
        db
          .select()
          .from(downloadedSubtitles)
          .where(eq(downloadedSubtitles.sourceRevision, revision))
          .all(),
      ).toEqual([])
      expect(
        db
          .select()
          .from(subtitleOffsets)
          .where(eq(subtitleOffsets.sourceRevision, revision))
          .all(),
      ).toEqual([])
    }
    finally {
      dataDir.mockRestore()
      db.delete(libraries).where(eq(libraries.id, library.id)).run()
    }
  })

  it('статус сессии продлевает использование раздачи', async () => {
    const body = await start()
    const stale = new Date(Date.now() - 60 * 60 * 1000)

    getDb()
      .update(torrents)
      .set({ lastAccessAt: stale })
      .where(eq(torrents.id, torrent.id))
      .run()

    const response = await app.inject({
      url: `/api/playback/${body.sessionId}`,
      cookies: owner,
    })
    const row = getDb()
      .select()
      .from(torrents)
      .where(eq(torrents.id, torrent.id))
      .get()

    expect(response.statusCode).toBe(200)
    expect(row!.lastAccessAt!.getTime()).toBeGreaterThan(stale.getTime())
  })

  it('журнал: решение с раздачей и кодеками, ошибка плеера с битыми кусками', async () => {
    const logsDir = mkdtempSync(join(tmpdir(), 'torsher-playback-log-'))
    const logger = createLogger({
      level: 'info',
      logsDir,
      stdout: { write: () => true },
    })
    // Журнал запросов пишет логгер Fastify: в общем приложении тестов его нет
    const logged = createApp({ loggerInstance: logger })

    installLogger(logger)

    try {
      const started = await logged.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: owner,
        payload: { torrentId: torrent.id, fileIndex: 0, device: webos },
      })
      const { sessionId } = started.json()

      // Строка решения пишется по окончании пробы
      await vi.waitFor(async () => {
        const current = await logged.inject({
          url: `/api/playback/${sessionId}`,
          cookies: owner,
        })

        expect(current.json().status).toBe('ready')
      })

      const reported = await logged.inject({
        method: 'POST',
        url: `/api/playback/${sessionId}/error`,
        cookies: owner,
        payload: {
          error: 'unsupported',
          mediaError: 4,
          detail: 'PIPELINE_ERROR_DECODE:\n demuxer',
          position: 12.4,
        },
      })
      const messages = queryLogs({ sources: ['playback'] }).entries.map(
        entry => entry.message,
      )

      expect(reported.statusCode).toBe(200)
      expect(messages).toContain(
        `playback ${sessionId}: direct, torrent=${INFO_HASH} file=0, media=mkv h264 ac3, client=owner other`,
      )
      expect(messages).toContain(
        `playback ${sessionId}: player error unsupported, mediaError=4, detail="PIPELINE_ERROR_DECODE: demuxer", at=12s, badPieces=3`,
      )

      await logged.inject({
        method: 'DELETE',
        url: `/api/playback/${sessionId}`,
        cookies: owner,
      })

      // Поиск по infohash собирает всю сессию: id лежат в полях записей
      const session = queryLogs({ q: INFO_HASH }).entries.reverse()

      expect(session.map(entry => entry.message)).toEqual([
        expect.stringContaining(`playback ${sessionId}: direct`),
        expect.stringContaining(`playback ${sessionId}: player error`),
        expect.stringMatching(
          new RegExp(
            `^playback ${sessionId}: closed after \\d+s, reason=client$`,
          ),
        ),
      ])
      expect(session[0]!.context).toMatchObject({
        session: sessionId,
        infoHash: INFO_HASH,
        fileIndex: 0,
        size: files[0]!.size,
        resolution: '160x90',
        pieceLength: 262_144,
        files: 3,
      })
      // Название раздачи и имя файла в журнал не попадают
      expect(JSON.stringify(session)).not.toMatch(/Film/)
    }
    finally {
      await logged.close()
      installLogger(pino({ level: 'silent' }))
      rmSync(logsDir, { recursive: true, force: true })
    }
  })

  it('журнал: отказ открыть просмотр и неизвестная сессия HLS', async () => {
    const logsDir = mkdtempSync(join(tmpdir(), 'torsher-playback-log-'))
    const logger = createLogger({
      level: 'info',
      logsDir,
      stdout: { write: () => true },
    })
    const logged = createApp({ loggerInstance: logger })
    const pending = getDb()
      .insert(torrents)
      .values({
        infoHash: 'b'.repeat(40),
        name: 'Pending',
        source: 'magnet',
        status: 'resolving',
        files,
      })
      .returning()
      .get()

    installLogger(logger)

    try {
      const rejected = await logged.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: owner,
        payload: { torrentId: pending.id, fileIndex: 0 },
      })

      for (let i = 0; i < 3; i++) {
        await logged.inject({
          url: '/api/hls/gone/0.ts',
          cookies: owner,
        })
      }

      const entries = queryLogs({ sources: ['playback'] }).entries

      expect(rejected.statusCode).toBe(409)
      expect(
        entries.find(
          entry => entry.message === 'playback rejected: metadata not ready',
        )?.context,
      ).toMatchObject({
        torrentId: pending.id,
        infoHash: 'b'.repeat(40),
        fileIndex: 0,
        status: 'resolving',
      })
      // Плеер повторяет запрос сегмента: запись одна
      expect(
        entries.filter(
          entry => entry.message === 'hls: unknown session gone',
        ),
      ).toHaveLength(1)
    }
    finally {
      await logged.close()
      installLogger(pino({ level: 'silent' }))
      getDb().delete(torrents).where(eq(torrents.id, pending.id)).run()
      rmSync(logsDir, { recursive: true, force: true })
    }
  })

  it('ошибка плеера чужой или закрытой сессии — 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/playback/missing/error',
      cookies: owner,
      payload: { error: 'unknown' },
    })

    expect(response.statusCode).toBe(404)
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

  it('изолирует позиции, озвучку и закрытие двух зрителей одного файла', async () => {
    await stopAllSessions()
    const [first, second] = await Promise.all([
      start({ device: chrome, audioStream: 1, startPosition: 0 }),
      start({ device: chrome, audioStream: 2, startPosition: 8 }),
    ])
    const a = getSession(first.sessionId, 'owner')!
    const b = getSession(second.sessionId, 'owner')!
    expect(first.sessionId).not.toBe(second.sessionId)
    expect(a.hls).not.toBe(b.hls)
    expect(a.hls!.dir).not.toBe(b.hls!.dir)
    expect(first).toMatchObject({ audioStream: 1, startPosition: 0 })
    expect(second).toMatchObject({ audioStream: 2, startPosition: 8 })
    const stopSecond = vi.spyOn(b.hls!, 'stop')

    async function segment(session: typeof first, index: number) {
      const response = await app.inject({
        url: `/api/hls/${session.sessionId}/${index}.ts?${session.streamUrl.split('?')[1]}`,
      })
      expect(response.statusCode).toBe(200)
      const details = JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_entries',
            'stream=codec_type,codec_name,start_time',
            '-of',
            'json',
            'pipe:0',
          ],
          { input: response.rawPayload, encoding: 'utf8' },
        ),
      ) as {
        streams: {
          codec_type: string
          codec_name: string
          start_time: string
        }[]
      }
      expect(
        details.streams.find(stream => stream.codec_type === 'audio')
          ?.codec_name,
      ).toBe('aac')
      const videoStart = Number(
        details.streams.find(stream => stream.codec_type === 'video')
          ?.start_time,
      )
      const pcm = execFileSync(
        'ffmpeg',
        [
          '-v',
          'error',
          '-f',
          'mpegts',
          '-i',
          'pipe:0',
          '-map',
          '0:a:0',
          '-t',
          '0.5',
          '-ac',
          '1',
          '-ar',
          '48000',
          '-f',
          'f32le',
          'pipe:1',
        ],
        { input: response.rawPayload },
      )
      // Синтетические дорожки различаются частотой: 440 и 660 Гц.
      let crossings = 0
      const from = 2400
      const samples = pcm.length / 4
      for (let i = from + 1; i < samples; i++) {
        if (pcm.readFloatLE((i - 1) * 4) <= 0 && pcm.readFloatLE(i * 4) > 0)
          crossings++
      }
      return { videoStart, frequency: (crossings * 48_000) / (samples - from) }
    }
    async function close(sessionId: string) {
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: `/api/playback/${sessionId}`,
            cookies: owner,
          })
        ).statusCode,
      ).toBe(200)
    }

    try {
      const [firstData, secondData] = await Promise.all([
        segment(first, 0),
        segment(second, 2),
      ])
      expect(firstData.frequency).toBeCloseTo(440, -1)
      expect(secondData.frequency).toBeCloseTo(660, -1)
      expect(secondData.videoStart).toBeGreaterThan(firstData.videoStart + 7)
      const seek = await segment(first, 3)
      expect(seek.videoStart).toBeGreaterThan(secondData.videoStart + 5)
      expect(seek.frequency).toBeCloseTo(440, -1)

      await close(first.sessionId)
      expect(isStreaming(torrent.id)).toBe(true)
      // Смена дорожки A создаёт новую сессию с той же позицией.
      const replacement = await start({
        device: chrome,
        audioStream: 2,
        startPosition: 14,
      })
      expect(replacement.sessionId).not.toBe(first.sessionId)
      expect((await segment(replacement, 3)).frequency).toBeCloseTo(660, -1)
      await close(replacement.sessionId)
      expect(stopSecond).not.toHaveBeenCalled()
      expect(getSession(second.sessionId, 'owner')).toBe(b)
      expect(b.audioStream).toBe(2)
      expect(isStreaming(torrent.id)).toBe(true)

      // B начал с сегмента 2: сегмент 1 ещё не генерировался. После закрытия
      // обоих запусков A он должен читаться заново своим FFmpeg и с тем же аудио.
      expect(b.hls!.readySegments()).not.toContain(1)
      const secondAfterClose = await segment(second, 1)
      expect(secondAfterClose.frequency).toBeCloseTo(660, -1)
      expect(secondAfterClose.videoStart).toBeLessThan(
        secondData.videoStart - 5,
      )
      expect(stopSecond).not.toHaveBeenCalled()
      await close(second.sessionId)
      expect(isStreaming(torrent.id)).toBe(false)
      expect((await app.inject({ url: second.streamUrl })).statusCode).toBe(
        404,
      )
    }
    finally {
      await stopAllSessions()
    }
  }, 20_000)
})

async function defaultProfileId() {
  const { defaultProfile } = await import('../services/profiles/index.ts')

  return defaultProfile().id
}
