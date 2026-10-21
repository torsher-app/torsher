import { describe, expect, it } from 'vitest'
import { parseRelease } from '../parse.ts'
import { isTranslit } from './titles.ts'

function titles(title: string) {
  return parseRelease(title).titles
}

describe('названия', () => {
  it.each([
    [
      'Тихая гавань / Quiet Harbor / Сезон: 1 [2024]',
      { ru: 'Тихая гавань', orig: 'Quiet Harbor' },
    ],
    [
      'Северный ветер (North Wind) [S01E01-08 of 08] (2025)',
      { ru: 'Северный ветер', orig: 'North Wind' },
    ],
    [
      'Однажды в деревне / Odnazhdy v derevne [S01] (2025)',
      { ru: 'Однажды в деревне', translit: 'Odnazhdy v derevne' },
    ],
    [
      'Odnazhdy v derevne [S01E01-10] (2025) WEB-DL 1080p',
      { translit: 'Odnazhdy v derevne' },
    ],
    [
      'Лабиринт / Labirint / The Maze (2024) WEB-DL 1080p',
      { ru: 'Лабиринт', translit: 'Labirint', orig: 'The Maze' },
    ],
    ['Мастер / Master (2024) WEB-DL 1080p', { ru: 'Мастер', orig: 'Master' }],
    ['Quiet.Harbor.S01E02.1080p.WEB-DL', { orig: 'Quiet Harbor' }],
    [
      'Миссия: Тишина / Mission: Silence (2024) BDRip',
      { ru: 'Миссия: Тишина', orig: 'Mission: Silence' },
    ],
    [
      'Человек-луч / Ray-Man (2024) BDRip',
      { ru: 'Человек-луч', orig: 'Ray-Man' },
    ],
    ['1917 (2019) BDRip 1080p', { orig: '1917' }],
    ['[Group] Hoshi no Uta - 05 [1080p]', { orig: 'Hoshi no Uta' }],
    [
      'Ночной рейс / Night Flight / Red Eye (2024) WEB-DL',
      { ru: 'Ночной рейс', orig: 'Night Flight', alt: ['Red Eye'] },
    ],
  ] as const)('%s', (title, expected) => {
    expect(titles(title)).toEqual(expected)
  })
})

describe('транслит', () => {
  it.each([
    ['Odnazhdy v Rossii', undefined, true],
    ['Kukhnya', 'Кухня', true],
    ['Master i Margarita', 'Мастер и Маргарита', true],
    ['Titans', 'Титаны', false],
    ['The Boys', 'Пацаны', false],
    ['The Last of Us', undefined, false],
    ['Zhizn po vyzovu', undefined, true],
  ])('%s', (latin, ru, expected) => {
    expect(isTranslit(latin, ru)).toBe(expected)
  })
})
