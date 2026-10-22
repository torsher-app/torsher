import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildPlaylist,
  HlsTranscode,
  seekTargetOf,
  segmentStarts,
  TranscodeFailedError,
  TS_OFFSET_SECONDS,
} from './hls.ts'
import { readCueTimes } from './matroska.ts'

describe('segmentStarts', () => {
  it('режет на первой точке перемотки не раньше k × 6 с', () => {
    const cues = [0, 4.7, 9.4, 11.1, 15.8, 20.5, 22.2, 26.9, 31.6]

    expect(segmentStarts(33, cues)).toEqual([0, 9.4, 15.8, 20.5, 26.9, 31.6])
  })

  it('длинный промежуток между точками — один сегмент', () => {
    expect(segmentStarts(40, [0, 25, 31])).toEqual([0, 25, 31])
  })

  it('без точек — равные сегменты', () => {
    expect(segmentStarts(20, null)).toEqual([0, 6, 12, 18])
  })
})

describe('buildPlaylist', () => {
  it('vOD с длинами сегментов и адресами', () => {
    const playlist = buildPlaylist(
      [0, 9.4, 15.8],
      20,
      i => `${i}.ts?token=t`,
    )

    expect(playlist).toBe(
      [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        '#EXT-X-PLAYLIST-TYPE:VOD',
        '#EXT-X-TARGETDURATION:10',
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXTINF:9.400000,',
        '0.ts?token=t',
        '#EXTINF:6.400000,',
        '1.ts?token=t',
        '#EXTINF:4.200000,',
        '2.ts?token=t',
        '#EXT-X-ENDLIST',
        '',
      ].join('\n'),
    )
  })
})

describe('seekTargetOf', () => {
  it('чуть позже начала сегмента, но до следующего', () => {
    expect(seekTargetOf([0, 9.4, 15.8], 0)).toBe(0)
    expect(seekTargetOf([0, 9.4, 15.8], 1)).toBeCloseTo(9.9)
    expect(seekTargetOf([0, 9.4, 9.6], 1)).toBeCloseTo(9.5)
  })
})

function hasFfmpeg() {
  // В `.env.test` ffmpeg нет нарочно: здесь нужен настоящий
  vi.stubEnv('FFMPEG_PATH', 'ffmpeg')
  vi.stubEnv('FFPROBE_PATH', 'ffprobe')

  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

function packetTimes(path: string, stream: string) {
  return execFileSync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    stream,
    '-show_entries',
    'packet=pts_time',
    '-of',
    'csv=p=0',
    path,
  ])
    .toString()
    .split('\n')
    .map(line => Number.parseFloat(line))
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
}

// Настоящий ffmpeg: синтетический MKV с неровными ключевыми кадрами,
// AC3 5.1 и встроенными SRT-субтитрами
describe.runIf(hasFfmpeg())('hlsTranscode на ffmpeg', () => {
  let dir = ''
  let file = ''
  let bytes = Buffer.alloc(0)

  // Файл собирается в хуке: тело пропущенного `describe` vitest тоже выполняет
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'torsher-hls-'))
    file = join(dir, 'input.mkv')

    let srt = ''

    for (let i = 0; i < 20; i++) {
      const at = (s: number) =>
        `00:00:${String(Math.floor(s)).padStart(2, '0')},${String(Math.round((s % 1) * 1000)).padStart(3, '0')}`

      srt += `${i + 1}\n${at(i * 2 + 0.2)} --> ${at(i * 2 + 1.5)}\nРеплика ${i + 1}\n\n`
    }

    writeFileSync(join(dir, 'subs.srt'), srt)
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
      '-i',
      join(dir, 'subs.srt'),
      '-t',
      '40',
      '-map',
      '0:v',
      '-map',
      '1:a',
      '-map',
      '2',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-pix_fmt',
      'yuv420p',
      '-bf',
      '2',
      '-g',
      '400',
      '-sc_threshold',
      '0',
      '-force_key_frames',
      'expr:gte(t,n_forced*3.7+mod(n_forced,3))',
      '-c:a',
      'ac3',
      '-ac',
      '6',
      '-c:s',
      'srt',
      file,
    ])
    bytes = readFileSync(file)
  })

  const transcodes: HlsTranscode[] = []

  afterAll(async () => {
    await Promise.all(transcodes.map(job => job.stop()))
    rmSync(dir, { recursive: true, force: true })
  })

  async function job(url = file) {
    const cues = await readCueTimes(async (start, end) =>
      bytes.subarray(start, Math.min(end, bytes.length)),
    )
    const starts = segmentStarts(40, cues)
    const transcode = new HlsTranscode(
      join(dir, `out-${transcodes.length}`),
      {
        url,
        videoStream: 0,
        audioStream: 1,
        audio: 'aac',
        subtitleStreams: [2],
        starts,
        duration: 40,
      },
      { info: () => {}, warn: () => {} },
    )

    transcodes.push(transcode)
    return { transcode, starts }
  }

  it('сегменты подряд и после перезапуска совпадают с плейлистом', async () => {
    const { transcode, starts } = await job()
    const last = starts.length - 1

    expect(starts.length).toBeGreaterThan(4)

    const offsets: number[] = []

    for (const index of [0, 1, last, 2]) {
      const path = await transcode.segment(index)
      const video = packetTimes(path, 'v')
      const end = starts[index + 1] ?? 40
      // Метки сегментов сдвинуты на общий сдвиг — одинаково у всех запусков
      const offset = video[0]! - starts[index]!

      offsets.push(offset)
      expect(offset).toBeCloseTo(TS_OFFSET_SECONDS, 1)
      expect(video.at(-1)!).toBeLessThan(end + offset)
    }

    expect(Math.max(...offsets) - Math.min(...offsets)).toBeLessThan(0.01)
  }, 60_000)

  it('на месте данных нули — ошибка, а не пустой сегмент', async () => {
    // Так выглядит недокачанный кусок, который движок считает готовым
    const broken = Buffer.from(bytes)
    const zeros = join(dir, 'zeros.mkv')

    broken.fill(
      0,
      Math.floor(bytes.length * 0.3),
      Math.floor(bytes.length * 0.95),
    )
    writeFileSync(zeros, broken)

    const { transcode, starts } = await job(zeros)

    await expect(
      transcode.segment(Math.floor(starts.length / 2)),
    ).rejects.toBeInstanceOf(TranscodeFailedError)
  }, 60_000)

  it('встроенные субтитры копятся тем же процессом', async () => {
    const { transcode, starts } = await job()

    await transcode.segment(starts.length - 1)
    const cues = await transcode.cues(2)
    const tail = cues.filter(cue => cue.start >= starts.at(-1)! - 1)

    expect(tail.length).toBeGreaterThan(0)
    expect(tail[0]!.text).toMatch(/^Реплика \d+$/)
  }, 60_000)
})
