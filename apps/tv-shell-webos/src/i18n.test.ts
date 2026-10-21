import { describe, expect, it } from 'vitest'
import { format, resolveMessages } from './i18n.ts'

describe('resolveMessages', () => {
  it('берёт первый поддерживаемый язык', () => {
    expect(resolveMessages(['de-DE', 'ru-RU']).connect).toBe('Подключиться')
    expect(resolveMessages(['ru']).connect).toBe('Подключиться')
  })

  it('без поддерживаемого — английский', () => {
    expect(resolveMessages(['de-DE']).connect).toBe('Connect')
    expect(resolveMessages([]).connect).toBe('Connect')
  })
})

describe('format', () => {
  it('подставляет значения и оставляет неизвестные', () => {
    expect(format('{address} · {x}', { address: '192.168.1.10' })).toBe(
      '192.168.1.10 · {x}',
    )
  })
})
