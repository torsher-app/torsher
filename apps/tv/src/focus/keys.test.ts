import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readKey } from './keys.ts'

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
