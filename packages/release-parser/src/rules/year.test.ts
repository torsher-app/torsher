import { describe, expect, it } from 'vitest'
import { parseRelease } from '../parse.ts'

describe('год', () => {
  it.each([
    ['Название (2025) WEB-DL 1080p', 2025],
    ['Название / Original [2024, драма, WEB-DL]', 2024],
    ['Show.2019.S01E01.1080p', 2019],
    ['Космос 2049 (2017) BDRip', 2017],
    ['1917.2019.1080p.BluRay', 2019],
    ['Название [2019-2024, Россия, комедия]', 2019],
    ['1917.1080p.BluRay', undefined],
    ['Show.S01E01.1080p', undefined],
  ] as const)('%s', (title, year) => {
    expect(parseRelease(title).year).toBe(year)
  })
})
