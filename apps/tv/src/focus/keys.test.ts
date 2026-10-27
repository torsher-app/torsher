import { beforeAll, describe, expect, it, vi } from 'vitest'
import { ANDROID_BACK, readKey } from './keys.ts'

// Тесты идут без DOM: классам полей ввода хватит заглушек
beforeAll(() => {
  vi.stubGlobal('HTMLInputElement', class {})
  vi.stubGlobal('HTMLTextAreaElement', class {})
})

function key(keyCode: number, init: { shiftKey?: boolean } = {}) {
  return { keyCode, target: null, shiftKey: false, ...init } as KeyboardEvent
}

describe('readKey: цифры', () => {
  it('читает цифры верхнего ряда и цифрового блока', () => {
    expect(readKey(key(48))).toEqual({ type: 'digit', digit: 0 })
    expect(readKey(key(57))).toEqual({ type: 'digit', digit: 9 })
    expect(readKey(key(101))).toEqual({ type: 'digit', digit: 5 })
  })

  it('с Shift это не цифра', () => {
    expect(readKey(key(49, { shiftKey: true }))).toBeUndefined()
  })
})

describe('readKey: листание экранами', () => {
  it('шаг на экран — PageUp и PageDown', () => {
    expect(readKey(key(33))).toEqual({ type: 'page', direction: 'up' })
    expect(readKey(key(34))).toEqual({ type: 'page', direction: 'down' })
  })
})

describe('readKey: Android TV', () => {
  it('back от оболочки', () => {
    expect(readKey(key(ANDROID_BACK))).toEqual({ type: 'back' })
  })

  it('медиакнопки пульта', () => {
    expect(readKey(key(179))).toEqual({ type: 'media', key: 'playPause' })
    expect(readKey(key(178))).toEqual({ type: 'media', key: 'stop' })
    expect(readKey(key(228))).toEqual({ type: 'media', key: 'forward' })
    expect(readKey(key(227))).toEqual({ type: 'media', key: 'rewind' })
  })
})
