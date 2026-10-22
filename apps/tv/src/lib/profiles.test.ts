import { describe, expect, it } from 'vitest'
import { initialOf } from './profiles.ts'

describe('initialOf', () => {
  it('берёт первую букву заглавной', () => {
    expect(initialOf('  мама')).toBe('М')
    expect(initialOf('kids')).toBe('K')
  })

  it('не режет эмодзи и пустое имя', () => {
    expect(initialOf('🦊 Лиса')).toBe('🦊')
    expect(initialOf(' ')).toBe('?')
  })
})
