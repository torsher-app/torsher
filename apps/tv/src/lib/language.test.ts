import { describe, expect, it } from 'vitest'
import { deviceLocale, localeOf, toTmdbLanguage } from './language.ts'

describe('deviceLocale', () => {
  it('берёт первый язык устройства, для которого есть локаль', () => {
    expect(deviceLocale(['ru-RU'])).toBe('ru_RU')
    expect(deviceLocale(['ru-KZ', 'en-US'])).toBe('ru_RU')
    expect(deviceLocale(['de-DE', 'ru'])).toBe('ru_RU')
    expect(deviceLocale(['EN-gb'])).toBe('en_US')
  })

  it('без подходящего языка — английский', () => {
    expect(deviceLocale(['de-DE'])).toBe('en_US')
    expect(deviceLocale([])).toBe('en_US')
  })
})

describe('toTmdbLanguage', () => {
  it('переводит локаль в формат TMDB', () => {
    expect(toTmdbLanguage('ru_RU')).toBe('ru-RU')
  })
})

describe('localeOf', () => {
  it('берёт язык профиля, без него — язык устройства', () => {
    expect(localeOf('en_US', ['ru-RU'])).toBe('en_US')
    expect(localeOf(null, ['ru-RU'])).toBe('ru_RU')
    expect(localeOf(undefined, ['de-DE'])).toBe('en_US')
  })

  it('незнакомый язык профиля не ломает витрину', () => {
    expect(localeOf('de_DE', ['ru-RU'])).toBe('ru_RU')
  })
})
