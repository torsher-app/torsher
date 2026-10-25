import type { ChildProcess } from 'node:child_process'
import type { FileHandle } from 'node:fs/promises'
import type { EncodePlan } from './encode.ts'
import type { Cue } from './webvtt.ts'
import type { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { existsSync, rmSync, statSync } from 'node:fs'
import { mkdir, open, readdir, readFile, rm } from 'node:fs/promises'
import { setPriority } from 'node:os'
import { join } from 'node:path'
import { config } from '../../config.ts'
import { EngineError } from '../engine/client.ts'
import {
  describePlan,
  encodeFilterGraph,
  encodeInputArgs,
  encodeOutputArgs,
} from './encode.ts'
import { untrustedInputArgs } from './inputSafety.ts'
import { mergeCues, parseWebVtt } from './webvtt.ts'

/** Желаемая длина сегмента: короче — больше запросов, длиннее — дольше старт */
export const SEGMENT_SECONDS = 6
// Первый сегмент короче: показ начинается, когда он скачан целиком, а у
// холодной раздачи 6 с видео — это ещё несколько секунд ожидания кусков
export const FIRST_SEGMENT_SECONDS = 2
// Запрос дальше стольких сегментов от того, что пишет ffmpeg, — перемотка:
// ffmpeg перезапускается с нужного места, а не дописывает всё подряд
const MAX_AHEAD_SEGMENTS = Math.floor(24 / SEGMENT_SECONDS)
// Сегменты далеко позади просмотра удаляются: на длинном фильме их гигабайты
const KEEP_BEHIND_SEGMENTS = 20
// Не дождался сегмента — ffmpeg, который до него так и не дошёл, убивается:
// следующий запрос запустит новый с актуальным адресом движка
const SEGMENT_WAIT_MS = 60_000
const POLL_MS = 200
// Перепаковка копией идёт быстрее просмотра и дочитала бы файл до конца, а
// за ней и закачку. Ушла дальше запаса от запросов плеера — ffmpeg на паузе,
// плеер догнал — продолжает. Проверка — раз в несколько секунд и на каждом
// запросе сегмента
const AHEAD_SECONDS = 180
const THROTTLE_CHECK_MS = 5000
// ffmpeg ждёт куски от пиров; совсем мёртвый поток он бросит сам
const READ_TIMEOUT_US = 120_000_000

/** Вход запуска: поток движка или файл библиотеки */
export function inputArgs(url: string) {
  return [
    ...untrustedInputArgs(url),
    '-rw_timeout',
    String(READ_TIMEOUT_US),
    '-i',
    url,
  ]
}

// Сдвиг меток в сегментах: с B-кадрами DTS начала файла отрицательный, и
// MPEG-TS сдвинул бы первый запуск иначе, чем запуски с середины. hls.js
// сводит время по первому загруженному сегменту, поэтому общий сдвиг ему
// не мешает
export const TS_OFFSET_SECONDS = 10
// Перекодирование ставит ключевой кадр на границу, а сегмент-муксер режет
// по первому ключевому кадру не раньше границы от первого пакета запуска.
// Первый кадр бывает на 1–2 кадра позже нуля (B-кадры Xvid), и ровная граница
// оказывается чуть позже своего кадра — муксер её пропускает. Допуск меньше
// кадра: других ключевых кадров рядом нет
const ENCODE_CUT_TOLERANCE = 0.1
// Перекодирование не мешает серверу, движку и перепаковке других зрителей
const ENCODE_NICE = 10
const PROGRESS_SECONDS = 5
// Столько замеров подряд медленнее просмотра — предупреждение в журнал
const SLOW_REPORTS = 2

/**
 * Начала сегментов. С точками перемотки MKV разрез — на первой точке не
 * раньше `first`, дальше — не раньше `first + k × длина`; без них — равные
 * куски после первого. Первое начало — 0.
 */
export function segmentStarts(
  duration: number,
  cues: number[] | null,
  length = SEGMENT_SECONDS,
  first = FIRST_SEGMENT_SECONDS,
) {
  const starts = [0]

  if (cues && cues.length > 1) {
    let cut = first

    for (const time of cues) {
      if (time >= cut && time < duration) {
        starts.push(time)
        while (cut <= time) cut += length
      }
    }

    return starts
  }

  for (let time = first; time < duration; time += length) starts.push(time)

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
  /** Адрес потока на каждый запуск ffmpeg: после перезапуска движка он другой */
  url: () => string
  videoStream: number
  audioStream: number | null
  audio: 'copy' | 'aac'
  /** Встроенные текстовые субтитры: пишутся тем же процессом в WebVTT */
  subtitleStreams: number[]
  starts: number[]
  duration: number
  /** Перекодирование видео; без него — видео копией */
  encode?: EncodePlan | null
  /** Запас перепаковки впереди плеера; меньше — только в тестах */
  ahead?: { seconds: number, checkMs: number }
  /** Ожидание сегмента; меньше — только в тестах */
  segmentWaitMs?: number
}

export interface HlsLog {
  debug: (message: string) => void
  warn: {
    (message: string): void
    (fields: { details?: string }, message: string): void
  }
}

const FAILURE_DETAILS_LINES = 20

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
  /** Последний сегмент, который запуск внёс в свой список */
  head: number
  /** Заменён новым запуском: его список больше не читается */
  superseded: boolean
  exited: boolean
  /** Остановлен `SIGSTOP`: ушёл далеко вперёд от плеера */
  paused: boolean
  /** Убит на дедлайне сегмента: заменяется, даже пока `exit` не пришёл */
  stalled: boolean
  failure?: string
  /** Вывод ffmpeg при сбое — в подробности записи журнала */
  details?: string
  /** После сбоя уже перешли на запасной вариант кодирования */
  fellBack: boolean
  /** Прошлый замер скорости: позиция выхода (с) и время; null — после паузы */
  progress: { out: number, at: number } | null
  slowReports: number
  warnedSlow: boolean
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Пустой сегмент — не готовый: ffmpeg вносит его в список и тогда, когда входа
 * не прочитал (на месте данных нули). Отдать его — hls.js запросит снова, и так
 * без конца.
 */
function hasData(path: string) {
  // Одним вызовом: между проверкой и чтением размера каталог может удалить stop()
  return (statSync(path, { throwIfNoEntry: false })?.size ?? 0) > 0
}

/**
 * На сколько секунд записанное ffmpeg ушло вперёд от сегмента, который
 * последним запросил плеер. Ничего не запрошено — ноль.
 */
export function secondsAhead(
  starts: number[],
  duration: number,
  head: number,
  requested: number,
) {
  if (requested < 0 || head < requested)
    return 0

  return (starts[head + 1] ?? duration) - (starts[requested] ?? 0)
}

/**
 * Перепаковка одного файла в сегменты MPEG-TS. Процесс ffmpeg идёт от
 * запрошенного сегмента вперёд; запрос позади или далеко впереди
 * перезапускает его с нового места. Разрезы абсолютные (границы из
 * плейлиста), поэтому готовые сегменты разных запусков совместимы.
 */
export class HlsTranscode {
  readonly dir: string
  private readonly input: HlsInput
  private readonly log: HlsLog
  private run: Run | null = null
  private runs = 0
  private stopped = false
  private queue: Promise<unknown> = Promise.resolve()
  /** Готовые сегменты: номер → есть файл */
  private readonly ready = new Set<number>()
  /** Сегменты, которые ждут запросы: номер → сколько запросов */
  private readonly waiting = new Map<number, number>()
  /** Последний запрошенный плеером сегмент — позиция просмотра */
  private requested = -1
  private throttleTimer: ReturnType<typeof setInterval> | undefined
  /** Текущий вариант перекодирования: после сбоя — запасной */
  private plan: EncodePlan | null

  constructor(dir: string, input: HlsInput, log: HlsLog) {
    this.dir = dir
    this.input = input
    this.log = log
    this.plan = input.encode ?? null
  }

  /** Как сейчас перекодируется видео; null — копией */
  get encode() {
    return this.plan
  }

  get segmentCount() {
    return this.input.starts.length
  }

  get starts() {
    return this.input.starts
  }

  /**
   * Открытый файл готового сегмента; ждёт ffmpeg или перезапускает его.
   * Открывается здесь, а не по пути у вызывающего: старые сегменты удаляет
   * любой параллельный запрос, и удаление после открытия отдаче не мешает.
   */
  async segment(index: number, signal?: AbortSignal): Promise<FileHandle> {
    if (index < 0 || index >= this.segmentCount)
      throw new RangeError('Segment out of range')

    this.waiting.set(index, (this.waiting.get(index) ?? 0) + 1)
    this.requested = index

    try {
      await this.throttle()
      return await this.waitFor(index, signal)
    }
    finally {
      const left = (this.waiting.get(index) ?? 1) - 1

      if (left > 0)
        this.waiting.set(index, left)
      else this.waiting.delete(index)
    }
  }

  private async waitFor(index: number, signal?: AbortSignal) {
    await this.serialize(() => this.ensureRunFor(index))

    // Свой запуск: заменивший его — чужая перемотка, его не трогаем
    let own = this.run
    let deadline = Date.now() + (this.input.segmentWaitMs ?? SEGMENT_WAIT_MS)

    while (!this.stopped && !signal?.aborted) {
      await this.refreshReady()

      if (this.ready.has(index)) {
        // Новый запуск мог снять сегмент с готовности и удалить файл, пока он
        // открывался: тогда ждём, когда его перепишет этот запуск
        const file = await open(this.pathOf(index)).catch(
          (err: NodeJS.ErrnoException) => {
            if (err.code === 'ENOENT')
              return null
            throw err
          },
        )

        if (file) {
          this.dropOld(index)
          return file
        }
      }

      const run = this.run

      if (run?.stalled)
        throw new SegmentTimeoutError()

      if (run?.exited && !this.ready.has(index)) {
        if (run.failure && this.fallBack(run)) {
          await this.serialize(() => this.ensureRunFor(index))
          own = this.run
          deadline = Date.now() + (this.input.segmentWaitMs ?? SEGMENT_WAIT_MS)
          continue
        }

        throw new TranscodeFailedError(
          run.failure ?? 'ffmpeg stopped before the segment',
        )
      }

      if (Date.now() > deadline) {
        if (own && own === run && !own.superseded && own.head < index) {
          own.stalled = true
          this.log.warn(
            `hls: ffmpeg run ${own.id} stalled before segment ${index}, killed`,
          )
          this.kill()
        }

        throw new SegmentTimeoutError()
      }

      await delay(POLL_MS)
    }

    throw new SegmentTimeoutError()
  }

  /**
   * Запуск перекодирования упал, ничего не записав, — обычно видеокарта не
   * открыла декодер или кодировщик: дальше пробуем запасной вариант, вплоть до
   * процессора. Упавший посреди файла запуск — скорее вход, а не видеокарта.
   */
  private fallBack(run: Run) {
    if (run.fellBack)
      return true

    const current = this.plan
    const next = current?.fallback

    if (!current || !next || run !== this.run || run.head >= run.from)
      return false

    run.fellBack = true
    this.plan = next
    this.log.warn(
      run.details ? { details: run.details } : {},
      `hls: transcoding with ${describePlan(current)} failed, retrying with ${describePlan(next)}`,
    )
    return true
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

  /** Только для тестов */
  readySegments() {
    return [...this.ready].sort((a, b) => a - b)
  }

  async stop() {
    this.stopped = true
    clearInterval(this.throttleTimer)
    // Старт мог быть на полпути: после него ffmpeg уже не запустится
    await this.queue
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
    if (this.stopped)
      return

    await this.refreshReady()

    if (this.stopped || this.ready.has(index))
      return

    const run = this.run

    if (run && !run.exited && !run.stalled && index >= run.from) {
      // ffmpeg этот сегмент уже прошёл, а файл удалён как старый: заново
      // он его не запишет
      const passed = index <= run.head && !hasData(this.pathOf(index))

      if (!passed && index <= run.head + 1 + MAX_AHEAD_SEGMENTS)
        return
    }

    await this.start(index)
  }

  // `SIGKILL` убивает и остановленный `SIGSTOP` процесс
  private kill() {
    const run = this.run

    if (run && !run.exited)
      run.process.kill('SIGKILL')
  }

  /** Пауза ffmpeg, когда он ушёл далеко вперёд от плеера, и продолжение */
  private async throttle() {
    await this.refreshReady()

    const run = this.run

    if (!run || run.exited || run.superseded || this.stopped)
      return

    const { starts, duration } = this.input
    const limit = this.input.ahead?.seconds ?? AHEAD_SECONDS
    const pause
      = secondsAhead(starts, duration, run.head, this.requested) > limit

    if (pause === run.paused)
      return

    run.paused = pause
    // Пауза — не медленное кодирование: скорость считается заново
    run.progress = null
    run.process.kill(pause ? 'SIGSTOP' : 'SIGCONT')
  }

  /**
   * Замер скорости перекодирования по выводу `-progress`: сколько секунд
   * видео записано за секунду. `speed` самого ffmpeg — среднее с начала
   * запуска, в него попали бы паузы троттлинга.
   */
  private onProgress(run: Run, block: Map<string, string>) {
    const out = Number(block.get('out_time_us')) / 1_000_000
    const now = Date.now()

    if (!Number.isFinite(out) || run.paused)
      return

    const last = run.progress

    run.progress = { out, at: now }

    if (!last || now <= last.at)
      return

    const speed = (out - last.out) / ((now - last.at) / 1000)

    run.slowReports = speed < 1 ? run.slowReports + 1 : 0

    if (run.slowReports >= SLOW_REPORTS && !run.warnedSlow && this.plan) {
      run.warnedSlow = true
      this.log.warn(
        `hls: transcoding is slower than playback (${speed.toFixed(2)}x, ${describePlan(this.plan)})`,
      )
    }
  }

  private async start(from: number) {
    // Адрес — до любых изменений: если движок недоступен, готовые сегменты
    // и прошлый запуск остаются как были
    let url: string

    try {
      url = this.input.url()
    }
    catch (err) {
      // Движок перезапускается: это временно, ответ 503 даёт клиенту повторить
      if (err instanceof EngineError && err.kind === 'unavailable')
        throw err

      throw new TranscodeFailedError((err as Error).message)
    }

    // Сегменты, которые прошлый запуск успел дописать, остаются готовыми
    await this.refreshReady()

    if (this.run)
      this.run.superseded = true

    // С места запуска новый ffmpeg перезапишет файлы: пока он их не внесёт в
    // свой список, старые не отдаём — их обрезают на ходу
    for (const index of this.ready) {
      if (index >= from)
        this.ready.delete(index)
    }

    this.kill()
    await mkdir(this.dir, { recursive: true })

    if (this.stopped)
      return

    // Незаконченный сегмент прерванного запуска не годится
    for (const name of await readdir(this.dir)) {
      const index = Number.parseInt(name, 10)

      if (name.endsWith('.ts') && !this.ready.has(index))
        await rm(join(this.dir, name), { force: true })
    }

    if (this.stopped)
      return

    const id = ++this.runs
    const plan = this.plan
    const args = this.argsFor(url, from, id)
    const child = spawn(config.ffmpegPath, args, {
      stdio: ['ignore', plan ? 'pipe' : 'ignore', 'pipe'],
    })
    const run: Run = {
      id,
      process: child,
      from,
      head: from - 1,
      superseded: false,
      exited: false,
      paused: false,
      stalled: false,
      fellBack: false,
      progress: null,
      slowReports: 0,
      warnedSlow: false,
    }
    let stderr = ''

    if (plan && child.pid) {
      try {
        setPriority(child.pid, ENCODE_NICE)
      }
      catch (err) {
        this.log.warn(
          `hls: cannot lower ffmpeg priority: ${(err as Error).message}`,
        )
      }
    }

    let progress = ''
    let block = new Map<string, string>()

    child.stdout?.on('data', (chunk: Buffer) => {
      const lines = (progress + chunk.toString()).split('\n')

      progress = lines.pop() ?? ''

      for (const line of lines) {
        const [key, value] = line.trim().split('=')

        if (!key || value === undefined)
          continue

        block.set(key, value)

        if (key === 'progress') {
          this.onProgress(run, block)
          block = new Map()
        }
      }
    })

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

        // Вывод ffmpeg — в подробности: в тексте записи он не даёт склеить повторы
        const details = stderr
          .trim()
          .split('\n')
          .slice(-FAILURE_DETAILS_LINES)
          .join('\n')

        run.details = details || undefined
        this.log.warn(
          details ? { details } : {},
          `ffmpeg run ${id} failed (exit code ${code})`,
        )
      }
    })

    this.run = run
    this.log.debug(
      `hls: ffmpeg run ${id} from segment ${from}${plan ? ` (${describePlan(plan)})` : ''}`,
    )

    if (!this.throttleTimer) {
      this.throttleTimer = setInterval(
        () =>
          void this.throttle().catch((err: Error) =>
            this.log.warn(`hls: throttle check failed: ${err.message}`),
          ),
        this.input.ahead?.checkMs ?? THROTTLE_CHECK_MS,
      )
      this.throttleTimer.unref()
    }
  }

  private argsFor(url: string, from: number, runId: number) {
    const { starts, videoStream, audioStream, audio } = this.input
    const plan = this.plan
    const origin = starts[from] ?? 0
    const tolerance = plan ? ENCODE_CUT_TOLERANCE : 0
    // Границы относительно первого пакета запуска: так их считает ffmpeg
    const cuts = starts
      .slice(from + 1)
      .map(start => (start - origin - tolerance).toFixed(3))
    const args = ['-hide_banner', '-loglevel', 'error', '-nostdin']

    if (plan) {
      args.push(
        '-progress',
        'pipe:1',
        '-stats_period',
        String(PROGRESS_SECONDS),
        ...encodeInputArgs(plan),
      )
    }

    // Перекодирование встаёт точно на начало сегмента (декодер отбрасывает
    // кадры до него), копия — на ключевой кадр, поэтому чуть позже начала
    if (from > 0)
      args.push('-ss', (plan ? origin : seekTargetOf(starts, from)).toFixed(3))

    args.push(...inputArgs(url))

    if (plan) {
      args.push(
        '-filter_complex',
        encodeFilterGraph(plan, videoStream),
        '-map',
        '[v]',
      )
    }
    else {
      args.push('-map', `0:${videoStream}`)
    }

    if (audioStream !== null)
      args.push('-map', `0:${audioStream}`)

    args.push(
      ...(plan ? encodeOutputArgs(plan, starts.slice(from)) : ['-c:v', 'copy']),
    )

    if (audioStream !== null) {
      args.push(
        ...(audio === 'copy'
          ? ['-c:a', 'copy']
          : ['-c:a', 'aac', '-ac', '2', '-b:a', '192k']),
      )

      // Копия звука начинается с пакета до точки перемотки, а перекодированное
      // видео — точно с неё: лишнее отбрасывается, как у Jellyfin
      if (plan && audio === 'copy' && from > 0)
        args.push('-bsf:a', `noise=drop='lt(pts*tb\\,${origin.toFixed(3)})'`)
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

  /**
   * Готовые сегменты — те, что ffmpeg записал в список своего запуска.
   * Читается только текущий: прошлые заменены, их файлы с места нового
   * запуска перезаписываются.
   */
  private async refreshReady() {
    const run = this.run

    if (!run || run.superseded)
      return

    const text = await readFile(
      join(this.dir, `list-${run.id}.csv`),
      'utf8',
    ).catch(() => '')

    if (run.superseded)
      return

    for (const line of text.split('\n')) {
      const index = Number.parseInt(line, 10)

      if (!Number.isInteger(index))
        continue

      run.head = Math.max(run.head, index)

      if (hasData(this.pathOf(index)))
        this.ready.add(index)
    }
  }

  // Синхронно: пока асинхронное удаление в пути, файл ещё виден на диске —
  // параллельный запрос вернул бы сегмент в готовые или не перезапустил бы
  // ffmpeg, а файл пропал бы следом
  private dropOld(served: number) {
    const limit = served - KEEP_BEHIND_SEGMENTS

    for (const index of [...this.ready]) {
      // Сегмент, который ждёт другой запрос, ffmpeg уже не перепишет: удалить
      // его — оставить запрос ждать до таймаута
      if (index >= limit || this.waiting.has(index))
        continue

      this.ready.delete(index)

      try {
        rmSync(this.pathOf(index), { force: true })
      }
      catch (err) {
        // Файл с данными вернёт в готовые следующее чтение списка
        this.log.warn(
          `hls: cannot remove segment ${index}: ${(err as Error).message}`,
        )
      }
    }
  }
}
