import type { Logger } from 'pino'
import type { LogLevel, LogQuery, LogSource } from './ring.ts'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import pino from 'pino'
import { config } from '../../config.ts'
import { engineState } from '../engine/client.ts'
import { exportLog as exportFiles, readTail, RotatingFile } from './files.ts'
import { LOG_LEVELS, LogRing } from './ring.ts'
import { scrubText } from './scrub.ts'

export { LOG_LEVELS, LOG_SOURCES } from './ring.ts'
export type { LogEntry, LogLevel, LogQuery, LogSource } from './ring.ts'

const RING_CAPACITY = 5000
const FASTIFY_LISTENING = 'Server listening at '

// Второй слой после текстовой очистки: известные поля с секретами
const REDACT_PATHS = [
  'password',
  'apiKey',
  'token',
  '*.password',
  '*.apiKey',
  '*.token',
  'headers.authorization',
  'headers.cookie',
  'req.headers.authorization',
  'req.headers.cookie',
]

let root: Logger = pino({ level: 'silent' })
let children = new Map<LogSource, Logger>()
let ring = new LogRing(RING_CAPACITY)
let file: RotatingFile | undefined
let logsDir: string | undefined
// Номера записей начинаются заново с каждым журналом: по смене id панель
// понимает, что её курсор устарел
let instance = randomUUID()

/**
 * Логгер сервера: stdout для `docker logs` и журнал (память и файлы с
 * ротацией). Каждая строка очищается до записи в любой из них.
 */
export function createLogger(options: {
  level: LogLevel
  logsDir: string
  /** Тесты подменяют stdout, чтобы не засорять вывод */
  stdout?: { write: (line: string) => unknown }
}) {
  void file?.close()
  ring = new LogRing(RING_CAPACITY)
  instance = randomUUID()

  // Журнал переживает перезапуск: буфер начинается с хвоста прошлых файлов
  for (const line of readTail(options.logsDir, RING_CAPACITY)) ring.push(line)

  const target = new RotatingFile(options.logsDir)

  file = target.enabled ? target : undefined
  logsDir = options.logsDir

  const journal = {
    write(line: string) {
      file?.write(line)
      ring.push(line)
    },
  }

  return pino(
    {
      level: options.level,
      redact: { paths: REDACT_PATHS, censor: '[redacted]' },
      hooks: {
        streamWrite: scrubText,
        // Fastify пишет адрес на каждом сетевом интерфейсе отдельной записью
        // info и не даёт это выключить; порт уже есть в «Server started»
        logMethod(args, method, level) {
          if (
            level === pino.levels.values.info
            && typeof args[0] === 'string'
            && args[0].startsWith(FASTIFY_LISTENING)
          ) {
            this.debug(...args)
            return
          }

          method.apply(this, args)
        },
      },
    },
    // Без явного уровня multistream пропускает только info и выше
    pino.multistream([
      { stream: options.stdout ?? process.stdout, level: 'debug' },
      { stream: journal, level: 'debug' },
    ]),
  )
}

// Ключ — до какого времени молчать
const quietUntil = new Map<string, number>()

/**
 * Можно ли писать запись с этим ключом: не чаще раза за `ms`. Для отказов,
 * которые клиент повторяет на каждом запросе (сегменты, опрос телевизора).
 */
export function throttleLog(key: string, ms: number) {
  const now = Date.now()
  const until = quietUntil.get(key)

  if (until !== undefined && until > now)
    return false

  // Ключи — id сессий и адреса: истёкшие убираем, чтобы карта не росла
  if (quietUntil.size >= 1000) {
    for (const [stale, at] of quietUntil) {
      if (at <= now)
        quietUntil.delete(stale)
    }
  }

  quietUntil.set(key, now + ms)
  return true
}

/** Подменяет логгер сервисов; дочерние логгеры источников создаются заново */
export function installLogger(logger: Logger) {
  root = logger
  children = new Map()
  quietUntil.clear()
}

/**
 * Логгер источника. Берите его в месте записи, а не на уровне модуля:
 * логгер подменяется при старте сервера и в тестах.
 */
export function logFor(source: LogSource) {
  let child = children.get(source)

  if (!child) {
    child = root.child({ source })
    children.set(source, child)
  }

  return child
}

/**
 * Уровень меняется сразу для всех: дочерние логгеры без своего уровня, в
 * том числе логгеры запросов Fastify, читают его у корня через прототип.
 */
export function setLogLevel(level: LogLevel) {
  root.level = level
}

// У pino есть trace, fatal и silent: наружу — ближайший из уровней журнала
export function getLogLevel(): LogLevel {
  const level = root.level

  if (level === 'trace')
    return 'debug'

  return LOG_LEVELS.find(item => item === level) ?? 'error'
}

export function isLogLevelLocked() {
  return config.logLevel !== undefined
}

/** Дописать файл журнала перед выходом процесса */
export function closeLogFiles() {
  return file?.close() ?? Promise.resolve()
}

export function queryLogs(query: LogQuery) {
  return { ...ring.query(query), instance }
}

/** Журнал на диске текстом; без файлов — только шапка */
export function exportLog() {
  return exportFiles(logsDir, {
    engine: engineState(),
    level: getLogLevel(),
  })
}
