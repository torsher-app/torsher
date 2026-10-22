import type { ChildProcess } from 'node:child_process'
import type { Cue } from './webvtt.ts'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { mergeCues, parseWebVtt } from './webvtt.ts'

/** Желаемая длина сегмента: короче — больше запросов, длиннее — дольше старт */
export const SEGMENT_SECONDS = 6
// Запрос дальше стольких сегментов от того, что пишет ffmpeg, — перемотка:
// ffmpeg перезапускается с нужного места, а не дописывает всё подряд
const MAX_AHEAD_SEGMENTS = Math.floor(24 / SEGMENT_SECONDS)
// Сегменты далеко позади просмотра удаляются: на длинном фильме их гигабайты
const KEEP_BEHIND_SEGMENTS = 20
const SEGMENT_WAIT_MS = 60_000
const POLL_MS = 200
// ffmpeg ждёт куски от пиров; совсем мёртвый поток он бросит сам
const READ_TIMEOUT_US = 120_000_000
// Сдвиг меток в сегментах: с B-кадрами DTS начала файла отрицательный, и
// MPEG-TS сдвинул бы первый запуск иначе, чем запуски с середины. hls.js
// сводит время по первому загруженному сегменту, поэтому общий сдвиг ему
// не мешает
export const TS_OFFSET_SECONDS = 10

/**
 * Начала сегментов. С точками перемотки MKV разрез — на первой точке не
 * раньше `k × длина`; без них — равные куски.
 * Первое начало — 0.
 */
export function segmentStarts(
  duration: number,
  cues: number[] | null,
  length = SEGMENT_SECONDS,
) {
  const starts = [0]

  if (cues && cues.length > 1) {
    let cut = length

    for (const time of cues) {
      if (time >= cut && time < duration) {
        starts.push(time)
        while (cut <= time) cut += length
      }
    }

    return starts
  }

  for (let time = length; time < duration; time += length) starts.push(time)

  return starts
}

/** VOD-плейлист: все сегменты известны заранее, перемотка — любым сегментом */
export function buildPlaylist(
  starts: number[],
  duration: number,
  urlOf: (index: number) => string,
) {
  const lengths = starts.map((start, i) => (starts[i + 1] ?? duration) - start)
  const lines = [
    '#EXTM3U',
    '#EXT-X-VERSION:3',
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${Math.ceil(Math.max(...lengths))}`,
    '#EXT-X-MEDIA-SEQUENCE:0',
  ]

  lengths.forEach((length, i) => {
    lines.push(`#EXTINF:${length.toFixed(6)},`, urlOf(i))
  })
  lines.push('#EXT-X-ENDLIST', '')

  return lines.join('\n')
}

/**
 * Куда ставить `-ss`, чтобы ffmpeg встал ровно на ключевой кадр начала
 * сегмента: с B-кадрами он отступает назад на задержку декодера и без
 * запаса попадает на предыдущую точку перемотки.
 */
export function seekTargetOf(starts: number[], index: number) {
  const start = starts[index] ?? 0

  if (index === 0)
    return 0

  const next = starts[index + 1] ?? start + 1

  return start + Math.min(0.5, (next - start) / 2)
}

export interface HlsInput {
  url: string
  videoStream: number
  audioStream: number | null
  audio: 'copy' | 'aac'
  /** Встроенные текстовые субтитры: пишутся тем же процессом в WebVTT */
  subtitleStreams: number[]
  starts: number[]
  duration: number
}

export interface HlsLog {
  info: (message: string) => void
  warn: (message: string) => void
}

export class SegmentTimeoutError extends Error {
  constructor() {
    super('Segment is not ready')
    this.name = 'SegmentTimeoutError'
  }
}

export class TranscodeFailedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TranscodeFailedError'
  }
}

interface Run {
  id: number
  process: ChildProcess
  from: number
  exited: boolean
  failure?: string
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Перепаковка одного файла в сегменты MPEG-TS. Процесс ffmpeg идёт от
 * запрошенного сегмента вперёд; запрос позади или далеко впереди
 * перезапускает его с нового места. Разрезы абсолютные (границы из
 * плейлиста), поэтому готовые сегменты разных запусков совместимы.
 */
/**
 * Пустой сегмент — не готовый: ffmpeg вносит его в список и тогда, когда входа
 * не прочитал (на месте данных нули). Отдать его — hls.js запросит снова, и так
 * без конца.
 */
function hasData(path: string) {
  return existsSync(path) && statSync(path).size > 0
}

export class HlsTranscode {
  readonly dir: string
  private readonly input: HlsInput
  private readonly log: HlsLog
  private run: Run | null = null
  private runs = 0
  private lastRequested = 0
  private stopped = false
  private queue: Promise<unknown> = Promise.resolve()
  /** Готовые сегменты: номер → есть файл */
  private readonly ready = new Set<number>()

  constructor(dir: string, input: HlsInput, log: HlsLog) {
    this.dir = dir
    this.input = input
    this.log = log
  }

  get segmentCount() {
    return this.input.starts.length
  }

  get starts() {
    return this.input.starts
  }

  /** Путь к готовому сегменту; ждёт ffmpeg или перезапускает его */
  async segment(index: number, signal?: AbortSignal) {
    if (index < 0 || index >= this.segmentCount)
      throw new RangeError('Segment out of range')

    this.lastRequested = index
    await this.serialize(() => this.ensureRunFor(index))

    const deadline = Date.now() + SEGMENT_WAIT_MS

    while (!this.stopped && !signal?.aborted) {
      await this.refreshReady()

      if (this.ready.has(index)) {
        void this.dropOld()
        return this.pathOf(index)
      }

      const run = this.run

      if (run?.exited && !this.ready.has(index)) {
        throw new TranscodeFailedError(
          run.failure ?? 'ffmpeg stopped before the segment',
        )
      }

      if (Date.now() > deadline)
        throw new SegmentTimeoutError()

      await delay(POLL_MS)
    }

    throw new SegmentTimeoutError()
  }

  /** Реплики встроенной дорожки, собранные всеми запусками */
  async cues(stream: number): Promise<Cue[]> {
    const lists: Cue[][] = []

    for (let id = 1; id <= this.runs; id++) {
      const path = join(this.dir, `sub-${stream}-${id}.vtt`)

      if (!existsSync(path))
        continue

      const text = await readFile(path, 'utf8').catch(() => '')
      const finished = this.run?.id !== id || this.run.exited

      lists.push(parseWebVtt(text, finished))
    }

    return mergeCues(lists)
  }

  async stop() {
    this.stopped = true
    this.kill()
    await rm(this.dir, { recursive: true, force: true })
  }

  private serialize<T>(task: () => Promise<T>) {
    const next = this.queue.then(task, task)

    this.queue = next.catch(() => {})
    return next
  }

  private pathOf(index: number) {
    return join(this.dir, `${index}.ts`)
  }

  private async ensureRunFor(index: number) {
    await this.refreshReady()

    if (this.ready.has(index))
      return

    const run = this.run

    if (run && !run.exited && index >= run.from) {
      let head = run.from - 1

      while (this.ready.has(head + 1)) head++

      if (index <= head + 1 + MAX_AHEAD_SEGMENTS)
        return
    }

    await this.start(index)
  }

  private kill() {
    const run = this.run

    if (run && !run.exited)
      run.process.kill('SIGKILL')
  }

  private async start(from: number) {
    this.kill()
    await mkdir(this.dir, { recursive: true })

    // Незаконченный сегмент прерванного запуска не годится
    for (const name of await readdir(this.dir)) {
      const index = Number.parseInt(name, 10)

      if (name.endsWith('.ts') && !this.ready.has(index))
        await rm(join(this.dir, name), { force: true })
    }

    const id = ++this.runs
    const args = this.argsFor(from, id)
    const child = spawn(config.ffmpegPath, args, {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    const run: Run = { id, process: child, from, exited: false }
    let stderr = ''

    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-2000)
    })
    child.on('error', (err) => {
      run.exited = true
      run.failure = err.message
    })
    child.on('exit', (code, signal) => {
      run.exited = true

      if (code !== 0 && signal !== 'SIGKILL') {
        run.failure = stderr.trim() || `ffmpeg exited with code ${code}`
        this.log.warn(`hls: ffmpeg run ${id} failed: ${run.failure}`)
      }
    })

    this.run = run
    this.log.info(`hls: ffmpeg run ${id} from segment ${from}`)
  }

  private argsFor(from: number, runId: number) {
    const { url, starts, videoStream, audioStream, audio } = this.input
    const origin = starts[from] ?? 0
    // Границы относительно первого пакета запуска: так их считает ffmpeg
    const cuts = starts
      .slice(from + 1)
      .map(start => (start - origin).toFixed(3))
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']

    if (from > 0)
      args.push('-ss', seekTargetOf(starts, from).toFixed(3))

    args.push('-rw_timeout', String(READ_TIMEOUT_US), '-i', url)
    args.push('-map', `0:${videoStream}`)

    if (audioStream !== null)
      args.push('-map', `0:${audioStream}`)

    args.push('-c:v', 'copy')

    if (audioStream !== null) {
      args.push(
        ...(audio === 'copy'
          ? ['-c:a', 'copy']
          : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']),
      )
    }

    args.push(
      '-copyts',
      '-avoid_negative_ts',
      'disabled',
      '-muxdelay',
      '0',
      '-output_ts_offset',
      String(TS_OFFSET_SECONDS),
      '-f',
      'segment',
      '-segment_format',
      'mpegts',
      '-segment_start_number',
      String(from),
      '-segment_list',
      join(this.dir, `list-${runId}.csv`),
      '-segment_list_type',
      'csv',
    )

    if (cuts.length > 0)
      args.push('-segment_times', cuts.join(','))
    else args.push('-segment_time', String(this.input.duration + 1))

    args.push(join(this.dir, '%d.ts'))

    for (const stream of this.input.subtitleStreams) {
      args.push(
        '-map',
        `0:${stream}`,
        '-c:s',
        'webvtt',
        '-flush_packets',
        '1',
        '-f',
        'webvtt',
        join(this.dir, `sub-${stream}-${runId}.vtt`),
      )
    }

    return args
  }

  /** Готовые сегменты — те, что ffmpeg записал в список своего запуска */
  private async refreshReady() {
    for (let id = 1; id <= this.runs; id++) {
      const text = await readFile(
        join(this.dir, `list-${id}.csv`),
        'utf8',
      ).catch(() => '')

      for (const line of text.split('\n')) {
        const index = Number.parseInt(line, 10)

        if (Number.isInteger(index) && hasData(this.pathOf(index)))
          this.ready.add(index)
      }
    }
  }

  private async dropOld() {
    const limit = this.lastRequested - KEEP_BEHIND_SEGMENTS

    for (const index of [...this.ready]) {
      if (index < limit) {
        this.ready.delete(index)
        await rm(this.pathOf(index), { force: true })
      }
    }
  }
}
