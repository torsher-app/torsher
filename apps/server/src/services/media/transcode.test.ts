import type { EncoderCaps } from './encode.ts'
import type { HlsLog } from './hls.ts'
import type { VideoStreamInfo } from './probe.ts'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { planEncode } from './encode.ts'
import { HlsTranscode, segmentStarts, TS_OFFSET_SECONDS } from './hls.ts'

function hasFfmpeg() {
  // В `.env.test` ffmpeg нет нарочно: здесь нужен настоящий
  vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
  vi.stubEnv('FFPROBE_PATH', 'ffprobe')

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return !!execFileSync('ffmpeg', ['-hide_banner', '-encoders'])
      .toString()
      .includes('libx264')
  }
  catch {
    return false
  }
}

function probe(path: string, args: string[]) {
  return execFileSync('ffprobe', ['-v', 'error', ...args, path]).toString()
}

/** Поля потока: MPEG-TS повторяет поток в описании программы — берём первый */
function streamOf(path: string, stream: string, fields: string) {
  return probe(path, [
    '-select_streams',
    stream,
    '-show_entries',
    `stream=${fields}`,
    '-of',
    'csv=p=0',
  ])
    .split('\n')
    .find(Boolean)
}

/** Метки пакетов потока: время и ключевой ли кадр */
function packets(path: string, stream: string) {
  return probe(path, [
    '-select_streams',
    stream,
    '-show_entries',
    'packet=pts_time,flags',
    '-of',
    'csv=p=0',
  ])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [time, flags] = line.split(',')

      return { time: Number(time), key: flags?.startsWith('K') ?? false }
    })
    .filter(packet => Number.isFinite(packet.time))
    .sort((a, b) => a.time - b.time)
}

const software: EncoderCaps = {
  encoder: 'software',
  device: null,
  lowPower: false,
  decode: [],
  maxHeight: 720,
  toneMapping: 'software',
  toneMappingMaxHeight: 720,
}

const DURATION = 40

const xvid: VideoStreamInfo = {
  index: 0,
  codec: 'mpeg4',
  profile: 'Advanced Simple Profile',
  width: 320,
  height: 180,
  highBitDepth: false,
  hdr: false,
  frameRate: 25,
  interlaced: false,
  bitrate: 800_000,
  pixelAspect: 1,
}

// Настоящий ffmpeg: Xvid в AVI с B-кадрами и AC3, как старые рипы
describe.runIf(hasFfmpeg())('перекодирование на ffmpeg', () => {
  let dir = ''
  let avi = ''
  const transcodes: HlsTranscode[] = []

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'torsher-encode-'))
    avi = join(dir, 'input.avi')
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000',
      '-t',
      String(DURATION),
      '-c:v',
      'mpeg4',
      '-vtag',
      'XVID',
      '-bf',
      '2',
      '-g',
      '250',
      '-q:v',
      '5',
      '-c:a',
      'ac3',
      '-ac',
      '2',
      avi,
    ])
  })

  afterAll(async () => {
    await Promise.all(transcodes.map(job => job.stop()))
    rmSync(dir, { recursive: true, force: true })
  })

  function job(
    options: {
      caps?: EncoderCaps
      video?: VideoStreamInfo
      audio?: 'copy' | 'aac'
      url?: string
      warn?: HlsLog['warn']
    } = {},
  ) {
    const video = options.video ?? xvid
    const caps = options.caps ?? software
    const starts = segmentStarts(DURATION, null)
    const transcode = new HlsTranscode(
      join(dir, `out-${transcodes.length}`),
      {
        url: () => options.url ?? avi,
        videoStream: 0,
        audioStream: 1,
        audio: options.audio ?? 'aac',
        subtitleStreams: [],
        starts,
        duration: DURATION,
        encode: planEncode(
          video,
          caps,
          null,
          caps.encoder === 'software' ? null : software,
        ),
      },
      { debug: () => {}, warn: options.warn ?? (() => {}) },
    )

    transcodes.push(transcode)
    return { transcode, starts }
  }

  async function segmentPath(transcode: HlsTranscode, index: number) {
    const file = await transcode.segment(index)

    await file.close()
    return join(transcode.dir, `${index}.ts`)
  }

  it('каждый сегмент — H.264 с ключевого кадра ровно на своей границе', async () => {
    const { transcode, starts } = job()

    // Подряд, перемотка вперёд и назад: каждый раз — новый запуск ffmpeg
    for (const index of [0, 1, 2, 5, 3]) {
      const path = await segmentPath(transcode, index)
      const video = packets(path, 'v')
      const start = starts[index]! + TS_OFFSET_SECONDS
      const end = (starts[index + 1] ?? DURATION) + TS_OFFSET_SECONDS

      expect(streamOf(path, 'v', 'codec_name')).toBe('h264')
      expect(video[0]!.key).toBe(true)
      // Первый кадр файла — на кадр-другой позже нуля
      expect(video[0]!.time).toBeGreaterThanOrEqual(start - 0.001)
      expect(video[0]!.time).toBeLessThan(start + 0.1)
      expect(video.at(-1)!.time).toBeLessThan(end)
      expect(video.filter(packet => packet.key)).toHaveLength(1)
    }
  }, 60_000)

  it('звук копией после перемотки начинается с точки перемотки', async () => {
    const { transcode, starts } = job({ audio: 'copy' })
    const path = await segmentPath(transcode, 4)
    const audio = packets(path, 'a')

    expect(audio[0]!.time).toBeGreaterThanOrEqual(
      starts[4]! + TS_OFFSET_SECONDS - 0.05,
    )
    expect(streamOf(path, 'a', 'codec_name')).toBe('ac3')
  }, 60_000)

  it('видеокарта не запустилась — тот же сегмент процессором', async () => {
    const warn = vi.fn()
    const { transcode } = job({
      caps: {
        ...software,
        encoder: 'vaapi',
        device: join(dir, 'missing-render-node'),
        decode: [],
        maxHeight: 1080,
      },
      warn,
    })
    const path = await segmentPath(transcode, 1)

    expect(transcode.encode?.encoder).toBe('software')
    expect(warn).toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(
        /^hls: transcoding with vaapi.* failed, retrying with software/,
      ),
    )
    expect(packets(path, 'v')[0]!.key).toBe(true)
  }, 60_000)

  it('hDR в SDR процессором', async () => {
    const hdr = join(dir, 'hdr.mkv')

    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=640x360:rate=25',
      '-f',
      'lavfi',
      '-i',
      'sine=f=440:r=48000',
      '-t',
      '6',
      '-vf',
      'format=yuv420p10le,setparams=color_primaries=bt2020:color_trc=smpte2084:colorspace=bt2020nc',
      '-c:v',
      'libx265',
      '-x265-params',
      'log-level=error',
      '-color_primaries',
      'bt2020',
      '-color_trc',
      'smpte2084',
      '-colorspace',
      'bt2020nc',
      '-c:a',
      'aac',
      hdr,
    ])

    const { transcode } = job({
      url: hdr,
      video: {
        ...xvid,
        codec: 'hevc',
        width: 640,
        height: 360,
        highBitDepth: true,
        hdr: true,
      },
    })
    const path = await segmentPath(transcode, 0)
    expect(streamOf(path, 'v', 'codec_name,pix_fmt,color_transfer')).toBe(
      'h264,yuv420p,bt709',
    )
  }, 60_000)
})
