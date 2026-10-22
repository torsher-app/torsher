import type { WriteStream } from 'node:fs'
import type { LogEntry } from './ring.ts'
import { Buffer } from 'node:buffer'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
} from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import packageJson from '../../../package.json' with { type: 'json' }
import { parseLine } from './ring.ts'

const FILE_NAME = 'torsher.log'
const MAX_BYTES = 5 * 1024 * 1024
// Текущий файл и четыре архива: не больше 25 МБ на томе
const ARCHIVES = 4

export function logFileName(index: number) {
  return index === 0 ? FILE_NAME : `torsher.${index}.log`
}

/** Файлы журнала от старых к новым */
function existingFiles(dir: string | undefined) {
  const files: string[] = []

  if (!dir)
    return files

  for (let index = ARCHIVES; index >= 0; index--) {
    const path = join(dir, logFileName(index))

    if (existsSync(path))
      files.push(path)
  }

  return files
}

interface RotatingFileOptions {
  maxBytes?: number
  warn?: (message: string) => void
}

/**
 * Журнал на диске с ротацией по размеру. Ошибка записи отключает только
 * файлы: сервер продолжает работать, журнал остаётся в памяти.
 */
export class RotatingFile {
  private stream: WriteStream | undefined
  private bytes = 0
  private disabled = false
  private readonly path: string
  private readonly dir: string
  private readonly maxBytes: number
  private readonly warn: (message: string) => void

  constructor(dir: string, options: RotatingFileOptions = {}) {
    this.dir = dir
    this.path = join(dir, FILE_NAME)
    this.maxBytes = options.maxBytes ?? MAX_BYTES
    this.warn
      = options.warn ?? (message => process.stderr.write(`${message}\n`))

    try {
      mkdirSync(dir, { recursive: true })
      this.open()
    }
    catch (err) {
      this.disable(err)
    }
  }

  get enabled() {
    return this.stream !== undefined
  }

  // Файл открывается синхронно: ротация сразу после старта должна его видеть
  private open() {
    const fd = openSync(this.path, 'a')

    this.bytes = fstatSync(fd).size

    const stream = createWriteStream(this.path, { fd })

    stream.on('error', err => this.disable(err))
    this.stream = stream
  }

  private disable(err: unknown) {
    this.stream?.destroy()
    this.stream = undefined

    if (this.disabled)
      return

    this.disabled = true

    const message = err instanceof Error ? err.message : String(err)

    this.warn(`Log files disabled (${this.dir}): ${message}`)
  }

  // Переименование открытого файла на POSIX безопасно: недописанное старым
  // потоком уходит в тот же файл уже под архивным именем
  private rotate() {
    this.stream?.end()
    this.stream = undefined
    rmSync(join(this.dir, logFileName(ARCHIVES)), { force: true })

    for (let index = ARCHIVES - 1; index >= 0; index--) {
      const from = join(this.dir, logFileName(index))

      if (existsSync(from))
        renameSync(from, join(this.dir, logFileName(index + 1)))
    }

    this.open()
  }

  write(line: string) {
    if (!this.stream || this.disabled)
      return

    const size = Buffer.byteLength(line)

    try {
      if (this.bytes > 0 && this.bytes + size > this.maxBytes)
        this.rotate()
    }
    catch (err) {
      this.disable(err)
      return
    }

    this.bytes += size
    this.stream?.write(line)
  }

  close() {
    const stream = this.stream

    this.stream = undefined

    return new Promise<void>((resolve) => {
      if (!stream) {
        resolve()
        return
      }

      stream.end(() => resolve())
    })
  }
}

/** Последние строки журнала с прошлых запусков, от старых к новым */
export function readTail(dir: string, max: number) {
  let lines: string[] = []

  for (let index = 0; index <= ARCHIVES && lines.length < max; index++) {
    const path = join(dir, logFileName(index))

    if (!existsSync(path))
      continue

    try {
      const text = readFileSync(path, 'utf8')

      lines = [...text.split('\n').filter(Boolean), ...lines]
    }
    catch {
      break
    }
  }

  return lines.slice(-max)
}

function contextValue(value: string | number | boolean) {
  const text = String(value)

  return /[\s"=]/.test(text) || text === '' ? JSON.stringify(text) : text
}

/** Запись текстом, как в скачанном журнале */
export function formatEntry(entry: Omit<LogEntry, 'id' | 'seq'>) {
  let line = `${entry.time} ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(7)} ${entry.message}`

  for (const [key, value] of Object.entries(entry.context ?? {}))
    line += ` ${key}=${contextValue(value)}`

  if (entry.details) {
    const details = entry.details
      .split('\n')
      .map(row => `    ${row}`)
      .join('\n')

    line += `\n${details}`
  }

  return `${line}\n`
}

export interface ExportHeader {
  engine: string
  level: string
}

async function* exportLines(dir: string | undefined, header: ExportHeader) {
  yield [
    `Torsher ${packageJson.version}`,
    `Platform: ${process.platform} ${process.arch}`,
    `Node: ${process.version}`,
    `Engine: ${header.engine}`,
    `Log level: ${header.level}`,
    `Exported: ${new Date().toISOString()}`,
    '',
    '',
  ].join('\n')

  for (const path of existingFiles(dir)) {
    const input = createReadStream(path, { encoding: 'utf8' })

    const rl = createInterface({ input, crlfDelay: Infinity })

    // Файл могли удалить ротацией между проверкой и чтением
    input.on('error', () => {})

    // Скачивание оборвали — генератор закрывают на `yield`, и файл должен
    // закрыться вместе с ним
    try {
      for await (const line of rl) {
        const entry = parseLine(line)

        if (entry)
          yield formatEntry(entry)
      }
    }
    catch {
    }
    finally {
      rl.close()
      input.destroy()
    }
  }
}

/** Весь журнал на диске текстом, потоком: файлы бывают до 25 МБ */
export function exportLog(dir: string | undefined, header: ExportHeader) {
  return Readable.from(exportLines(dir, header))
}
