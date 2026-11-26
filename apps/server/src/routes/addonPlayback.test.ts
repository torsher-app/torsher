import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import {
  ACCESS_TOKEN_COOKIE,
  DEVICE_TOKEN_COOKIE,
  PROFILE_COOKIE,
} from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  devices,
  downloadedSubtitles,
  httpAddons,
  libraries,
  libraryFolders,
  mediaFiles,
  profiles,
  subtitleOffsets,
  titleProgress,
  torrents,
  users,
  watchEvents,
} from '../db/schema.ts'
import { insertHttpAddon, patchHttpAddon } from '../services/addons/config.ts'
import { addonTransportDeps } from '../services/addons/transport.ts'
import { hashToken } from '../services/devices/index.ts'
import { setEngineDown, setEngineReady } from '../services/engine/index.ts'
import * as probe from '../services/media/probe.ts'
import {
  createSession,
  getSession,
  stopAllSessions,
  stopSession,
} from '../services/media/sessions.ts'
import { resetMediaTools } from '../services/media/tools.ts'
import { netResolveDeps } from '../services/net/index.ts'
import { defaultProfile } from '../services/profiles/index.ts'
import { bindSessionProfile } from '../services/profiles/playbackAccess.ts'
import { openSubtitlesHash } from '../services/subtitles/target.ts'
import { rememberImdbId } from '../services/ratings/externalIds.ts'
import { getTitleProgress } from '../services/sources/progress.ts'
import { resumeTarget } from '../services/sources/resume.ts'
import { signToken } from '../utils/token.ts'

function hasMediaTools() {
  try {
    for (const binary of ['ffmpeg', 'ffprobe'])
      execFileSync(binary, ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

describe.runIf(hasMediaTools())('guarded HTTP playback', () => {
  const app = createApp()
  const title = { id: 'tmdb:movie:9000101' }
  const watchEvent = { clientId: 'test-viewer', sequence: 1 }
  const owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
  const altProfile = { ...owner, [PROFILE_COOKIE]: 'other' }
  const device = {
    containers: ['mp4'],
    video: ['h264'],
    audio: ['aac'],
    audioTracks: false,
    embeddedSubtitles: false,
    hls: true,
  }
  const origin = 'https://video.example'
  const url = `${origin}/fixture.mp4?token=stream-secret`
  const opaqueStem = 'fictionalOpaqueAssetToken77'
  const opaqueBasename = `${opaqueStem}.mp4`
  let opaque = false
  let serveShort = false
  let heldRange: (() => ReadableStream<Uint8Array<ArrayBuffer>>) | undefined
  let releaseHeldRange: (() => void) | undefined
  let loopback: string | undefined
  let mp4: Uint8Array
  let mkv: Uint8Array
  let rangeRequests: string[]
  let etag: string
  let broken = false
  let matroska = false
  let holdPrefix: (() => Promise<void>) | undefined

  beforeAll(async () => {
    await migrateDb()
    getDb()
      .insert(users)
      .values({ id: 'owner', username: 'Owner', passwordHash: 'hash' })
      .run()
    defaultProfile()
    getDb()
      .insert(profiles)
      .values({ id: 'other', name: 'Other', color: 'violet', position: 1 })
      .run()
    rememberImdbId({ type: 'movie', tmdbId: 9000101 }, 'tt9000101')
    const dir = mkdtempSync(join(tmpdir(), 'torsher-addon-playback-'))
    try {
      const captions = join(dir, 'embedded.srt')
      writeFileSync(
        captions,
        '1\n00:00:00,200 --> 00:00:01,000\nEmbedded captions\n',
      )
      for (const extension of ['mp4', 'mkv']) {
        const output = join(dir, `fixture.${extension}`)
        execFileSync('ffmpeg', [
          '-v',
          'error',
          '-y',
          '-f',
          'lavfi',
          '-i',
          extension === 'mp4'
            ? 'color=black:s=96x64:r=2'
            : 'color=black:s=96x64:r=24',
          ...(extension === 'mp4'
            ? [
                '-f',
                'lavfi',
                '-i',
                'anullsrc=r=8000:cl=mono',
                '-map',
                '0:v',
                '-map',
                '1:a',
                '-map',
                '1:a',
                '-c:a',
                'aac',
              ]
            : ['-i', captions, '-map', '0:v', '-map', '1:s', '-c:s', 'srt']),
          '-t',
          extension === 'mp4' ? '600' : '1.5',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          output,
        ])
        if (extension === 'mkv')
          mkv = readFileSync(output)
        else mp4 = readFileSync(output)
      }
    }
    finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  beforeEach(() => {
    vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
    vi.stubEnv('FFPROBE_PATH', 'ffprobe')
    resetMediaTools()
    rangeRequests = []
    etag = '"fixture-v1"'
    broken = false
    matroska = false
    opaque = false
    serveShort = false
    heldRange = undefined
    releaseHeldRange = undefined
    holdPrefix = undefined
    vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
    vi.spyOn(addonTransportDeps, 'send').mockImplementation(
      async (url, _, options) => {
        let destroy = async () => {}
        if (url.pathname.endsWith('/manifest.json')) {
          return {
            response: Response.json({
              id: 'example.media',
              name: 'Example',
              version: '1.0.0',
              types: ['movie'],
              resources: ['stream'],
            }),
            destroy,
          }
        }
        if (url.hostname === 'addon.example') {
          return {
            response: Response.json({
              streams: [
                {
                  url: urlForMedia(),
                  name: 'Example',
                  ...(opaque && { title: `Selection ${opaqueBasename}` }),
                  behaviorHints: {
                    proxyHeaders: {
                      request: { Authorization: 'Bearer header-secret' },
                    },
                    ...(opaque && { filename: opaqueStem }),
                  },
                },
              ],
            }),
            destroy,
          }
        }
        expect(options.headers.get('authorization')).toBe(
          'Bearer header-secret',
        )
        expect(options.headers.get('accept-encoding')).toBe('identity')
        const range = options.headers.get('range')!
        rangeRequests.push(range)
        if (range === 'bytes=0-4095' && holdPrefix) {
          const hold = holdPrefix
          holdPrefix = undefined
          await hold()
        }
        const match = /^bytes=(\d+)-(\d+)$/.exec(range)!
        const content = matroska || serveShort ? mkv : mp4
        const start = Number(match[1])
        const end = Math.min(Number(match[2]), content.byteLength - 1)
        const hold = range === 'bytes=0-255' && heldRange
        if (hold) {
          destroy = async () => {
            releaseHeldRange?.()
          }
        }
        return {
          response: new Response(
            hold
              ? hold()
              : (content.slice(start, end + 1) as Uint8Array<ArrayBuffer>),
            {
              status: broken ? 200 : 206,
              headers: {
                'content-range': `bytes ${start}-${end}/${content.byteLength}`,
                'etag': etag,
                'set-cookie': 'upstream-cookie',
              },
            },
          ),
          destroy,
        }
      },
    )
  })

  afterEach(async () => {
    await stopAllSessions()
    probe.clearProbeCache()
    getDb().delete(httpAddons).run()
    getDb().delete(titleProgress).run()
    getDb().delete(watchEvents).run()
    getDb().delete(devices).run()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
  afterAll(() => app.close())

  function urlForMedia() {
    if (matroska || serveShort)
      return url.replace('.mp4', '.mkv')
    return opaque ? url.replace('fixture.mp4', opaqueBasename) : url
  }

  async function launch() {
    const addon = await insertHttpAddon('owner', {
      url: 'https://addon.example/manifest.json?token=manifest-secret',
      selections: { stream: true, subtitles: false, catalogs: [] },
    })
    const sources = await app.inject({
      url: `/api/titles/${title.id}/addon-sources`,
      cookies: owner,
    })
    const chosen = await app.inject({
      method: 'POST',
      url: `/api/titles/${title.id}/addon-sources/play`,
      cookies: owner,
      payload: { candidateId: sources.json().items[0].id },
    })
    expect(chosen.statusCode).toBe(200)
    return { addon, launchId: chosen.json().launchId as string, sources }
  }

  function start(
    source: { addonLaunchId: string } | { addonSessionId: string },
    options = {},
  ) {
    return app.inject({
      method: 'POST',
      url: '/api/playback',
      cookies: owner,
      payload: {
        ...source,
        ...('addonSessionId' in source && {
          addonOperationId: 'test-reconfigure',
        }),
        title,
        profileId: defaultProfile().id,
        device,
        ...options,
      },
    })
  }

  function checkpoint(sessionId: string, overrides = {}, cookies = owner) {
    return app.inject({
      method: 'PUT',
      url: '/api/watch-state',
      cookies,
      payload: {
        addonHttp: true,
        sessionId,
        title,
        profileId: defaultProfile().id,
        position: 120,
        duration: 600,
        event: watchEvent,
        ...overrides,
      },
    })
  }

  it('probes MP4 through the local bridge and returns only verified byte ranges', async () => {
    const { addon, launchId } = await launch()
    const payload = { addonLaunchId: launchId }
    const [first, repeated] = await Promise.all([
      start(payload),
      start(payload),
    ])
    expect(first.statusCode, first.body).toBe(200)
    const playing = first.json()
    expect(repeated.json().sessionId).toBe(playing.sessionId)
    expect(playing).toMatchObject({
      status: 'ready',
      mode: 'direct',
      size: mp4.byteLength,
      externalUrl: null,
    })
    expect(first.body).not.toMatch(
      /video\.example|stream-secret|header-secret|addon-media|manifest-secret/,
    )
    expect(rangeRequests[0]).toBe('bytes=0-4095')
    expect(rangeRequests.length).toBeGreaterThan(1)

    const bridge = new URL(
      getSession(playing.sessionId, 'owner')!.addonMedia!.url,
    )
    expect(bridge.hostname).toBe('127.0.0.1')
    expect((await fetch(new URL('/incorrect', bridge))).status).toBe(404)
    const range = await app.inject({
      url: playing.streamUrl,
      headers: { range: 'bytes=-16' },
    })
    expect(range.statusCode, range.body).toBe(206)
    expect(range.headers['set-cookie']).toBeUndefined()
    expect(range.headers['content-range']).toBe(
      `bytes ${mp4.byteLength - 16}-${mp4.byteLength - 1}/${mp4.byteLength}`,
    )
    expect(range.rawPayload.equals(mp4.slice(-16))).toBe(true)
    const invalid = await app.inject({
      url: playing.streamUrl,
      headers: { range: 'bytes=400000-' },
    })
    expect(invalid.statusCode).toBe(416)
    expect(invalid.headers['content-range']).toBe(`bytes */${mp4.byteLength}`)
    expect(
      (await app.inject({ url: playing.streamUrl, cookies: altProfile }))
        .statusCode,
    ).toBe(401)

    await patchHttpAddon('owner', addon.id, { enabled: false })
    expect((await app.inject({ url: playing.streamUrl })).statusCode).toBe(404)
    await expect(fetch(bridge)).rejects.toThrow()
  })

  it('keeps checkpoints scoped to the exact title and latest session, including the final write after close', async () => {
    const { launchId } = await launch()
    const playing = (await start({ addonLaunchId: launchId })).json()
    const sessionId = playing.sessionId as string
    const ref = { titleId: title.id, profileId: defaultProfile().id }
    expect(
      (await checkpoint(sessionId, { title: { id: 'tmdb:movie:9000102' } }))
        .statusCode,
    ).toBe(404)
    expect((await checkpoint(sessionId, {}, altProfile)).statusCode).toBe(404)
    expect((await checkpoint(sessionId)).json()).toMatchObject({
      position: 120,
      accepted: true,
    })
    expect(getTitleProgress(ref)).toMatchObject({
      position: 120,
      lastSourceKind: 'addonHttp',
      torrentId: null,
      fileIndex: null,
      mediaFileId: null,
    })
    expect(
      await resumeTarget(ref.profileId, ref.titleId, async () => []),
    ).toMatchObject({ addonHttp: true, position: 120 })

    const replacement = await start(
      { addonSessionId: sessionId },
      {
        audioStream: 2,
        device: { ...device, audioTracks: true },
      },
    )
    expect(replacement.statusCode, replacement.body).toBe(200)
    const next = replacement.json().sessionId as string
    expect(next).not.toBe(sessionId)
    expect(replacement.json()).toMatchObject({
      audioStream: 2,
      startPosition: 120,
    })
    expect(
      (await checkpoint(sessionId, { event: { ...watchEvent, sequence: 2 } }))
        .statusCode,
    ).toBe(404)

    await app.inject({
      method: 'DELETE',
      url: `/api/playback/${next}`,
      cookies: owner,
    })
    const saved = await checkpoint(next, {
      position: 180,
      event: { ...watchEvent, sequence: 2 },
    })
    expect(saved.json()).toMatchObject({ position: 180, accepted: true })
    expect((await checkpoint(next)).json()).toMatchObject({
      position: 180,
      accepted: false,
      rejection: 'stale',
    })
  })

  it('keeps initial launch single-use and replays only the same reconfiguration operation', async () => {
    const { launchId } = await launch()
    const first = await start(
      { addonLaunchId: launchId },
      { addonOperationId: 'start-a' },
    )
    const replay = await start(
      { addonLaunchId: launchId },
      { addonOperationId: 'start-b' },
    )
    const sessionId = first.json().sessionId as string
    expect(sessionId).toEqual(expect.any(String))
    expect(replay.json().sessionId).toBe(sessionId)
    const payload = { addonSessionId: sessionId }
    const platform = { ...device, audioTracks: true }
    const [a, b] = await Promise.all([
      start(payload, {
        device: platform,
        audioStream: 1,
        addonOperationId: 'replace-a',
      }),
      start(payload, {
        device: platform,
        audioStream: 2,
        addonOperationId: 'replace-b',
      }),
    ])
    const retry = await start(payload, {
      device: platform,
      audioStream: 2,
      addonOperationId: 'replace-b',
    })
    expect(a.json()).toMatchObject({
      audioStream: 1,
      sessionId: expect.any(String),
    })
    expect(b.json()).toMatchObject({
      audioStream: 2,
      sessionId: expect.any(String),
    })
    expect(a.json().sessionId).not.toBe(b.json().sessionId)
    expect(retry.json().sessionId).toBe(b.json().sessionId)
  })

  it('does not automatically seek to the end when a freshly selected file is shorter', async () => {
    const long = await launch()
    const first = await start({ addonLaunchId: long.launchId })
    expect((await checkpoint(first.json().sessionId)).json()).toMatchObject({
      accepted: true,
    })
    serveShort = true
    const short = await launch()
    const profile = { ...device, containers: ['mkv'] }
    const response = await start(
      { addonLaunchId: short.launchId },
      { device: profile },
    )
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ready',
      startPosition: null,
      duration: 1.5,
    })
    const explicit = await start(
      { addonSessionId: response.json().sessionId },
      {
        device: profile,
        startPosition: 0.5,
      },
    )
    expect(explicit.json()).toMatchObject({
      status: 'ready',
      startPosition: 0.5,
    })
  })

  it('filters an opaque final asset segment and its stem without dropping the candidate', async () => {
    opaque = true
    const selected = await launch()
    expect(selected.sources.json().items).toContainEqual(
      expect.objectContaining({ name: 'Example' }),
    )
    const response = await start({ addonLaunchId: selected.launchId })
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toMatchObject({
      title: 'video',
      fileName: 'video',
    })
    expect(selected.sources.body + response.body).not.toContain(opaqueStem)
    const media = getSession(response.json().sessionId, 'owner')!.addonMedia!
    expect(media.safeText(opaqueBasename)).toBeNull()
    expect(media.safeText(`audio ${opaqueStem}`)).toBeNull()
    expect(media.safeText('Director commentary')).toBe('Director commentary')
  })

  it.each([
    'profile-switch',
    'device-revoked',
    'age-limit',
    'owner-version',
  ] as const)(
    'aborts a direct stream after its first bytes when access changes (%s)',
    async (cause) => {
      const { launchId } = await launch()
      const profileId = defaultProfile().id
      const deviceToken = 'test-device-direct-stream-token'
      const deviceId = 'test-device-stream'
      let launchKey = launchId
      let cookies: Record<string, string> = owner
      if (cause === 'profile-switch' || cause === 'device-revoked') {
        getDb()
          .insert(devices)
          .values({
            id: deviceId,
            name: 'Test TV',
            type: 'other',
            tokenHash: hashToken(deviceToken),
            profileId,
          })
          .run()
        cookies = { [DEVICE_TOKEN_COOKIE]: deviceToken }
        const sources = await app.inject({
          url: `/api/titles/${title.id}/addon-sources`,
          cookies,
        })
        const chosen = await app.inject({
          method: 'POST',
          url: `/api/titles/${title.id}/addon-sources/play`,
          cookies,
          payload: { candidateId: sources.json().items[0].id },
        })
        launchKey = chosen.json().launchId
      }
      const result = await app.inject({
        method: 'POST',
        url: '/api/playback',
        cookies,
        payload: { addonLaunchId: launchKey, profileId, device, title },
      })
      expect(result.statusCode, result.body).toBe(200)
      loopback ??= await app.listen({ host: '127.0.0.1', port: 0 })
      const upstreamClosed = Promise.withResolvers<void>()
      heldRange = () =>
        new ReadableStream({
          start(controller) {
            controller.enqueue(mp4.slice(0, 16) as Uint8Array<ArrayBuffer>)
            releaseHeldRange = () => {
              controller.error(new Error('Test range closed'))
              upstreamClosed.resolve()
            }
          },
        })
      const response = await fetch(new URL(result.json().streamUrl, loopback), {
        headers: { range: 'bytes=0-255' },
        signal: AbortSignal.timeout(3000),
      })
      expect(response.status).toBe(206)
      const reader = response.body!.getReader()
      expect((await reader.read()).value?.byteLength).toBe(16)
      const db = getDb()
      try {
        if (cause === 'profile-switch') {
          db.update(devices)
            .set({ profileId: 'other' })
            .where(eq(devices.id, deviceId))
            .run()
        }
        else if (cause === 'device-revoked') {
          db.delete(devices).where(eq(devices.id, deviceId)).run()
        }
        else if (cause === 'age-limit') {
          db.update(profiles)
            .set({ ageLimit: 13 })
            .where(eq(profiles.id, profileId))
            .run()
        }
        else {
          db.update(users)
            .set({ sessionVersion: 1 })
            .where(eq(users.id, 'owner'))
            .run()
        }

        await expect(reader.read()).rejects.toThrow()
        await upstreamClosed.promise
      }
      finally {
        db.update(users)
          .set({ sessionVersion: 0 })
          .where(eq(users.id, 'owner'))
          .run()
        db.update(profiles)
          .set({ ageLimit: null })
          .where(eq(profiles.id, profileId))
          .run()
      }
    },
  )

  it('promotes the new session after an old session saves during its probe', async () => {
    const old = await launch()
    const sessionA = (await start({ addonLaunchId: old.launchId })).json().sessionId as string
    const next = await launch()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    holdPrefix = () => {
      entered.resolve()
      return release.promise
    }
    const pending = start({ addonLaunchId: next.launchId })
    await entered.promise
    try {
      expect((await checkpoint(sessionA)).json()).toMatchObject({
        accepted: true,
        position: 120,
      })
    }
    finally {
      release.resolve()
    }
    const response = await pending
    expect(response.statusCode, response.body).toBe(200)
    const sessionB = response.json().sessionId as string
    expect(
      (await checkpoint(sessionA, { event: { ...watchEvent, sequence: 2 } }))
        .statusCode,
    ).toBe(404)
    expect(
      (
        await checkpoint(sessionB, {
          position: 180,
          event: { ...watchEvent, sequence: 2 },
        })
      ).json(),
    ).toMatchObject({ position: 180, accepted: true })
  })

  it('rejects an upstream that ignores ranges and a replacement representation', async () => {
    const first = await launch()
    broken = true
    expect((await start({ addonLaunchId: first.launchId })).statusCode).toBe(
      502,
    )

    broken = false
    const { launchId } = await launch()
    const result = await start({ addonLaunchId: launchId })
    expect(result.statusCode, result.body).toBe(200)
    etag = '"fixture-v2"'
    const expired = await app.inject({
      url: result.json().streamUrl,
      headers: { range: 'bytes=0-15' },
    })
    expect(expired.statusCode).toBe(502)
    const options = vi.mocked(addonTransportDeps.send).mock.lastCall?.[2]
    expect(options?.headers.get('if-range')).toBe('"fixture-v1"')
    expect(
      (
        await app.inject({
          url: `/api/playback/${result.json().sessionId}`,
          cookies: owner,
        })
      ).statusCode,
    ).toBe(502)
  })

  it('preserves the checkpoint when the upstream media URL expires', async () => {
    const { launchId } = await launch()
    const result = await start({ addonLaunchId: launchId })
    expect(result.statusCode, result.body).toBe(200)
    const { sessionId, streamUrl } = result.json()
    expect((await checkpoint(sessionId)).json()).toMatchObject({
      position: 120,
      accepted: true,
    })

    vi.mocked(addonTransportDeps.send).mockResolvedValueOnce({
      response: new Response(null, { status: 410 }),
      destroy: async () => {},
    })
    const expired = await app.inject({
      url: streamUrl,
      headers: { range: 'bytes=0-15' },
    })
    expect(expired.statusCode).toBe(502)
    const saved = await resumeTarget(
      defaultProfile().id,
      title.id,
      async () => [],
    )
    expect(saved).toMatchObject({ addonHttp: true, position: 120 })
  })

  it('rejects a playlist delivered in place of the selected video file', async () => {
    const { launchId } = await launch()
    const playlist
      = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n'
    const send = vi.mocked(addonTransportDeps.send)
    send.mockClear()
    send.mockResolvedValueOnce({
      response: new Response(playlist, {
        status: 206,
        headers: {
          'content-range': `bytes 0-${playlist.length - 1}/${playlist.length}`,
        },
      }),
      destroy: async () => {},
    })

    const result = await start({ addonLaunchId: launchId })
    expect(result.statusCode).toBe(502)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0].pathname).toBe('/fixture.mp4')
  })

  it.each(['copy', 'encode'] as const)(
    'serves MKV through HLS with video %s',
    async (mode) => {
      matroska = true
      const { launchId } = await launch()
      const result = await start(
        { addonLaunchId: launchId },
        {
          device: mode === 'copy' ? device : { ...device, video: [] },
        },
      )
      expect(result.statusCode, result.body).toBe(200)
      const playing = result.json()
      expect(playing).toMatchObject({
        status: 'ready',
        mode: 'hls',
        size: mkv.byteLength,
        externalUrl: null,
      })
      expect(!!playing.transcode.video).toBe(mode === 'encode')
      const playlist = await app.inject({ url: playing.streamUrl })
      expect(playlist.body).toContain('#EXTM3U')
      const segment = playlist.body
        .split('\n')
        .find(line => /^\d+\.ts/u.test(line))!
      const base = new URL(playing.streamUrl, 'http://torsher.example')
      const segmentPath = new URL(segment, base)
      const bytes = await app.inject({
        url: `${segmentPath.pathname}${segmentPath.search}`,
      })
      expect(bytes.statusCode, bytes.statusCode === 200 ? '' : bytes.body).toBe(
        200,
      )
      expect(bytes.rawPayload[0]).toBe(0x47)

      expect(playing.media.subtitles).toMatchObject([
        { id: 's1', codec: 'subrip', external: false },
      ])
      const cues = await app.inject({
        url: `/api/playback/${playing.sessionId}/subtitles/s1`,
        cookies: owner,
      })
      expect(cues.statusCode, cues.body).toBe(200)
      expect(cues.json().cues).toEqual([
        { start: 0.2, end: 1, text: 'Embedded captions' },
      ])
    },
    20_000,
  )
  function mockSubtitles(asset?: () => Promise<Response> | Response) {
    const send = vi.mocked(addonTransportDeps.send)
    const original = send.getMockImplementation()!
    return send.mockImplementation(async (target, addresses, request) => {
      if (
        !['captions.example', 'unavailable.example'].includes(target.hostname)
      )
        return original(target, addresses, request)
      expect(request.headers.has('authorization')).toBe(false)
      const destroy = async () => {}
      if (target.pathname.endsWith('/manifest.json')) {
        return {
          response: Response.json({
            id: 'example.captions',
            name: 'Fixture captions',
            version: '1.0.0',
            types: ['movie'],
            resources: ['subtitles'],
          }),
          destroy,
        }
      }
      if (target.pathname.includes('/subtitles/')) {
        return {
          response:
            target.hostname === 'unavailable.example'
              ? new Response(null, { status: 502 })
              : Response.json({
                  subtitles: [
                    {
                      id: 'subtitle-id',
                      lang: 'eng',
                      label: 'Example English',
                      url: 'https://captions.example/file?key=subtitle-secret',
                    },
                    {
                      id: 'another-language',
                      lang: 'ru',
                      url: 'https://captions.example/ignored.srt',
                    },
                    {
                      id: 'invalid-url',
                      lang: 'eng',
                      url: 'file:///invalid.srt',
                    },
                  ],
                }),
          destroy,
        }
      }
      const text = [
        '1\n00:00:01,000 --> 00:00:02,000\nExample subtitle',
        '2\n00:00:03,000 --> 00:00:04,000\nsubtitle-secret',
        '3\n00:00:05,000 --> 00:00:06,000\nmanifest-secret',
      ].join('\n\n')
      return { response: asset ? await asset() : new Response(text), destroy }
    })
  }

  function enableSubtitles(host = 'captions.example') {
    return insertHttpAddon('owner', {
      url: `https://${host}/subtitle-config/manifest.json?key=manifest-secret`,
      selections: { stream: false, subtitles: true, catalogs: [] },
    })
  }

  function searchSubtitles(id: string) {
    return app.inject({
      method: 'POST',
      url: `/api/playback/${id}/subtitles/search`,
      cookies: owner,
      payload: { language: 'en' },
    })
  }

  function applySubtitle(id: string, resultId: string, cookies = owner) {
    return app.inject({
      method: 'POST',
      url: `/api/playback/${id}/subtitles/apply`,
      cookies,
      payload: { resultId },
    })
  }

  it('attaches remote SRT to an opted-in session and preserves it only on reconfiguration', async () => {
    const send = mockSubtitles()
    const captions = await enableSubtitles()
    await enableSubtitles('unavailable.example')

    const old = await launch()
    const legacy = (await start({ addonLaunchId: old.launchId })).json()
    expect(legacy.subtitleSearch).toBeUndefined()
    expect((await searchSubtitles(legacy.sessionId)).statusCode).toBe(404)

    const { launchId } = await launch()
    const opened = await start(
      { addonLaunchId: launchId },
      { addonSubtitles: true },
    )
    expect(opened.statusCode, opened.body).toBe(200)
    expect(opened.json().subtitleSearch.providers).toEqual(['addon'])
    const id = opened.json().sessionId as string
    const result = await searchSubtitles(id)
    expect(result.statusCode, result.body).toBe(200)
    const { items, issues } = result.json()
    expect(issues).toEqual([{ provider: 'addon', kind: 'unavailable' }])
    expect(items).toEqual([
      {
        id: expect.any(String),
        provider: 'addon',
        language: 'en',
        release: 'Example English',
        addonName: 'Fixture captions',
        match: 'title',
      },
    ])
    expect(result.body).not.toMatch(
      /subtitle-secret|manifest-secret|captions\.example|subtitle-id/,
    )
    const lookup = send.mock.calls.find(
      ([target]) =>
        target.hostname === 'captions.example'
        && target.pathname.includes('/subtitles/'),
    )?.[0]
    expect(decodeURIComponent(lookup?.pathname ?? '')).toBe(
      `/subtitle-config/subtitles/movie/tt9000101/videoSize=${mp4.byteLength}.json`,
    )

    expect((await applySubtitle(id, items[0].id, altProfile)).statusCode).toBe(
      404,
    )
    const applied = await applySubtitle(id, items[0].id)
    expect(applied.statusCode, applied.body).toBe(200)
    const track = applied.json()
    expect(track).toMatchObject({
      id: expect.stringMatching(/^a/),
      external: true,
      offsetMs: 0,
    })
    expect(track.downloaded).toBeUndefined()
    expect((await applySubtitle(id, items[0].id)).json().id).toBe(track.id)
    expect(
      send.mock.calls.filter(([target]) => target.pathname === '/file'),
    ).toHaveLength(1)
    const cueUrl = `/api/playback/${id}/subtitles/${track.id}`
    const cues = await app.inject({ url: cueUrl, cookies: owner })
    expect(cues.json()).toEqual({
      cues: [{ start: 1, end: 2, text: 'Example subtitle' }],
      done: true,
    })

    const preference = await app.inject({
      method: 'PUT',
      url: `/api/playback/${id}/preferences`,
      payload: { subtitle: track.id },
      cookies: owner,
    })
    expect(preference.statusCode, preference.body).toBe(200)
    const offset = await app.inject({
      method: 'PUT',
      url: `${cueUrl}/offset`,
      payload: { offsetMs: 190 },
      cookies: owner,
    })
    expect(offset.json()).toEqual({ offsetMs: 190 })
    expect(getDb().select().from(subtitleOffsets).all()).toEqual([])
    expect(getDb().select().from(downloadedSubtitles).all()).toEqual([])

    const replacement = await start(
      { addonSessionId: id },
      {
        addonSubtitles: true,
        audioStream: 2,
        subtitle: track.id,
        device: { ...device, audioTracks: true },
      },
    )
    expect(replacement.statusCode, replacement.body).toBe(200)
    const next = replacement.json()
    expect(next).toMatchObject({
      subtitle: track.id,
      media: {
        subtitles: [expect.objectContaining({ id: track.id, offsetMs: 190 })],
      },
    })
    expect((await applySubtitle(next.sessionId, items[0].id)).statusCode).toBe(
      404,
    )
    const nextCues = `/api/playback/${next.sessionId}/subtitles/${track.id}`
    expect(
      (await app.inject({ url: nextCues, cookies: owner })).statusCode,
    ).toBe(200)

    const separate = await launch()
    const independent = await start(
      { addonLaunchId: separate.launchId },
      { addonSubtitles: true, subtitle: track.id },
    )
    expect(independent.json()).toMatchObject({
      subtitle: null,
      media: { subtitles: [] },
    })

    await patchHttpAddon('owner', captions.id, { enabled: false })
    expect((await applySubtitle(id, items[0].id)).statusCode).toBe(404)
    expect((await app.inject({ url: cueUrl, cookies: owner })).statusCode).toBe(
      404,
    )
    expect(
      (await app.inject({ url: nextCues, cookies: owner })).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          url: `/api/playback/${next.sessionId}`,
          cookies: owner,
        })
      ).json(),
    ).toMatchObject({ subtitle: null, media: { subtitles: [] } })
  })

  it('finds addon subtitles for a selected torrent without reading a file hash', async () => {
    const send = mockSubtitles()
    await enableSubtitles()
    const db = getDb()
    const name = 'Fictional Fixture.1080p.mp4'
    const torrent = db
      .insert(torrents)
      .values({
        infoHash: '8'.repeat(40),
        name,
        source: 'magnet',
        status: 'ready',
        titleId: title.id,
        matchStatus: 'matched',
        files: [{ path: name, size: mp4.length, padding: false }],
      })
      .returning()
      .get()
    setEngineReady('http://127.0.0.1:9')
    vi.spyOn(probe, 'probeMedia').mockResolvedValue({
      container: 'mp4',
      duration: 600,
      video: null,
      audio: [],
      subtitles: [],
    })
    const session = createSession({
      subject: 'owner',
      torrent,
      fileIndex: 0,
      fileName: name,
      addonSubtitles: true,
      preference: {},
      log: app.log,
    })
    bindSessionProfile(session, defaultProfile().id)
    try {
      await session.ready
      const search = await searchSubtitles(session.id)
      expect(search.statusCode, search.body).toBe(200)
      const lookup = send.mock.calls.find(([target]) =>
        target.pathname.includes('/subtitles/'),
      )?.[0]
      expect(decodeURIComponent(lookup?.pathname ?? '')).toBe(
        `/subtitle-config/subtitles/movie/tt9000101/videoSize=${mp4.length}.json`,
      )
      const applied = await applySubtitle(
        session.id,
        search.json().items[0].id,
      )
      expect(applied.statusCode, applied.body).toBe(200)
      expect(applied.json().id).toMatch(/^a/)
      expect(db.select().from(downloadedSubtitles).all()).toEqual([])
    }
    finally {
      await stopSession(session.id)
      db.delete(torrents).where(eq(torrents.id, torrent.id)).run()
      setEngineDown('stopped')
    }
  })

  it('sends the hash of a complete library file and does not create a sidecar', async () => {
    const send = mockSubtitles()
    await enableSubtitles()
    const dir = mkdtempSync(join(tmpdir(), 'torsher-addon-subtitles-'))
    const name = 'Synthetic fixture.mp4'
    const path = join(dir, name)
    writeFileSync(path, Buffer.concat([mp4, Buffer.alloc(128 * 1024)]))
    const stat = statSync(path)
    const db = getDb()
    const library = db
      .insert(libraries)
      .values({ name: 'Fixture subtitles', kind: 'video', managed: true })
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
        relPath: name,
        size: stat.size,
        mtime: stat.mtime,
        inode: stat.ino,
        titleId: title.id,
        matchStatus: 'matched',
      })
      .returning()
      .get()
    try {
      const playback = await app.inject({
        method: 'POST',
        url: '/api/playback',
        cookies: owner,
        payload: { mediaFileId: file.id, addonSubtitles: true, device },
      })
      expect(playback.statusCode, playback.body).toBe(200)
      const id = playback.json().sessionId as string
      const search = await searchSubtitles(id)
      expect(search.statusCode, search.body).toBe(200)
      const lookup = send.mock.calls.find(([target]) =>
        target.pathname.includes('/subtitles/'),
      )?.[0]
      const hash = await openSubtitlesHash(path)
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
      expect(decodeURIComponent(lookup?.pathname ?? '')).toBe(
        `/subtitle-config/subtitles/movie/tt9000101/videoHash=${hash}&videoSize=${stat.size}.json`,
      )
      const resultId = search.json().items[0].id as string
      const applied = await applySubtitle(id, resultId)
      expect(applied.statusCode, applied.body).toBe(200)
      expect(readdirSync(dir)).toEqual([name])
      expect(db.select().from(downloadedSubtitles).all()).toEqual([])
      const trackUrl = `/api/playback/${id}/subtitles/${applied.json().id}`
      await app.inject({
        method: 'DELETE',
        url: `/api/playback/${id}`,
        cookies: owner,
      })
      expect(
        (await app.inject({ url: trackUrl, cookies: owner })).statusCode,
      ).toBe(404)
      expect((await applySubtitle(id, resultId)).statusCode).toBe(404)
    }
    finally {
      db.delete(libraries).where(eq(libraries.id, library.id)).run()
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('rejects a delayed SRT when profile access changes during download', async () => {
    const expectAsset = Promise.withResolvers<void>()
    const release = Promise.withResolvers<Response>()
    mockSubtitles(() => {
      expectAsset.resolve()
      return release.promise
    })
    await enableSubtitles()
    const { launchId } = await launch()
    const started = await start(
      { addonLaunchId: launchId },
      { addonSubtitles: true },
    )
    expect(started.statusCode, started.body).toBe(200)
    const id = started.json().sessionId as string
    const search = await searchSubtitles(id)
    expect(search.statusCode, search.body).toBe(200)
    const pending = applySubtitle(id, search.json().items[0].id)
    const db = getDb()
    const profile = eq(profiles.id, defaultProfile().id)
    try {
      await expectAsset.promise
      db.update(profiles).set({ ageLimit: 13 }).where(profile).run()
      release.resolve(
        new Response('1\n00:00:01,000 --> 00:00:02,000\nExample subtitle'),
      )
      expect((await pending).statusCode).toBe(404)
    }
    finally {
      release.resolve(new Response(null, { status: 502 }))
      await pending
      db.update(profiles).set({ ageLimit: null }).where(profile).run()
    }
    expect(
      (await app.inject({ url: `/api/playback/${id}`, cookies: owner })).json(),
    ).toMatchObject({ subtitle: null, media: { subtitles: [] } })
  })
})
