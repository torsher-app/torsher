import type { ChildProcess } from 'node:child_process'
import type { EngineHealth } from './supervisor.ts'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEngineSupervisor } from './supervisor.ts'

class FakeProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  signals: string[] = []
  // Процесс, который не реагирует на SIGTERM, проверяет принудительную остановку
  ignoreTerm = false

  kill(signal: NodeJS.Signals = 'SIGTERM') {
    this.signals.push(signal)

    if (signal === 'SIGTERM' && this.ignoreTerm)
      return true

    this.crash(null, signal)
    return true
  }

  crash(code: number | null = 1, signal: NodeJS.Signals | null = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)
  }
}

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }

function setup(
  overrides: { health?: () => EngineHealth, exists?: boolean } = {},
) {
  const processes: FakeProcess[] = []
  const spawned: string[][] = []
  const onReady = vi.fn()
  const onDown = vi.fn()
  const healthTimeouts: number[] = []
  let port = 40000

  const supervisor = createEngineSupervisor({
    binaryPath: '/data/engine/torsher-engine',
    args: apiPort => ['--port', String(apiPort)],
    log,
    onReady,
    onDown,
    spawnProcess: (_command, args) => {
      const proc = new FakeProcess()

      processes.push(proc)
      spawned.push(args)
      return proc as unknown as ChildProcess
    },
    findFreePort: async () => ++port,
    checkHealth: async (_baseUrl, timeoutMs) => {
      healthTimeouts.push(timeoutMs)
      return overrides.health?.() ?? 'ok'
    },
    binaryExists: () => overrides.exists ?? true,
    restartDelaysMs: [1000, 5000],
    stableAfterMs: 60_000,
    healthTimeoutMs: 3000,
    healthIntervalMs: 100,
    liveness: { intervalMs: 10_000, timeoutMs: 3000, failures: 3 },
    stopTimeoutMs: 2000,
    missingRecheckMs: 10_000,
  })

  return { supervisor, processes, spawned, onReady, onDown, healthTimeouts }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('супервизор движка', () => {
  it('запускает движок на свободном порту и сообщает адрес, когда API ответил', async () => {
    const { supervisor, spawned, onReady, onDown } = setup()

    await supervisor.start()

    expect(spawned).toEqual([['--port', '40001']])
    expect(onDown).toHaveBeenCalledWith('starting')
    expect(onReady).toHaveBeenCalledWith('http://127.0.0.1:40001')
    expect(supervisor.status).toBe('ready')
  })

  it('после падения перезапускает с паузой, растущей с каждым падением подряд', async () => {
    const { supervisor, processes, spawned, onDown } = setup()

    await supervisor.start()
    processes[0]!.crash()

    expect(supervisor.status).toBe('restarting')
    expect(onDown).toHaveBeenLastCalledWith('starting')

    await vi.advanceTimersByTimeAsync(999)
    expect(spawned).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(spawned).toHaveLength(2)
    expect(supervisor.status).toBe('ready')

    processes[1]!.crash()
    await vi.advanceTimersByTimeAsync(4999)
    expect(spawned).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(spawned).toHaveLength(3)
    // Каждый запуск берёт новый порт: прежний мог остаться занятым
    expect(spawned[2]).toEqual(['--port', '40003'])
  })

  it('процесс, проработавший дольше порога, перезапускается с первой паузой', async () => {
    const { supervisor, processes, spawned } = setup()

    await supervisor.start()
    processes[0]!.crash()
    await vi.advanceTimersByTimeAsync(1000)

    await vi.advanceTimersByTimeAsync(60_000)
    processes[1]!.crash()
    await vi.advanceTimersByTimeAsync(1000)

    expect(spawned).toHaveLength(3)
  })

  it('убивает процесс, если API не ответил вовремя, и перезапускает его', async () => {
    let health: EngineHealth = 'down'
    const { supervisor, processes, spawned, onReady } = setup({
      health: () => health,
    })

    const started = supervisor.start()

    await vi.advanceTimersByTimeAsync(3000)
    await started

    expect(processes[0]!.signals).toEqual(['SIGKILL'])
    expect(onReady).not.toHaveBeenCalled()

    health = 'ok'
    await vi.advanceTimersByTimeAsync(1000)

    expect(spawned).toHaveLength(2)
    expect(supervisor.status).toBe('ready')
  })

  it('движок восстанавливает раздачи дольше срока — ждёт его без SIGKILL', async () => {
    let health: EngineHealth = 'restoring'
    const { supervisor, processes, onReady } = setup({
      health: () => health,
    })

    const started = supervisor.start()

    await vi.advanceTimersByTimeAsync(25_000)

    expect(processes[0]!.signals).toEqual([])
    expect(onReady).not.toHaveBeenCalled()
    expect(supervisor.status).toBe('starting')

    health = 'ok'
    await vi.advanceTimersByTimeAsync(100)
    await started

    expect(processes).toHaveLength(1)
    expect(onReady).toHaveBeenCalledWith('http://127.0.0.1:40001')
    expect(supervisor.status).toBe('ready')
  })

  it('останавливается вместе с сервером и больше не перезапускается', async () => {
    const { supervisor, processes, spawned, onDown } = setup()

    await supervisor.start()
    await supervisor.stop()

    expect(processes[0]!.signals).toEqual(['SIGTERM'])
    expect(onDown).toHaveBeenLastCalledWith('stopped')

    await vi.advanceTimersByTimeAsync(60_000)
    expect(spawned).toHaveLength(1)
    expect(supervisor.status).toBe('stopped')
  })

  it('добивает процесс, который не остановился по SIGTERM', async () => {
    const { supervisor, processes } = setup()

    await supervisor.start()
    processes[0]!.ignoreTerm = true

    const stopped = supervisor.stop()

    await vi.advanceTimersByTimeAsync(2000)
    await stopped

    expect(processes[0]!.signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  it('без бинарника не запускает процесс и сообщает, что движок не установлен', async () => {
    const { supervisor, spawned, onDown } = setup({ exists: false })

    await supervisor.start()

    expect(spawned).toHaveLength(0)
    expect(supervisor.status).toBe('missing')
    expect(onDown).toHaveBeenCalledWith('not_installed')
  })
})

describe('живость готового движка', () => {
  it('после трёх сбоев подряд убивает процесс и запускает новый', async () => {
    let health: EngineHealth = 'ok'
    const { supervisor, processes, spawned, healthTimeouts } = setup({
      health: () => health,
    })

    await supervisor.start()
    health = 'stuck'

    await vi.advanceTimersByTimeAsync(20_000)
    expect(processes[0]!.signals).toEqual([])

    await vi.advanceTimersByTimeAsync(10_000)
    expect(processes[0]!.signals).toEqual(['SIGKILL'])
    expect(supervisor.status).toBe('restarting')
    // Опрос живости ждёт ответа дольше, чем проверка на старте
    expect(healthTimeouts.at(-1)).toBe(3000)

    health = 'ok'
    await vi.advanceTimersByTimeAsync(1000)

    expect(spawned).toHaveLength(2)
    expect(supervisor.status).toBe('ready')
  })

  it('успешный ответ сбрасывает счётчик сбоев', async () => {
    // Первый ответ — стартовой проверке
    const answers: EngineHealth[] = [
      'ok',
      'down',
      'stuck',
      'ok',
      'down',
      'down',
    ]
    const { supervisor, processes } = setup({
      health: () => answers.shift() ?? 'ok',
    })

    await supervisor.start()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(processes).toHaveLength(1)
    expect(processes[0]!.signals).toEqual([])
    expect(supervisor.status).toBe('ready')
  })

  it('восстановление раздач — не сбой, сколько бы ни длилось', async () => {
    let health: EngineHealth = 'ok'
    const { supervisor, processes } = setup({ health: () => health })

    await supervisor.start()
    health = 'restoring'
    await vi.advanceTimersByTimeAsync(120_000)

    expect(processes).toHaveLength(1)
    expect(processes[0]!.signals).toEqual([])
  })

  it('остановка гасит опрос', async () => {
    const { supervisor, healthTimeouts } = setup()

    await supervisor.start()
    await supervisor.stop()

    const checks = healthTimeouts.length

    await vi.advanceTimersByTimeAsync(60_000)
    expect(healthTimeouts).toHaveLength(checks)
  })
})

describe('перезапуск по просьбе', () => {
  it('убивает процесс и запускает новый с первой паузой', async () => {
    const { supervisor, processes, spawned } = setup()

    await supervisor.start()
    processes[0]!.crash()
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)

    // После падения следующая пауза была бы 5 с: просьба сбрасывает счётчик
    expect(supervisor.restart()).toBe(true)
    expect(processes[1]!.signals).toEqual(['SIGKILL'])
    expect(supervisor.status).toBe('restarting')

    await vi.advanceTimersByTimeAsync(999)
    expect(spawned).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(spawned).toHaveLength(3)
    expect(supervisor.status).toBe('ready')
  })

  it('движок, который уже перезапускается, второй раз не запускает', async () => {
    const { supervisor, processes, spawned } = setup()

    await supervisor.start()
    expect(supervisor.restart()).toBe(true)
    expect(supervisor.restart()).toBe(false)

    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)
    expect(processes[1]!.signals).toEqual([])

    await vi.advanceTimersByTimeAsync(30_000)
    expect(spawned).toHaveLength(2)
  })

  it('не запущенный движок не трогает', () => {
    const { supervisor, spawned } = setup()

    expect(supervisor.restart()).toBe(false)
    expect(spawned).toHaveLength(0)
  })
})
