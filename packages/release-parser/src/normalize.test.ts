import { describe, expect, it } from 'vitest'
import { normalizeTitle, titleKey, transliterate } from './normalize.ts'

describe('normalizeTitle', () => {
  it.each([
    ['Ёлки: Возвращение!', 'елки возвращение'],
    ['  Quiet   Harbor  ', 'quiet harbor'],
    ['Café Society', 'cafe society'],
    ['Dust & Bones', 'dust and bones'],
    ['Tихая—гавань', 'tихая гавань'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeTitle(input)).toBe(expected)
  })
})

describe('transliterate', () => {
  it('переводит кириллицу и оставляет остальное', () => {
    expect(transliterate('Щука и ёж 2')).toBe('shchuka i ezh 2')
  })
})

describe('titleKey', () => {
  it.each([
    ['Однажды в деревне', 'Odnazhdy v derevne'],
    ['Однажды в деревне', 'Odnajdi v derevne'],
    ['Северный ветер', 'Severnyy veter'],
    ['Северный ветер', 'Severniy veter'],
    ['Хозяйка', 'Khozyayka'],
    ['Хозяйка', 'Hozjajka'],
    ['Щит', 'Schit'],
    ['Тихая гавань', 'Tikhaya gavan'],
  ])('%s и %s дают один ключ', (ru, latin) => {
    expect(titleKey(ru)).toBe(titleKey(latin))
  })

  it.each([
    ['Северный ветер', 'Южный ветер'],
    ['Quiet Harbor', 'Quiet Harbour Two'],
  ])('%s и %s различаются', (a, b) => {
    expect(titleKey(a)).not.toBe(titleKey(b))
  })
})
