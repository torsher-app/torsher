import { describe, expect, it } from 'vitest'
import {
  isHistoryNavigation,
  shellHistoryIndex,
  startScreen,
} from './startup.ts'

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
