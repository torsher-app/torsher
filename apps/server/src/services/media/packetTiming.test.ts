import type { Torrent } from '../../db/schema.ts'
import type { DeviceProfile } from './decide.ts'
import type { SessionLog } from './sessions.ts'
import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { migrateDb } from '../../db/index.ts'
import { liveStats } from '../engine/fixtures/index.ts'
import { setEngineDown, setEngineReady } from '../engine/index.ts'
import { libraryProbeKey } from '../library/playedSource.ts'
import * as accel from './accel.ts'
import * as cueCache from './cueCache.ts'
import { clearCueCache, loadLibraryCues } from './cueCache.ts'
import { buildPlaylist, TS_OFFSET_SECONDS } from './hls.ts'
import { readMatroskaCues } from './matroska.ts'
import * as probe from './probe.ts'
import { hlsTiming, parseProbe, probePacketEnds } from './probe.ts'
import { createSession, stopSession } from './sessions.ts'

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

const log: SessionLog = {
  info: () => {},
  debug: () => {},
  warn: () => {},
  child: () => log,
}

const device: DeviceProfile = {
  containers: ['mp4'],
  video: ['h264'],
  audio: ['aac'],
  audioTracks: false,
  embeddedSubtitles: false,
  hls: true,
}

async function makeFixture(path: string, indexed: boolean) {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    indexed ? 'testsrc2=s=640x360:r=30:d=6' : 'color=s=80x48:r=30:d=6',
    '-f',
    'lavfi',
    '-i',
    'sine=f=440:r=48000:d=6',
    '-f',
    'lavfi',
    '-i',
    'sine=f=660:r=48000:d=9',
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-map',
    '2:a',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-g',
    '60',
    '-sc_threshold',
    '0',
    '-bf',
    '2',
    '-c:a',
    'aac',
    '-output_ts_offset',
    '100',
    '-live',
    indexed ? '0' : '1',
    path,
  ])
  const bytes = await readFile(path)
  if (indexed) {
    // Rename the generated DURATION keys in place, preserving EBML sizes.
    const tag = Buffer.from('DURATION')
    for (
      let i = bytes.indexOf(tag);
      i !== -1;
      i = bytes.indexOf(tag, i + tag.length)
    )
      bytes[i] = 'X'.charCodeAt(0)
    await writeFile(path, bytes)
  }
  return bytes
}

function packets(path: string) {
  return (
    JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_packets',
          '-show_entries',
          'packet=stream_index,pts_time,duration_time',
          '-of',
          'json',
          path,
        ],
        { encoding: 'utf8' },
      ),
    ) as {
      packets: {
        stream_index: number
        pts_time: string
        duration_time: string
      }[]
    }
  ).packets
}

function packetEnd(stream: ReturnType<typeof packets>, index: number) {
  return Math.max(
    ...stream
      .filter(packet => packet.stream_index === index)
      .map(packet => Number(packet.pts_time) + Number(packet.duration_time)),
  )
}

describe.runIf(hasFfmpeg())('source and HLS timing on FFmpeg', () => {
  let dir: string
  let path: string
  let bytes: Buffer
  const signal = new AbortController().signal

  beforeAll(async () => {
    vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
    vi.stubEnv('FFPROBE_PATH', 'ffprobe')
    vi.spyOn(accel, 'mediaAccel').mockResolvedValue({
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
      checkedAt: '2026-11-18',
    })
    await migrateDb()
    dir = await mkdtemp(join(tmpdir(), 'torsher-packet-timing-'))
    path = join(dir, 'indexed.mkv')
    bytes = await makeFixture(path, true)
  })

  afterAll(async () => {
    clearCueCache()
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    if (dir)
      await rm(dir, { recursive: true, force: true })
  })

  it('recovers all stream ends from a terminal fragment and rejects a truncated span', async () => {
    const read = vi.fn(async (start: number, end: number) =>
      bytes.subarray(start, end),
    )
    const measure = vi.fn((fragment: Uint8Array) =>
      probePacketEnds(fragment, signal),
    )
    const result = await readMatroskaCues(read, bytes.length, {
      maxBytes: 768 * 1024,
      measure,
    })
    expect(result?.playbackIndex?.length).toBeGreaterThan(2)
    expect(
      read.mock.calls.some(
        ([start, end]) => start > 256 * 1024 && end === bytes.length,
      ),
    ).toBe(true)
    expect(measure).toHaveBeenCalledOnce()
    expect(measure.mock.calls[0]![0].length).toBeLessThan(bytes.length)
    const full = packets(path)
    for (const index of [0, 1, 2]) {
      expect(result?.packetEnds?.get(index)).toBeCloseTo(
        packetEnd(full, index),
        4,
      )
    }

    const truncated = bytes.subarray(0, bytes.length - 1)
    measure.mockClear()
    expect(
      (
        await readMatroskaCues(
          async (a, b) => truncated.subarray(a, b),
          bytes.length,
          {
            maxBytes: 768 * 1024,
            measure,
          },
        )
      )?.packetEnds,
    ).toBeUndefined()
    expect(measure).not.toHaveBeenCalled()

    expect(
      (
        await readMatroskaCues(read, bytes.length, {
          maxBytes: 1024,
          measure,
        })
      )?.packetEnds,
    ).toBeUndefined()
    expect(measure).not.toHaveBeenCalled()
  })

  it('uses complete small files without Cues and rejects a stale library identity', async () => {
    const local = join(dir, 'no-cues.mkv')
    const whole = await makeFixture(local, false)
    expect(whole.length).toBeLessThan(256 * 1024)
    const read = vi.fn(async (start: number, end: number) =>
      whole.subarray(start, end),
    )
    const result = await readMatroskaCues(read, whole.length, {
      maxBytes: 768 * 1024,
      measure: fragment => probePacketEnds(fragment, signal),
    })
    expect(result?.times).toEqual([])
    const full = packets(local)
    for (const index of [0, 1, 2]) {
      expect(result?.packetEnds?.get(index)).toBeCloseTo(
        packetEnd(full, index),
        4,
      )
    }
    expect(read).toHaveBeenCalledOnce()

    const id = 'revision'
    const key = libraryProbeKey(id, await stat(local))
    const source = { id, path: local, size: whole.length }
    expect(
      (await loadLibraryCues(source, key, signal, true))?.packetEnds,
    ).toEqual(result?.packetEnds)
    const replacement = join(dir, 'replacement.mkv')
    await writeFile(replacement, whole)
    await rename(replacement, local)
    expect(await loadLibraryCues(source, key, signal, true)).toBeNull()
  })

  it('normalizes the WebM end for HLS and preserves direct playback', async () => {
    const local = join(dir, 'tagless.webm')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-f',
      'lavfi',
      '-i',
      'color=s=96x54:r=12:d=6',
      '-c:v',
      'libvpx',
      '-g',
      '24',
      '-output_ts_offset',
      '100',
      local,
    ])
    const raw = await readFile(local)
    const tag = raw.indexOf('DURATION')
    expect(tag).toBeGreaterThan(-1)
    raw[tag] = 'X'.charCodeAt(0)
    await writeFile(local, raw)
    const options = {
      subject: 'owner',
      library: { id: 'webm-timing', path: local, size: raw.length },
      fileIndex: 0,
      fileName: 'tagless.webm',
      preference: {},
      log,
    }
    const direct = createSession({
      ...options,
      device: { ...device, containers: ['webm'], video: ['vp8'] },
    })
    const hls = createSession({ ...options, device })
    try {
      await Promise.all([direct.ready, hls.ready])
      expect(direct.decision.mode).toBe('direct')
      expect(direct.media).toMatchObject({
        container: 'webm',
        startTime: 100,
        duration: 106,
      })
      expect(hls.media?.video?.duration).toBeUndefined()
      expect(hls.decision.mode).toBe('hls')
      expect(hls.hls?.duration).toBeCloseTo(6, 2)
    }
    finally {
      await Promise.all([stopSession(hls.id), stopSession(direct.id)])
    }
  }, 20_000)

  it('uses the current FFmpeg end tag after remux even when the old statistics writer survives', () => {
    const marked = join(dir, 'old-marker.mkv')
    const remuxed = join(dir, 'remuxed.mkv')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      path,
      '-map',
      '0:v:0',
      '-c',
      'copy',
      '-metadata:s:v:0',
      '_STATISTICS_WRITING_APP=mkvmerge v90',
      marked,
    ])
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-i',
      marked,
      '-c',
      'copy',
      '-output_ts_offset',
      '100',
      remuxed,
    ])
    const output = JSON.parse(
      execFileSync(
        'ffprobe',
        [
          '-v',
          'error',
          '-show_format',
          '-show_streams',
          '-of',
          'json',
          remuxed,
        ],
        { encoding: 'utf8' },
      ),
    )
    expect(output.format.tags.ENCODER).toMatch(/^Lavf/)
    expect(output.streams[0].tags).toMatchObject({
      _STATISTICS_WRITING_APP: 'mkvmerge v90',
    })
    const media = parseProbe(output, remuxed)
    expect(media.startTime).toBeCloseTo(100, 1)
    const end = packetEnd(packets(remuxed), 0) - media.startTime!
    expect(hlsTiming(media, null).videoEnd).toBeCloseTo(end, 2)
  })

  it('creates HLS from a verified small tagless torrent already being read for its index', async () => {
    const local = join(dir, 'overlap-no-cues.mkv')
    const whole = await makeFixture(local, false)
    const media = parseProbe(
      JSON.parse(
        execFileSync(
          'ffprobe',
          [
            '-v',
            'error',
            '-show_format',
            '-show_streams',
            '-of',
            'json',
            local,
          ],
          { encoding: 'utf8' },
        ),
      ),
      local,
    )
    const torrent = {
      id: 'overlap-small',
      infoHash: 'a'.repeat(40),
      files: [
        { path: 'overlap-no-cues.mkv', size: whole.length, padding: false },
      ],
      pieceLength: whole.length,
    } as Torrent
    const probeMedia = vi.spyOn(probe, 'probeMedia').mockResolvedValue(media)
    const load = vi.spyOn(cueCache, 'loadTorrentCues')
    const range = vi.fn()
    let respond!: (response: Response) => void
    const blocked = new Promise<Response>((resolve) => {
      respond = resolve
    })
    setEngineReady('http://127.0.0.1:1')
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith('/stats'))
          return Response.json({ ...liveStats, pieces: '1' })
        range(options.headers)
        return blocked
      }),
    )
    const direct = new AbortController()
    const index = cueCache.loadTorrentCues(torrent, 0, direct.signal)

    function complete() {
      respond(
        new Response(whole, {
          status: 206,
          headers: {
            'content-range': `bytes 0-${whole.length - 1}/${whole.length}`,
          },
        }),
      )
    }

    let hls: ReturnType<typeof createSession> | undefined
    try {
      await vi.waitFor(() => expect(range).toHaveBeenCalledOnce())
      hls = createSession({
        subject: 'owner',
        torrent,
        fileIndex: 0,
        fileName: 'overlap-no-cues.mkv',
        device,
        audioStream: 1,
        preference: {},
        log,
      })
      await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2))
      complete()
      await Promise.all([index, hls.ready])
      const end
        = Math.max(packetEnd(packets(local), 0), packetEnd(packets(local), 1))
          - media.startTime!
      expect(hls.decision.mode).toBe('hls')
      expect(hls.hls?.duration).toBeCloseTo(end, 4)
      expect(range).toHaveBeenCalledExactlyOnceWith({
        Range: `bytes=0-${whole.length - 1}`,
      })
    }
    finally {
      complete()
      direct.abort()
      if (hls)
        await stopSession(hls.id)
      await index
      vi.unstubAllGlobals()
      load.mockRestore()
      probeMedia.mockRestore()
      setEngineDown('stopped')
    }
  })

  it('stops the packet probe on abort', async () => {
    const controller = new AbortController()
    const probe = probePacketEnds(bytes, controller.signal)
    controller.abort()
    expect(await probe).toBeNull()
  })

  it('uses DurationUnknown when a truncated tagless file cannot prove its end', async () => {
    const truncated = bytes.subarray(0, bytes.length - 1)
    const local = join(dir, 'truncated.mkv')
    await writeFile(local, truncated)
    const session = createSession({
      subject: 'owner',
      library: { id: 'truncated-timing', path: local, size: truncated.length },
      fileIndex: 0,
      fileName: 'truncated.mkv',
      device,
      audioStream: 1,
      preference: {},
      log,
    })
    try {
      await session.ready
      expect(session.media?.duration).toBeGreaterThan(109)
      expect(session.decision.mode).toBe('direct')
      expect(session.decision.reasons).toContain('DurationUnknown')
      expect(session.hls).toBeNull()
    }
    finally {
      await stopSession(session.id)
    }
  })

  it.each([1, 2])(
    'serves a playable last segment with selected audio %i at a nonzero origin',
    async (audioStream) => {
      const session = createSession({
        subject: 'owner',
        library: { id: 'indexed-timing', path, size: bytes.length },
        fileIndex: 0,
        fileName: 'indexed.mkv',
        device,
        audioStream,
        preference: {},
        log,
      })
      try {
        await session.ready
        expect(session.media?.startTime).toBeCloseTo(100, 1)
        expect(session.media?.duration).toBeGreaterThan(109)
        expect(session.media?.video?.videoDelay).toBe(2)
        expect(session.media?.video?.duration).toBeUndefined()
        expect(
          session.media?.audio.every(audio => audio.duration === undefined),
        ).toBe(true)
        expect(hlsTiming(session.media!, audioStream).duration).toBeNull()
        expect(session.decision).toMatchObject({ mode: 'hls', video: 'copy' })
        const hls = session.hls!
        expect(hls.segmentCount).toBe(2)
        const full = packets(path)
        const expected
          = Math.max(packetEnd(full, 0), packetEnd(full, audioStream))
            - session.media!.startTime!
        expect(hls.duration).toBeCloseTo(expected, 4)
        expect(hls.duration).toBeCloseTo(audioStream === 1 ? 6 : 9, 1)
        const manifest = buildPlaylist(
          hls.starts,
          hls.duration,
          index => `${index}.ts`,
        )
        const extinf = [...manifest.matchAll(/#EXTINF:([\d.]+)/g)].map(
          match => Number(match[1]),
        )
        expect(extinf.reduce((a, b) => a + b, 0)).toBeCloseTo(hls.duration, 3)
        expect(extinf[1]).toBeCloseTo(hls.duration - hls.starts[1]!, 3)
        const last = hls.segmentCount - 1
        const output = await hls.segment(last)
        await output.close()
        const contents = packets(join(hls.dir, `${last}.ts`))
        const video = contents.filter(packet => packet.stream_index === 0)
        const audio = contents.filter(packet => packet.stream_index === 1)
        expect(video.length).toBeGreaterThan(0)
        expect(audio.length).toBeGreaterThan(0)
        expect(
          Math.min(...video.map(packet => Number(packet.pts_time)))
          - TS_OFFSET_SECONDS,
        ).toBeCloseTo(hls.starts[last]!, 2)
        // MPEG-TS AAC retains the final complete access unit after Matroska's discard padding.
        const audioEnd = packetEnd(contents, 1) - TS_OFFSET_SECONDS
        expect(Math.abs(audioEnd - hls.duration)).toBeLessThan(0.025)
        await expect(hls.segment(last + 1)).rejects.toThrow(RangeError)
      }
      finally {
        await stopSession(session.id)
      }
    },
    20_000,
  )
})
