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

  /** Как у настоящего процесса: `exit`, затем `close`, когда вывод дочитан */
  crash(code: number | null = 1, signal: NodeJS.Signals | null = null) {
    this.exitCode = code
    this.signalCode = signal
    this.emit('exit', code, signal)

    const ended = (stream: PassThrough) =>
      new Promise<void>((resolve) => {
        stream.once('end', resolve)
        stream.end()
        stream.resume()
      })

    return Promise.all([ended(this.stdout), ended(this.stderr)]).then(() => {
      this.emit('close', code, signal)
    })
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
    await processes[0]!.crash()

    expect(supervisor.status).toBe('restarting')
    expect(onDown).toHaveBeenLastCalledWith('starting')

    await vi.advanceTimersByTimeAsync(999)
    expect(spawned).toHaveLength(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(spawned).toHaveLength(2)
    expect(supervisor.status).toBe('ready')

    await processes[1]!.crash()
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
    await processes[0]!.crash()
    await vi.advanceTimersByTimeAsync(1000)

    await vi.advanceTimersByTimeAsync(60_000)
    await processes[1]!.crash()
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
    await vi.advanceTimersByTimeAsync(0)
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
    await processes[0]!.crash()
    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)

    // После падения следующая пауза была бы 5 с: просьба сбрасывает счётчик
    expect(supervisor.restart()).toBe(true)
    expect(processes[1]!.signals).toEqual(['SIGKILL'])
    // Перезапуск планируется по `close`, когда вывод процесса дочитан
    await vi.advanceTimersByTimeAsync(0)
    expect(supervisor.status).toBe('restarting')

    await vi.advanceTimersByTimeAsync(999)
    expect(spawned).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(1)
    expect(spawned).toHaveLength(3)
    expect(supervisor.status).toBe('ready')
  })

  it('мягкий: SIGTERM, через срок остановки — SIGKILL; падением не считается', async () => {
    const { supervisor, processes, spawned } = setup()

    await supervisor.start()
    processes[0]!.ignoreTerm = true

    expect(supervisor.restart({ graceful: true })).toBe(true)
    expect(processes[0]!.signals).toEqual(['SIGTERM'])
    // Процесс ещё жив: второй перезапуск не начинается
    expect(supervisor.restart({ graceful: true })).toBe(false)

    await vi.advanceTimersByTimeAsync(5000)
    expect(processes[0]!.signals).toEqual(['SIGTERM', 'SIGKILL'])

    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)
    expect(supervisor.status).toBe('ready')
    expect(supervisor.recentCrashes()).toBe(0)
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

describe('журнал движка', () => {
  function messages(fn: typeof log.error) {
    return fn.mock.calls.map(call => String(call.at(-1)))
  }

  it('строка с level=INFO — info с полями записи', async () => {
    const { supervisor, processes } = setup()

    await supervisor.start()
    processes[0]!.stderr.write(
      'time=2026-10-22T10:00:00.000Z level=INFO msg="torrent added" infohash=abc files=3 note="a \\"b\\""\n',
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(log.info).toHaveBeenCalledWith(
      { infohash: 'abc', files: '3', note: 'a "b"' },
      'torrent added',
    )
  })

  it('поле err — warn с полем error', async () => {
    const { supervisor, processes } = setup()

    await supervisor.start()
    processes[0]!.stderr.write(
      'time=2026-10-22T10:00:00.000Z level=WARN msg="restore torrent" err="open /x: permission denied"\n',
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(log.warn).toHaveBeenCalledWith(
      { error: 'open /x: permission denied' },
      'restore torrent',
    )
  })

  it('паника рантайма и выход с кодом 2 — одна запись error с трейсом', async () => {
    const { supervisor, processes } = setup()

    await supervisor.start()
    vi.advanceTimersByTime(192_000)
    processes[0]!.stderr.write(
      [
        'time=2026-10-22T10:00:00.000Z level=WARN msg="slow peer"',
        'unrelated output',
        'panic: runtime error: invalid memory address',
        '',
        'goroutine 7 [running]:',
        'github.com/anacrolix/torrent.(*Torrent).foo()',
        '',
      ].join('\n'),
    )
    await processes[0]!.crash(2)

    const crashes = log.error.mock.calls.filter(call =>
      String(call[1]).startsWith('Engine crashed'),
    )

    expect(crashes).toHaveLength(1)
    expect(crashes[0]).toEqual([
      {
        code: 2,
        uptimeMs: 192_000,
        details: [
          'panic: runtime error: invalid memory address',
          '',
          'goroutine 7 [running]:',
          'github.com/anacrolix/torrent.(*Torrent).foo()',
        ].join('\n'),
      },
      'Engine crashed (exit code 2) after 3m 12s',
    ])
    expect(log.warn).toHaveBeenCalledWith({}, 'slow peer')
    expect(log.debug).toHaveBeenCalledWith('unrelated output')
    expect(messages(log.warn)).toContain(
      'Restarting engine in 1 s (1st crash in a row)',
    )
  })

  it('паника обработчика: поле stack уходит в details', async () => {
    const { supervisor, processes } = setup()

    await supervisor.start()
    processes[0]!.stderr.write(
      'time=2026-10-22T10:00:00.000Z level=ERROR msg="handler panic" path=/torrents stack="goroutine 5 [running]:\\nmain.handler()"\n',
    )
    await vi.advanceTimersByTimeAsync(0)

    expect(log.error).toHaveBeenCalledWith(
      { path: '/torrents', details: 'goroutine 5 [running]:\nmain.handler()' },
      'handler panic',
    )
  })

  it('выход с кодом 0 без остановки — warn и перезапуск', async () => {
    const { supervisor, processes, spawned } = setup()

    await supervisor.start()
    await processes[0]!.crash(0)

    expect(messages(log.warn)).toContain('Engine exited unexpectedly after 0s')
    expect(messages(log.error)).toEqual([])

    await vi.advanceTimersByTimeAsync(1000)
    expect(spawned).toHaveLength(2)
  })

  it('остановка — без записи о падении', async () => {
    const { supervisor } = setup()

    await supervisor.start()
    await supervisor.stop()
    await vi.advanceTimersByTimeAsync(0)

    const all = [...messages(log.warn), ...messages(log.error)]

    expect(
      all.filter(message =>
        /^Engine (?:crashed|exited|killed)/.test(message),
      ),
    ).toEqual([])
    expect(supervisor.recentCrashes()).toBe(0)
  })

  it('поздний close остановленного процесса не перезапускает новый', async () => {
    const { supervisor, processes, spawned } = setup()

    await supervisor.start()

    const old = processes[0]!

    // SIGTERM без немедленного выхода: `exit` придёт вручную, `close` — позже
    old.ignoreTerm = true

    const stopped = supervisor.stop()

    old.exitCode = 0
    old.emit('exit', 0, null)
    await stopped
    await supervisor.start()
    old.emit('close', 0, null)
    await vi.advanceTimersByTimeAsync(60_000)

    const all = [...messages(log.warn), ...messages(log.error)]

    expect(spawned).toHaveLength(2)
    expect(
      all.filter(message =>
        /^(?:Engine (?:crashed|exited|killed)|Restarting)/.test(message),
      ),
    ).toEqual([])
    expect(supervisor.status).toBe('ready')
  })

  it('убийство по живости — warn «killed» и считается падением', async () => {
    let health: EngineHealth = 'ok'
    const { supervisor } = setup({ health: () => health })

    await supervisor.start()
    health = 'stuck'
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(0)

    expect(messages(log.warn)).toContain(
      'Engine killed by supervisor (liveness) after 30s',
    )
    expect(supervisor.recentCrashes()).toBe(1)
  })

  it('падения считаются за последний час, перезапуск по просьбе — нет', async () => {
    const { supervisor, processes } = setup()

    await supervisor.start()
    await processes[0]!.crash()
    await vi.advanceTimersByTimeAsync(1000)
    await processes[1]!.crash(null, 'SIGSEGV')
    await vi.advanceTimersByTimeAsync(5000)

    expect(supervisor.recentCrashes()).toBe(2)
    expect(messages(log.error)).toContain(
      'Engine crashed (signal SIGSEGV) after 0s',
    )

    expect(supervisor.restart()).toBe(true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(supervisor.recentCrashes()).toBe(2)
    expect(messages(log.warn)).toContain('Restarting engine in 1 s')

    await vi.advanceTimersByTimeAsync(60 * 60 * 1000)
    expect(supervisor.recentCrashes()).toBe(0)
  })
})
