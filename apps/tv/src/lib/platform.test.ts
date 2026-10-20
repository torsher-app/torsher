import { describe, expect, it } from 'vitest'
import { resolvePlatform } from './platform.ts'

describe('resolvePlatform', () => {
  it('без параметра — браузер', () => {
    expect(resolvePlatform('')).toBe('web')
  })

  it('обёртка ТВ передаёт platform=tv', () => {
    expect(resolvePlatform('?platform=tv')).toBe('tv')
    expect(resolvePlatform('?lang=ru&platform=tv')).toBe('tv')
  })

  it('неизвестное значение — браузер', () => {
    expect(resolvePlatform('?platform=android')).toBe('web')
  })
})
