import type { ChildProcess } from 'node:child_process'
import type { EngineUnavailableKind } from './client.ts'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import process from 'node:process'
import { createInterface } from 'node:readline'

export type EngineStatus
  = 'stopped' | 'missing' | 'starting' | 'ready' | 'restarting'

/** `restoring` — процесс жив, но ещё добавляет раздачи прошлого запуска */
export type EngineHealth = 'ok' | 'restoring' | 'down'

interface EngineLog {
  debug: (msg: string) => void
  info: (msg: string) => void
  warn: (msg: string) => void
  error: (msg: string) => void
}

export interface EngineSupervisorOptions {
  binaryPath: string
  /** Аргументы запуска; порт HTTP API выбирается заново при каждом старте */
  args: (apiPort: number) => string[]
  log: EngineLog
  onReady: (baseUrl: string) => void
  onDown: (kind: EngineUnavailableKind) => void
  spawnProcess?: (command: string, args: string[]) => ChildProcess
  findFreePort?: () => Promise<number>
  checkHealth?: (baseUrl: string) => Promise<EngineHealth>
  binaryExists?: (path: string) => boolean
  /** Паузы перед перезапуском: n-е падение подряд ждёт n-й элемент, дальше — последний */
  restartDelaysMs?: number[]
  /** Сколько процесс должен проработать, чтобы счётчик падений сбросился */
  stableAfterMs?: number
  healthTimeoutMs?: number
  healthIntervalMs?: number
  stopTimeoutMs?: number
  /** Как часто проверять, не появился ли бинарник после `engine:build` */
  missingRecheckMs?: number
}

const DEFAULT_RESTART_DELAYS_MS = [1000, 2000, 5000, 10_000, 30_000]

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

async function defaultCheckHealth(baseUrl: string): Promise<EngineHealth> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1000),
    })

    if (response.ok)
      return 'ok'

    const body = (await response.json().catch(() => null)) as {
      status?: string
    } | null

    return body?.status === 'restoring' ? 'restoring' : 'down'
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
  const stopTimeoutMs = options.stopTimeoutMs ?? 5000
  const missingRecheckMs = options.missingRecheckMs ?? 10_000
  const { log } = options

  let status: EngineStatus = 'stopped'
  let child: ChildProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let failures = 0
  let readyAt = 0
  let stopping = false

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
      if (/\bERROR\b/.test(line))
        log.error(`engine: ${line}`)
      else if (/\bWARN\b/.test(line))
        log.warn(`engine: ${line}`)
      else log.debug(`engine: ${line}`)
    })
  }

  function scheduleRestart() {
    if (readyAt && Date.now() - readyAt >= stableAfterMs)
      failures = 0

    const delay = restartDelays[Math.min(failures, restartDelays.length - 1)]

    failures += 1
    readyAt = 0
    setDown('restarting')
    log.warn(`Engine exited, restarting in ${delay} ms`)
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

      const health = await checkHealth(baseUrl)

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

  async function launch() {
    timer = undefined

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
    pipeLogs(proc.stdout)
    pipeLogs(proc.stderr)

    proc.on('error', (err) => {
      log.error(`Engine process error: ${err.message}`)
    })
    proc.on('exit', () => {
      if (child === proc)
        child = undefined

      if (!stopping)
        scheduleRestart()
    })

    if (await waitHealthy(proc, baseUrl)) {
      if (child !== proc || stopping)
        return

      status = 'ready'
      readyAt = Date.now()
      log.info(`Engine is ready on ${baseUrl}`)
      options.onReady(baseUrl)
      return
    }

    // Процесс жив, но API не отвечает: убиваем, перезапуск придёт из обработчика exit
    if (child === proc && !stopping) {
      log.error('Engine did not answer in time, killing it')
      proc.kill('SIGKILL')
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

      const proc = child

      if (proc) {
        proc.kill('SIGTERM')
        await waitExit(proc)
      }

      child = undefined
      setDown('stopped')
    },

    /** Синхронная остановка на выходе процесса, когда ждать уже нельзя */
    kill() {
      child?.kill('SIGKILL')
    },
  }
}

export type EngineSupervisor = ReturnType<typeof createEngineSupervisor>
