import { describe, expect, it } from 'vitest'
import {
  logos,
  movie,
  movieList,
  searchResponse,
  trendingAll,
  tv,
} from './fixtures/index.ts'
import {
  listResultToCard,
  movieToDetails,
  parseCatalogId,
  pickLogo,
  searchResultToCard,
  toCatalogId,
  tvToDetails,
} from './mappers.ts'

describe('каталожный ID', () => {
  it('разбирается обратно', () => {
    expect(parseCatalogId(toCatalogId('tv', 1396))).toEqual({
      type: 'tv',
      tmdbId: 1396,
    })
  })

  it.each(['603', 'tmdb:person:1', 'tmdb:movie:', 'tmdb:movie:1x'])(
    'отвергает %s',
    (id) => {
      expect(parseCatalogId(id)).toBeUndefined()
    },
  )
})

describe('searchResultToCard', () => {
  const cards = searchResponse.results.map(searchResultToCard)

  it('собирает карточку фильма', () => {
    expect(cards[0]).toEqual({
      id: 'tmdb:movie:603',
      kind: 'movie',
      title: 'Матрица',
      originalTitle: 'The Matrix',
      year: 1999,
      poster: '/img/w342/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
    })
  })

  it('собирает карточку сериала без постера', () => {
    expect(cards[1]).toEqual({
      id: 'tmdb:tv:1396',
      kind: 'series',
      title: 'Во все тяжкие',
      originalTitle: 'Breaking Bad',
      year: 2008,
      poster: undefined,
    })
  })

  it('отбрасывает персоны', () => {
    expect(cards[2]).toBeUndefined()
  })

  it('оставляет год пустым без даты выхода', () => {
    expect(cards[3]?.year).toBeUndefined()
  })
})

describe('listResultToCard', () => {
  it('берёт тип из media_type в трендах', () => {
    expect(listResultToCard(trendingAll.results[1]!)?.id).toBe('tmdb:tv:1396')
    expect(listResultToCard(trendingAll.results[2]!)).toBeUndefined()
  })

  it('берёт тип списка, если media_type нет', () => {
    expect(listResultToCard(movieList.results[0]!, 'movie')).toMatchObject({
      id: 'tmdb:movie:100',
      kind: 'movie',
      title: 'Фильм 1',
    })
    expect(listResultToCard(movieList.results[0]!)).toBeUndefined()
  })
})

describe('pickLogo', () => {
  it('предпочитает логотип на языке интерфейса с лучшей оценкой, только PNG', () => {
    expect(pickLogo(logos, 'ru-RU')).toBe('/img/w500/ruLogo.png')
  })

  it('без перевода берёт логотип без текста, затем английский', () => {
    expect(pickLogo(logos, 'de-DE')).toBe('/img/w500/neutralLogo.png')
    expect(
      pickLogo(
        logos.filter(logo => logo.iso_639_1 !== null),
        'de-DE',
      ),
    ).toBe('/img/w500/enLogo.png')
  })

  it('без логотипов — undefined', () => {
    expect(pickLogo(undefined, 'en-US')).toBeUndefined()
    expect(pickLogo([], 'en-US')).toBeUndefined()
  })
})

describe('movieToDetails', () => {
  it('собирает карточку фильма', () => {
    expect(movieToDetails(movie)).toEqual({
      id: 'tmdb:movie:603',
      kind: 'movie',
      title: 'Матрица',
      originalTitle: 'The Matrix',
      year: 1999,
      poster: '/img/w342/p96dm7sCMn4VYAStA6siNz30G1r.jpg',
      backdrop: '/img/w1280/tlm8UkiQsitc8rSuIAscQDCnP8d.jpg',
      overview: 'Хакер Нео узнаёт правду о реальности.',
      genres: ['боевик', 'фантастика'],
      runtime: 136,
      rating: 8.2,
    })
  })
})

describe('логотип в деталях', () => {
  it('выбирается по языку запроса', () => {
    expect(movieToDetails({ ...movie, images: { logos } }, 'ru-RU').logo).toBe(
      '/img/w500/ruLogo.png',
    )
    expect(tvToDetails({ ...tv, images: { logos } }, 'en-US').logo).toBe(
      '/img/w500/enLogo.png',
    )
  })
})

describe('tvToDetails', () => {
  const details = tvToDetails(tv)

  it('пропускает спецвыпуски и берёт год сезона из даты', () => {
    expect(details.seasons).toEqual([
      { number: 1, name: 'Сезон 1', episodeCount: 7, year: 2008 },
      { number: 2, name: 'Сезон 2', episodeCount: 13, year: undefined },
    ])
  })

  it('не показывает рейтинг без голосов и бэкдроп без картинки', () => {
    expect(details.rating).toBeUndefined()
    expect(details.backdrop).toBeUndefined()
    expect(details.runtime).toBeUndefined()
  })
})
