import type { TmdbMovie, TmdbTv } from './types.ts'
import { describe, expect, it } from 'vitest'
import { certificationAge } from './certification.ts'

function movie(ru: string[] = [], us: string[] = []) {
  return {
    release_dates: {
      results: [
        {
          iso_3166_1: 'RU',
          release_dates: ru.map(certification => ({ certification })),
        },
        {
          iso_3166_1: 'US',
          release_dates: us.map(certification => ({ certification })),
        },
      ],
    },
  } as TmdbMovie
}
describe('fixed authorization certification', () => {
  it.each([0, 6, 12, 16, 18])('normalizes RU %i with optional plus', (age) => {
    expect(certificationAge(movie([String(age)]))).toBe(age)
    expect(certificationAge(movie([`${age}+`]))).toBe(age)
  })
  it.each([
    ['G', 0],
    ['TV-G', 0],
    ['TV-Y', 0],
    ['TV-Y7', 7],
    ['PG', 10],
    ['TV-PG', 10],
    ['PG-13', 13],
    ['TV-14', 14],
    ['R', 17],
    ['TV-MA', 17],
    ['NC-17', 18],
  ])('normalizes US %s', (code, age) => {
    expect(certificationAge(movie([], [String(code)]))).toBe(age)
  })
  it('uses the most restrictive classification in RU and never weakens unknown RU using US', () => {
    expect(certificationAge(movie(['6+', '16+', '12+'], ['G']))).toBe(16)
    expect(certificationAge(movie(['UNKNOWN'], ['G']))).toBeUndefined()
    expect(certificationAge(movie([' ', ''], ['PG-13', 'R']))).toBe(17)
    expect(certificationAge(movie([], ['UNRATED']))).toBeUndefined()
    expect(certificationAge(movie())).toBeUndefined()
  })
  it('uses the same rules for TV', () => {
    expect(
      certificationAge({
        content_ratings: {
          results: [
            { iso_3166_1: 'US', rating: 'TV-Y7' },
            { iso_3166_1: 'RU', rating: '12+' },
          ],
        },
      } as TmdbTv),
    ).toBe(12)
  })
})
