import { describe, expect, it } from 'vitest'
import {
  discoverParams,
  filterOf,
  isChanged,
  queryOf,
  recentYears,
  withType,
} from './catalogFilter.ts'

describe('filterOf', () => {
  it('пустой query — фильтр по умолчанию', () => {
    expect(filterOf({})).toEqual({ type: 'movies', sort: 'popularity' })
  })

  it('читает все значения', () => {
    expect(
      filterOf({
        type: 'series',
        genre: '18',
        genreName: 'Драма',
        decade: '1990',
        rating: '7',
        lang: 'ko',
        country: 'KR',
        keyword: '9882',
        keywordName: 'Space',
        studio: 'network:49',
        studioName: 'HBO',
        sort: 'date',
      }),
    ).toEqual({
      type: 'series',
      genre: { id: '18', name: 'Драма' },
      decade: 1990,
      rating: { source: 'tmdb', min: 7 },
      language: 'ko',
      country: 'KR',
      keyword: { id: '9882', name: 'Space' },
      studio: { id: 'network:49', name: 'HBO' },
      sort: 'date',
    })
  })

  it('отбрасывает непонятное', () => {
    expect(
      filterOf({
        type: 'documentaries',
        genre: 'drama',
        decade: '1995',
        rating: '10',
        lang: 'xx',
        country: 'ZZ',
        studio: '49',
        sort: 'random',
      }),
    ).toEqual({ type: 'movies', sort: 'popularity' })
  })

  it('тег без имени подписывается ID', () => {
    expect(filterOf({ keyword: '9882' }).keyword).toEqual({
      id: '9882',
      name: '9882',
    })
  })

  it('канал у фильмов, язык и «Анимация» у аниме, десятилетие с годом — отбрасываются', () => {
    expect(
      filterOf({ studio: 'network:49', year: '2020', decade: '2020' }),
    ).toEqual({ type: 'movies', year: 2020, sort: 'popularity' })
    expect(filterOf({ type: 'anime', lang: 'en', genre: '16' })).toEqual({
      type: 'anime',
      sort: 'popularity',
    })
  })
})

describe('queryOf', () => {
  it('умолчания не пишет, круг сохраняет фильтр', () => {
    const query = {
      type: 'series',
      genre: '18',
      genreName: 'Драма',
      year: '2024',
      rating: '8',
      keyword: '9882',
      keywordName: 'Space',
      sort: 'rating',
    }

    expect(queryOf(filterOf(query))).toEqual(query)
    expect(queryOf(filterOf({}))).toEqual({})
    expect(queryOf(filterOf({ type: 'cartoons' }))).toEqual({
      type: 'cartoons',
    })
  })
})

describe('discoverParams', () => {
  it('параметры запроса без пустых полей', () => {
    expect(
      discoverParams(
        filterOf({ rating: '6', lang: 'ja', studio: 'company:3' }),
      ),
    ).toEqual({
      type: 'movies',
      rating: 6,
      originalLanguage: 'ja',
      studio: 'company:3',
      sort: 'popularity',
    })
  })
})

describe('isChanged', () => {
  it('сброс виден, когда фильтр отличается от умолчания', () => {
    expect(isChanged(filterOf({}))).toBe(false)
    expect(isChanged(filterOf({ type: 'anime' }))).toBe(true)
    expect(isChanged(filterOf({ sort: 'date' }))).toBe(true)
  })
})

describe('withType', () => {
  it('фильмы → сериалы сбрасывает жанр и канал остаётся только у сериалов', () => {
    const series = filterOf({
      type: 'series',
      genre: '18',
      studio: 'network:49',
    })

    expect(withType(series, 'cartoonSeries')).toMatchObject({
      genre: { id: '18', name: '18' },
    })
    expect(withType(series, 'movies')).toEqual({
      type: 'movies',
      sort: 'popularity',
    })
  })
})

describe('recentYears', () => {
  it('текущий год и четыре прошлых', () => {
    expect(recentYears(new Date(2026, 9, 23))).toEqual([
      2026,
      2025,
      2024,
      2023,
      2022,
    ])
  })
})
