import type { FastifyBaseLogger } from 'fastify'
import type { ChildProcess } from 'node:child_process'
import type { EngineUnavailableKind } from './client.ts'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import process from 'node:process'
import { createInterface } from 'node:readline'

export type EngineStatus
  = 'stopped' | 'missing' | 'starting' | 'ready' | 'restarting'

/**
 * `restoring` — процесс жив, но ещё добавляет раздачи прошлого запуска;
 * `stuck` — процесс отвечает, но блокировка торрент-клиента захвачена
 */
export type EngineHealth = 'ok' | 'restoring' | 'stuck' | 'down'

type EngineLog = Pick<FastifyBaseLogger, 'debug' | 'info' | 'warn' | 'error'>

type KillReason = 'liveness' | 'unresponsive' | 'restart'

export interface EngineSupervisorOptions {
  binaryPath: string
  /** Аргументы запуска; порт HTTP API выбирается заново при каждом старте */
  args: (apiPort: number) => string[]
  log: EngineLog
  onReady: (baseUrl: string) => void
  onDown: (kind: EngineUnavailableKind) => void
  spawnProcess?: (command: string, args: string[]) => ChildProcess
  findFreePort?: () => Promise<number>
  checkHealth?: (baseUrl: string, timeoutMs: number) => Promise<EngineHealth>
  binaryExists?: (path: string) => boolean
  /** Паузы перед перезапуском: n-е падение подряд ждёт n-й элемент, дальше — последний */
  restartDelaysMs?: number[]
  /** Сколько процесс должен проработать, чтобы счётчик падений сбросился */
  stableAfterMs?: number
  healthTimeoutMs?: number
  healthIntervalMs?: number
  /** Опрос живости готового движка: после `failures` сбоев подряд — SIGKILL */
  liveness?: { intervalMs: number, timeoutMs: number, failures: number }
  stopTimeoutMs?: number
  /** Как часто проверять, не появился ли бинарник после `engine:build` */
  missingRecheckMs?: number
}

const DEFAULT_RESTART_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000]
const START_HEALTH_TIMEOUT_MS = 1000
// На NAS под нагрузкой секунды на ответ мало; три сбоя подряд — около 30 с
const DEFAULT_LIVENESS = { intervalMs: 10_000, timeoutMs: 3000, failures: 3 }

const CRASH_WINDOW_MS = 60 * 60 * 1000
// Хвост вывода рантайма Go: трейс паники с сотней горутин укладывается
const RUNTIME_TAIL_BYTES = 64 * 1024
const RUNTIME_TAIL_LINES = 500
const CRASH_TAIL_LINES = 50
const ENGINE_LEVELS = new Set(['DEBUG', 'INFO', 'WARN', 'ERROR'])
// Свои поля записи журнала: поле движка с таким именем их бы перезаписало
const RESERVED_FIELDS = new Set(['time', 'level', 'msg', 'source', 'details'])
const DETAIL_FIELDS = ['stack', 'goroutines']
const LOGFMT_PAIR = /([^\s="]+)=("(?:[^"\\]|\\.)*"|\S*)/g

function unquote(value: string) {
  if (!value.startsWith('"'))
    return value

  try {
    return JSON.parse(value) as string
  }
  catch {
    // Экранирование Go шире JSON (`\x`, `\a`): лучше сырой текст, чем ничего
    return value.slice(1, -1)
  }
}

/** Строка `slog.TextHandler`: `time=… level=… msg="…" key=value`; без уровня — `undefined` */
export function parseEngineLine(line: string) {
  const pairs = new Map<string, string>()

  for (const [, key, value] of line.matchAll(LOGFMT_PAIR))
    pairs.set(key!, unquote(value!))

  const level = pairs.get('level')

  if (!level || !ENGINE_LEVELS.has(level))
    return undefined

  const fields: Record<string, string> = {}
  const details: string[] = []

  for (const [key, value] of pairs) {
    if (DETAIL_FIELDS.includes(key))
      details.push(value)
    // `err` у pino — объект ошибки, строка под этим именем пропала бы
    else if (key === 'err')
      fields.error = value
    else if (!RESERVED_FIELDS.has(key))
      fields[key] = value
  }

  return {
    level: level.toLowerCase() as 'debug' | 'info' | 'warn' | 'error',
    message: pairs.get('msg') ?? '',
    fields,
    details: details.length ? details.join('\n') : undefined,
  }
}

export function formatUptime(ms: number) {
  const seconds = Math.floor(ms / 1000)

  if (seconds < 60)
    return `${seconds}s`

  const minutes = Math.floor(seconds / 60)

  if (minutes < 60)
    return `${minutes}m ${seconds % 60}s`

  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function ordinal(n: number) {
  const tens = n % 100
  const suffix
    = tens >= 11 && tens <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th'

  return `${n}${suffix}`
}

/** Трейс паники рантайма, если он есть, иначе последние строки */
function crashDetails(tail: string[]) {
  const start = tail.findIndex(
    line => line.startsWith('panic:') || line.startsWith('fatal error:'),
  )
  const lines = start >= 0 ? tail.slice(start) : tail.slice(-CRASH_TAIL_LINES)

  return lines.length ? lines.join('\n') : undefined
}

// Логи движка идут в журнал сервера: без цветовых escape-кодов
function defaultSpawn(command: string, args: string[]) {
  return spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1' },
  })
}

/** Свободный порт на loopback; между проверкой и запуском его могут занять — тогда движок упадёт и перезапустится */
export function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer()

    server.unref()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      server.close(() => {
        if (address && typeof address === 'object')
          resolve(address.port)
        else reject(new Error('No free port'))
      })
    })
  })
}

async function defaultCheckHealth(
  baseUrl: string,
  timeoutMs: number,
): Promise<EngineHealth> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })

    if (response.ok)
      return 'ok'

    const body = (await response.json().catch(() => null)) as {
      status?: string
    } | null

    const status = body?.status

    return status === 'restoring' || status === 'stuck' ? status : 'down'
  }
  catch {
    return 'down'
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Держит движок дочерним процессом: запускает, ждёт ответа HTTP API,
 * перезапускает с паузой после падения и останавливает вместе с сервером.
 * Пока движок не готов, клиент движка отвечает «недоступен» — ядро не падает.
 */
export function createEngineSupervisor(options: EngineSupervisorOptions) {
  const spawnProcess = options.spawnProcess ?? defaultSpawn
  const pickPort = options.findFreePort ?? findFreePort
  const checkHealth = options.checkHealth ?? defaultCheckHealth
  const binaryExists = options.binaryExists ?? existsSync
  const restartDelays = options.restartDelaysMs ?? DEFAULT_RESTART_DELAYS_MS
  const stableAfterMs = options.stableAfterMs ?? 60_000
  const healthTimeoutMs = options.healthTimeoutMs ?? 20_000
  const healthIntervalMs = options.healthIntervalMs ?? 250
  const liveness = options.liveness ?? DEFAULT_LIVENESS
  const stopTimeoutMs = options.stopTimeoutMs ?? 5000
  const missingRecheckMs = options.missingRecheckMs ?? 10_000
  const { log } = options

  let status: EngineStatus = 'stopped'
  let child: ChildProcess | undefined
  // Последний запущенный процесс; в отличие от `child`, не сбрасывается по
  // `exit`: по нему `close` отличает свой процесс от остановленного раньше
  let current: ChildProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let livenessTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let readyAt = 0
  let stopping = false
  let spawnedAt = 0
  let killReason: KillReason | undefined
  let runtimeTail: string[] = []
  let runtimeTailBytes = 0
  let crashes: number[] = []

  function setDown(next: EngineStatus) {
    status = next
    options.onDown(
      next === 'missing'
        ? 'not_installed'
        : next === 'stopped'
          ? 'stopped'
          : 'starting',
    )
  }

  function pipeLogs(stream: NodeJS.ReadableStream | null) {
    if (!stream)
      return

    createInterface({ input: stream }).on('line', (line) => {
      const entry = parseEngineLine(line)

      if (entry) {
        log[entry.level](
          entry.details
            ? { ...entry.fields, details: entry.details }
            : entry.fields,
          entry.message,
        )
        return
      }

      // Строка без уровня — вывод рантайма Go, например трейс паники перед
      // выходом: он нужен записи о падении
      log.debug(line)
      runtimeTail.push(line)
      runtimeTailBytes += line.length + 1

      while (
        runtimeTail.length > RUNTIME_TAIL_LINES
        || runtimeTailBytes > RUNTIME_TAIL_BYTES
      ) {
        runtimeTailBytes -= runtimeTail.shift()!.length + 1
      }
    })
  }

  function kill(proc: ChildProcess, reason: KillReason) {
    killReason = reason
    proc.kill('SIGKILL')
  }

  function noteCrash() {
    const now = Date.now()

    crashes = crashes.filter(at => now - at < CRASH_WINDOW_MS)
    crashes.push(now)
  }

  function logExit(code: number | null, signal: NodeJS.Signals | null) {
    const uptimeMs = Date.now() - spawnedAt
    const uptime = formatUptime(uptimeMs)

    if (killReason) {
      if (killReason !== 'restart')
        noteCrash()

      log.warn(
        { uptimeMs },
        `Engine killed by supervisor (${killReason}) after ${uptime}`,
      )
      return
    }

    noteCrash()

    if (code === 0) {
      log.warn({ uptimeMs }, `Engine exited unexpectedly after ${uptime}`)
      return
    }

    const reason = signal ? `signal ${signal}` : `exit code ${code}`
    const details = crashDetails(runtimeTail)

    log.error(
      {
        ...(code !== null ? { code } : {}),
        ...(signal ? { signal } : {}),
        uptimeMs,
        ...(details ? { details } : {}),
      },
      `Engine crashed (${reason}) after ${uptime}`,
    )
  }

  function scheduleRestart() {
    if (readyAt && Date.now() - readyAt >= stableAfterMs)
      failures = 0

    const delay = restartDelays[Math.min(failures, restartDelays.length - 1)]!

    failures += 1
    readyAt = 0
    setDown('restarting')
    log.warn(
      killReason === 'restart'
        ? `Restarting engine in ${delay / 1000} s`
        : `Restarting engine in ${delay / 1000} s (${ordinal(failures)} crash in a row)`,
    )
    timer = setTimeout(() => void launch(), delay)
  }

  async function waitHealthy(proc: ChildProcess, baseUrl: string) {
    const deadline = Date.now() + healthTimeoutMs
    let restoring = false

    // Срок — только до первого ответа: восстановление сотен раздач с
    // проверкой файлов идёт дольше, и убивать живой процесс нельзя
    while (restoring || Date.now() < deadline) {
      if (proc.exitCode !== null || proc.signalCode !== null || stopping)
        return false

      const health = await checkHealth(baseUrl, START_HEALTH_TIMEOUT_MS)

      if (health === 'ok')
        return true

      if (health === 'restoring' && !restoring) {
        restoring = true
        log.info('Engine is restoring torrents')
      }

      await sleep(healthIntervalMs)
    }

    return false
  }

  // Процесс жив, а API молчит или клиент торрентов застрял: без опроса
  // перезапуск пришёл бы только по выходу процесса, которого не будет
  function watchLiveness(proc: ChildProcess, baseUrl: string) {
    let misses = 0

    async function check() {
      livenessTimer = undefined

      if (child !== proc || stopping)
        return

      const health = await checkHealth(baseUrl, liveness.timeoutMs)

      if (child !== proc || stopping)
        return

      if (health === 'ok' || health === 'restoring') {
        misses = 0
      }
      else {
        misses += 1

        if (misses >= liveness.failures) {
          log.error(`Engine is not alive (${health}), killing it`)
          kill(proc, 'liveness')
          return
        }

        log.warn(`Engine health check failed (${health})`)
      }

      livenessTimer = setTimeout(() => void check(), liveness.intervalMs)
    }

    livenessTimer = setTimeout(() => void check(), liveness.intervalMs)
  }

  async function launch() {
    timer = undefined
    killReason = undefined
    runtimeTail = []
    runtimeTailBytes = 0

    if (stopping)
      return

    if (!binaryExists(options.binaryPath)) {
      if (status !== 'missing') {
        log.warn(
          `Engine binary not found at ${options.binaryPath}: run \`pnpm --filter @torsher/server engine:build\` or set ENGINE_PATH`,
        )
      }

      setDown('missing')
      timer = setTimeout(() => void launch(), missingRecheckMs)
      return
    }

    if (status !== 'restarting')
      setDown('starting')

    const port = await pickPort()

    if (stopping)
      return

    const baseUrl = `http://127.0.0.1:${port}`
    const proc = spawnProcess(options.binaryPath, options.args(port))

    child = proc
    current = proc
    spawnedAt = Date.now()
    pipeLogs(proc.stdout)
    pipeLogs(proc.stderr)

    proc.on('error', (err) => {
      log.error(`Engine process error: ${err.message}`)
    })
    proc.on('exit', () => {
      if (child === proc) {
        child = undefined
        clearTimeout(livenessTimer)
        livenessTimer = undefined
      }
    })
    // Не `exit`: он приходит раньше, чем дочитан stderr, и трейс паники
    // не попал бы в запись о падении
    proc.on('close', (code: number | null, signal: NodeJS.Signals | null) => {
      if (child === proc)
        child = undefined

      if (current !== proc || stopping)
        return

      current = undefined

      logExit(code, signal)
      scheduleRestart()
    })

    if (await waitHealthy(proc, baseUrl)) {
      if (child !== proc || stopping)
        return

      status = 'ready'
      readyAt = Date.now()
      log.info(`Engine is ready on ${baseUrl}`)
      options.onReady(baseUrl)
      watchLiveness(proc, baseUrl)
      return
    }

    // Процесс жив, но API не отвечает: убиваем, перезапуск придёт из обработчика close
    if (child === proc && !stopping) {
      log.error('Engine did not answer in time, killing it')
      kill(proc, 'unresponsive')
    }
  }

  function waitExit(proc: ChildProcess) {
    return new Promise<void>((resolve) => {
      if (proc.exitCode !== null || proc.signalCode !== null) {
        resolve()
        return
      }

      const force = setTimeout(() => proc.kill('SIGKILL'), stopTimeoutMs)

      proc.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
    })
  }

  return {
    get status() {
      return status
    },

    start() {
      stopping = false
      failures = 0

      return launch()
    },

    async stop() {
      stopping = true
      clearTimeout(timer)
      timer = undefined
      clearTimeout(livenessTimer)
      livenessTimer = undefined

      const proc = child

      if (proc) {
        proc.kill('SIGTERM')
        await waitExit(proc)
      }

      child = undefined
      current = undefined
      setDown('stopped')
    },

    /**
     * Перезапуск по просьбе владельца: процесс останавливается, дальше —
     * обычный перезапуск с первой паузой. Движок, который и так запускается,
     * не трогаем: второй процесс не нужен. `graceful` — SIGTERM и SIGKILL,
     * только если движок не вышел за `stopTimeoutMs`: так он успевает
     * записать состояние. Без него — сразу SIGKILL, для зависшего движка.
     * `false` — перезапуск не начат
     */
    restart(options: { graceful?: boolean } = {}) {
      const proc = child

      // Мягкий перезапуск ещё ждёт выхода процесса: второй не нужен
      if (status !== 'ready' || !proc || stopping || killReason === 'restart')
        return false

      failures = 0
      readyAt = 0
      log.warn('Engine restart requested')

      if (!options.graceful) {
        kill(proc, 'restart')
        return true
      }

      killReason = 'restart'
      proc.kill('SIGTERM')

      const force = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null)
          proc.kill('SIGKILL')
      }, stopTimeoutMs)

      proc.once('exit', () => clearTimeout(force))
      return true
    },

    /** Падения и зависания за последний час; перезапуск и остановка — не падения */
    recentCrashes() {
      const now = Date.now()

      crashes = crashes.filter(at => now - at < CRASH_WINDOW_MS)
      return crashes.length
    },

    /** Синхронная остановка на выходе процесса, когда ждать уже нельзя */
    kill() {
      child?.kill('SIGKILL')
    },
  }
}

export type EngineSupervisor = ReturnType<typeof createEngineSupervisor>
