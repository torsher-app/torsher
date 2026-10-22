import { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  buildPlaylist,
  HlsTranscode,
  secondsAhead,
  seekTargetOf,
  segmentStarts,
  SegmentTimeoutError,
  TranscodeFailedError,
  TS_OFFSET_SECONDS,
} from './hls.ts'
import { EngineError } from '../engine/client.ts'
import { readCueTimes } from './matroska.ts'

describe('segmentStarts', () => {
  it('первый разрез — не раньше 2 с, дальше не раньше 2 + k × 6 с', () => {
    const cues = [0, 1.2, 4.7, 9.4, 11.1, 15.8, 20.5, 22.2, 26.9, 31.6]

    expect(segmentStarts(33, cues)).toEqual([0, 4.7, 9.4, 15.8, 20.5, 26.9])
  })

  it('частые точки — первый сегмент около 2 с', () => {
    const cues = Array.from({ length: 20 }, (_, i) => i * 1.001)

    expect(segmentStarts(20, cues).slice(0, 3)).toEqual([0, 2.002, 8.008])
  })

  it('длинный промежуток между точками — один сегмент', () => {
    expect(segmentStarts(40, [0, 25, 31])).toEqual([0, 25, 31])
  })

  it('без точек — равные сегменты', () => {
    expect(segmentStarts(20, null)).toEqual([0, 2, 8, 14])
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

describe('secondsAhead', () => {
  const starts = [0, 2, 8, 14, 20]

  it('от начала запрошенного сегмента до конца записанного', () => {
    expect(secondsAhead(starts, 24, 3, 1)).toBe(18)
    expect(secondsAhead(starts, 24, 4, 1)).toBe(22)
  })

  it('ничего не запрошено или плеер впереди записанного — ноль', () => {
    expect(secondsAhead(starts, 24, 3, -1)).toBe(0)
    expect(secondsAhead(starts, 24, 1, 3)).toBe(0)
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
        url: () => url,
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

  // Ключевой кадр каждую секунду: разрезы по 1 с совпадают с ними
  function steadyMkv() {
    const steady = join(dir, 'steady.mkv')

    if (!existsSync(steady)) {
      execFileSync('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=160x90:rate=24',
        '-t',
        '40',
        '-c:v',
        'libx264',
        '-preset',
        'ultrafast',
        '-pix_fmt',
        'yuv420p',
        '-bf',
        '0',
        '-g',
        '24',
        '-keyint_min',
        '24',
        '-sc_threshold',
        '0',
        steady,
      ])
    }

    return readFileSync(steady)
  }

  // ffprobe и проверкам нужен путь, а сегмент отдаётся открытым файлом
  async function segmentPath(
    transcode: HlsTranscode,
    index: number,
    signal?: AbortSignal,
  ) {
    const file = await transcode.segment(index, signal)

    await file.close()
    return join(transcode.dir, `${index}.ts`)
  }

  it('сегменты подряд и после перезапуска совпадают с плейлистом', async () => {
    const { transcode, starts } = await job()
    const last = starts.length - 1

    expect(starts.length).toBeGreaterThan(4)

    const offsets: number[] = []

    for (const index of [0, 1, last, 2]) {
      const path = await segmentPath(transcode, index)
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

    await segmentPath(transcode, starts.length - 1)
    const cues = await transcode.cues(2)
    const tail = cues.filter(cue => cue.start >= starts.at(-1)! - 1)

    expect(tail.length).toBeGreaterThan(0)
    expect(tail[0]!.text).toMatch(/^Реплика \d+$/)
  }, 60_000)
  function listOf(transcode: HlsTranscode, runId: number) {
    const path = join(transcode.dir, `list-${runId}.csv`)

    return existsSync(path)
      ? readFileSync(path, 'utf8')
          .split('\n')
          .map(line => Number.parseInt(line, 10))
          .filter(Number.isInteger)
      : []
  }

  it('остановка во время старта не запускает ffmpeg', async () => {
    const info = vi.fn()
    const transcode = new HlsTranscode(
      join(dir, 'out-stopped'),
      {
        url: () => file,
        videoStream: 0,
        audioStream: 1,
        audio: 'aac',
        subtitleStreams: [],
        starts: segmentStarts(40, null),
        duration: 40,
      },
      { info, warn: () => {} },
    )

    transcodes.push(transcode)

    const pending = transcode.segment(0).catch(() => {})

    await transcode.stop()
    await pending

    expect(info).not.toHaveBeenCalledWith(
      expect.stringContaining('ffmpeg run'),
    )
    expect(existsSync(transcode.dir)).toBe(false)
  })

  it('перемотка назад не отдаёт сегмент прошлого запуска', async () => {
    const { transcode, starts } = await job()
    const far = Math.min(6, starts.length - 1)
    const back = far - 3

    await segmentPath(transcode, far)
    await segmentPath(transcode, back)

    // Сегменты с места перемотки — только из списка нового запуска: старые
    // файлы новый ffmpeg перезапишет
    const current = listOf(transcode, 2)

    for (const index of transcode.readySegments()) {
      if (index >= back)
        expect(current).toContain(index)
    }

    const path = await segmentPath(transcode, far)

    expect(listOf(transcode, 2)).toContain(far)
    expect(statSync(path).size % 188).toBe(0)
  }, 60_000)

  it('сегмент, удалённый как старый, перезапускает ffmpeg', async () => {
    const body = steadyMkv()
    const stallAt = Math.floor(body.length * 0.9)
    let stalled = false
    // Первое чтение подряд через границу встаёт на ней: первый запуск жив и
    // ждёт данных. Дальше файл отдаётся целиком: следующий запуск идёт к
    // `Cues` в конце файла и, если это ближе окна TCP, не переподключается, а
    // дочитывает тот же ответ — встань он, ffmpeg ждал бы до `-rw_timeout`
    const server = createServer((request, response) => {
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

      if (!stalled && start < stallAt && end >= stallAt) {
        stalled = true
        response.write(body.subarray(start, stallAt))
        return
      }

      response.end(body.subarray(start, end + 1))
    })

    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', resolve),
    )

    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/steady.mkv`
    const runs: string[] = []
    const transcode = new HlsTranscode(
      join(dir, 'out-dropped'),
      {
        url: () => url,
        videoStream: 0,
        audioStream: null,
        audio: 'aac',
        subtitleStreams: [],
        starts: segmentStarts(40, null, 1),
        duration: 40,
      },
      {
        info: message => runs.push(message),
        warn: () => {},
      },
    )

    transcodes.push(transcode)

    try {
      for (const index of [0, 4, 8, 12, 16, 20, 24, 28, 30])
        await segmentPath(transcode, index)

      // Старые сегменты удалены к ответу, а не когда-нибудь после
      expect(existsSync(join(transcode.dir, '8.ts'))).toBe(false)

      // Один запуск с начала прошёл сегмент 2: иначе его перезапустило бы и
      // прежнее условие — запрос позади начала запуска
      expect(runs).toEqual(['hls: ffmpeg run 1 from segment 0'])

      await vi.waitFor(() =>
        expect(transcode.readySegments()).not.toContain(2),
      )

      // Без перезапуска ответ пришёл бы только по таймауту ожидания в 60 с:
      // ждём вдвое меньше и проверяем, был ли перезапуск
      const path = await segmentPath(
        transcode,
        2,
        AbortSignal.timeout(30_000),
      ).catch((err: unknown) => err)

      expect(runs).toEqual([
        'hls: ffmpeg run 1 from segment 0',
        'hls: ffmpeg run 2 from segment 2',
      ])
      expect(path).toBeTypeOf('string')
      expect(statSync(path as string).size).toBeGreaterThan(0)
    }
    finally {
      await transcode.stop()
      server.closeAllConnections()
      server.close()
    }
  }, 60_000)

  it('ffmpeg без сегмента к дедлайну убит, следующий запрос запускает новый', async () => {
    const body = steadyMkv()
    const stallAt = Math.floor(body.length * 0.3)
    let stalling = true
    // Зависший движок: отдаёт начало файла и держит соединение без байтов
    const server = createServer((request, response) => {
      const range = /bytes=(\d+)-/.exec(request.headers.range ?? '')
      const start = range ? Number(range[1]) : 0

      response.statusCode = range ? 206 : 200
      response.setHeader('Accept-Ranges', 'bytes')
      response.setHeader('Content-Length', body.length - start)

      if (range) {
        response.setHeader(
          'Content-Range',
          `bytes ${start}-${body.length - 1}/${body.length}`,
        )
      }

      if (stalling) {
        response.write(body.subarray(start, Math.max(start, stallAt)))
        return
      }

      response.end(body.subarray(start))
    })

    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', resolve),
    )

    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/steady.mkv`
    const runs: string[] = []
    const warn = vi.fn()
    const transcode = new HlsTranscode(
      join(dir, 'out-stalled'),
      {
        url: () => url,
        videoStream: 0,
        audioStream: null,
        audio: 'aac',
        subtitleStreams: [],
        starts: segmentStarts(40, null, 1),
        duration: 40,
        segmentWaitMs: 3000,
      },
      { info: message => runs.push(message), warn },
    )

    transcodes.push(transcode)

    try {
      await expect(transcode.segment(20)).rejects.toBeInstanceOf(
        SegmentTimeoutError,
      )
      expect(warn).toHaveBeenCalledWith(
        'hls: ffmpeg run 1 stalled before segment 20, killed',
      )

      stalling = false

      const path = await segmentPath(transcode, 20)

      expect(runs).toEqual([
        'hls: ffmpeg run 1 from segment 20',
        'hls: ffmpeg run 2 from segment 20',
      ])
      expect(statSync(path).size).toBeGreaterThan(0)
    }
    finally {
      await transcode.stop()
      server.closeAllConnections()
      server.close()
    }
  }, 60_000)

  it('движок недоступен на перезапуске — готовые сегменты остаются', async () => {
    let engineDown = false
    const starts = segmentStarts(40, null)
    const transcode = new HlsTranscode(
      join(dir, 'out-engine-down'),
      {
        url: () => {
          if (engineDown) {
            throw new EngineError(
              'unavailable',
              'Torrent engine is not running',
            )
          }
          return file
        },
        videoStream: 0,
        audioStream: 1,
        audio: 'aac',
        subtitleStreams: [],
        starts,
        duration: 40,
      },
      { info: () => {}, warn: () => {} },
    )

    transcodes.push(transcode)

    const far = Math.min(6, starts.length - 1)

    await segmentPath(transcode, far)
    engineDown = true

    // Временная недоступность движка — не провал перепаковки: клиент повторит
    await expect(transcode.segment(far - 3)).rejects.toBeInstanceOf(
      EngineError,
    )
    expect(transcode.readySegments()).toContain(far)
    expect(existsSync(join(transcode.dir, `${far}.ts`))).toBe(true)
  }, 60_000)

  it('перезапуск берёт актуальный адрес потока', async () => {
    let url = join(dir, 'missing.mkv')
    const transcode = new HlsTranscode(
      join(dir, 'out-url'),
      {
        url: () => url,
        videoStream: 0,
        audioStream: 1,
        audio: 'aac',
        subtitleStreams: [],
        starts: segmentStarts(40, null),
        duration: 40,
      },
      { info: () => {}, warn: () => {} },
    )

    transcodes.push(transcode)

    await expect(transcode.segment(0)).rejects.toBeInstanceOf(
      TranscodeFailedError,
    )

    url = file

    const path = await segmentPath(transcode, 0)

    expect(statSync(path).size).toBeGreaterThan(0)
  }, 60_000)

  it('ушёл вперёд от плеера — ffmpeg на паузе, плеер догнал — продолжает', async () => {
    const body = steadyMkv()
    const chunk = Math.ceil(body.length / 200)
    // Вход приходит медленно, как из торрента: без паузы ffmpeg дописал бы
    // все 40 сегментов за пару секунд
    const server = createServer((request, response) => {
      const range = /bytes=(\d+)-/.exec(request.headers.range ?? '')
      const start = range ? Number(range[1]) : 0

      response.statusCode = range ? 206 : 200
      response.setHeader('Accept-Ranges', 'bytes')
      response.setHeader('Content-Length', body.length - start)

      if (range) {
        response.setHeader(
          'Content-Range',
          `bytes ${start}-${body.length - 1}/${body.length}`,
        )
      }

      let offset = start
      const timer = setInterval(() => {
        if (offset >= body.length) {
          clearInterval(timer)
          response.end()
          return
        }

        response.write(body.subarray(offset, offset + chunk))
        offset += chunk
      }, 15)

      response.on('close', () => clearInterval(timer))
    })

    await new Promise<void>(resolve =>
      server.listen(0, '127.0.0.1', resolve),
    )

    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/steady.mkv`
    const transcode = new HlsTranscode(
      join(dir, 'out-throttled'),
      {
        url: () => url,
        videoStream: 0,
        audioStream: null,
        audio: 'aac',
        subtitleStreams: [],
        starts: segmentStarts(40, null, 1),
        duration: 40,
        ahead: { seconds: 5, checkMs: 50 },
      },
      { info: () => {}, warn: () => {} },
    )

    transcodes.push(transcode)

    try {
      await segmentPath(transcode, 0)

      // Встал на запасе: дальше нескольких сегментов за запасом не пишет
      await vi.waitFor(
        () => expect(transcode.readySegments().length).toBeGreaterThan(4),
        { timeout: 10_000 },
      )
      await new Promise(resolve => setTimeout(resolve, 1500))

      const held = Math.max(...transcode.readySegments())

      expect(held).toBeLessThan(12)

      // Плеер запросил следующий сегмент за записанным — ffmpeg продолжает
      // тот же запуск, а не начинает заново
      const path = await segmentPath(
        transcode,
        held + 1,
        AbortSignal.timeout(20_000),
      )

      expect(statSync(path).size).toBeGreaterThan(0)
    }
    finally {
      await transcode.stop()
      server.closeAllConnections()
      server.close()
    }
  }, 60_000)
})
