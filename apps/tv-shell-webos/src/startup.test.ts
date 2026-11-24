import type { CheckResult } from './server.ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkSavedServer,
  isHistoryNavigation,
  shellHistoryIndex,
  startScreen,
} from './startup.ts'

describe('checkSavedServer', () => {
  afterEach(() => vi.useRealTimers())

  it('открывает витрину после успешной первой проверки', async () => {
    const check = vi.fn<() => Promise<CheckResult>>().mockResolvedValue('ok')

    await expect(checkSavedServer(check, () => true)).resolves.toBe('ok')
    expect(check).toHaveBeenCalledOnce()
  })

  it('через секунду повторяет проверку и принимает успешный ответ', async () => {
    vi.useFakeTimers()
    const check = vi
      .fn<() => Promise<CheckResult>>()
      .mockResolvedValueOnce('unreachable')
      .mockResolvedValueOnce('ok')

    const result = checkSavedServer(check, () => true)

    await vi.advanceTimersByTimeAsync(999)
    expect(check).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1)
    await expect(result).resolves.toBe('ok')
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('возвращает ошибку повтора после двух неудачных проверок', async () => {
    vi.useFakeTimers()
    const check = vi
      .fn<() => Promise<CheckResult>>()
      .mockResolvedValueOnce('notTorsher')
      .mockResolvedValue('timeout')

    const result = checkSavedServer(check, () => true)

    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('timeout')
    expect(check).toHaveBeenCalledTimes(2)
  })

  it('пропускает повтор, если пользователь отменил подключение во время паузы', async () => {
    vi.useFakeTimers()
    const check = vi
      .fn<() => Promise<CheckResult>>()
      .mockResolvedValue('unreachable')
    let isCurrent = true

    const result = checkSavedServer(check, () => isCurrent)

    await vi.advanceTimersByTimeAsync(500)
    isCurrent = false
    await vi.runAllTimersAsync()
    await expect(result).resolves.toBe('unreachable')
    expect(check).toHaveBeenCalledOnce()
  })
})

describe('startScreen', () => {
  it('без адреса — экран адреса', () => {
    expect(startScreen(null, false)).toBe('address')
  })

  it('с адресом — подключение', () => {
    expect(startScreen('http://192.168.1.10:8080', false)).toBe('connect')
  })

  it('после возврата из витрины — экран адреса', () => {
    expect(startScreen('http://192.168.1.10:8080', true)).toBe('address')
  })
})

function perf(entryType: string | undefined, legacyType?: number) {
  return {
    getEntriesByType: () => (entryType ? [{ type: entryType }] : []),
    navigation: legacyType === undefined ? undefined : { type: legacyType },
  } as unknown as Performance
}

describe('isHistoryNavigation', () => {
  it('по Navigation Timing 2', () => {
    expect(isHistoryNavigation(perf('back_forward'))).toBe(true)
    expect(isHistoryNavigation(perf('navigate'))).toBe(false)
    expect(isHistoryNavigation(perf('reload'))).toBe(false)
  })

  it('без записи навигации — по performance.navigation', () => {
    expect(isHistoryNavigation(perf(undefined, 2))).toBe(true)
    expect(isHistoryNavigation(perf(undefined, 0))).toBe(false)
    expect(isHistoryNavigation(perf(undefined))).toBe(false)
  })
})

function fakeHistory(length: number, state: unknown = null) {
  const history = {
    length,
    state,
    replaceState(next: unknown) {
      history.state = next
    },
  }

  return history as unknown as History
}

describe('shellHistoryIndex', () => {
  it('свежая загрузка — последняя запись, номер запоминается', () => {
    const history = fakeHistory(3)

    expect(shellHistoryIndex(history)).toBe(2)
    expect(history.state).toEqual({ shellIndex: 2 })
  })

  it('после возврата «Назад» — запомненный номер, а не длина истории', () => {
    expect(shellHistoryIndex(fakeHistory(5, { shellIndex: 0 }))).toBe(0)
  })
})
