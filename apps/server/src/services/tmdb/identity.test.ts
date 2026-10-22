import { describe, expect, it } from 'vitest'
import { movieIdentity, tvIdentity } from './fixtures/index.ts'
import { identityOf, trimIdentity } from './identity.ts'

describe('identityOf', () => {
  it('сериал: русское название первым, без повторов и чужих письменностей', () => {
    expect(
      identityOf(trimIdentity(tvIdentity), { type: 'tv', tmdbId: 101 }),
    ).toEqual({
      kind: 'series',
      tmdbId: 101,
      imdbId: 'tt0000001',
      tvdbId: 202,
      year: 2023,
      endYear: 2025,
      originalLanguage: 'en',
      names: [
        { value: 'Тихая гавань', lang: 'ru', kind: 'official' },
        { value: 'Quiet Harbor', lang: 'en', kind: 'original' },
        { value: 'Тихая гавань: Сезоны', lang: null, kind: 'alternative' },
      ],
    })
  })

  it('сериал: число серий по сезонам, пустые сезоны пропускает', () => {
    const response = trimIdentity({
      ...tvIdentity,
      seasons: [
        { season_number: 0, episode_count: 0 },
        { season_number: 1, episode_count: 8 },
        { season_number: 2, episode_count: 10 },
      ],
    })

    expect(
      identityOf(response, { type: 'tv', tmdbId: 101 }).episodeCounts,
    ).toEqual({ 1: 8, 2: 10 })
  })

  it('фильм: оригинальное и английское названия, год выхода', () => {
    expect(
      identityOf(trimIdentity(movieIdentity), { type: 'movie', tmdbId: 303 }),
    ).toEqual({
      kind: 'movie',
      tmdbId: 303,
      imdbId: 'tt0000002',
      tvdbId: undefined,
      year: 2021,
      endYear: undefined,
      originalLanguage: 'fr',
      names: [
        { value: 'Бумажный фонарь', lang: 'ru', kind: 'official' },
        { value: 'Le Lampion', lang: 'fr', kind: 'original' },
        { value: 'The Paper Lantern', lang: 'en', kind: 'official' },
      ],
    })
  })

  it('кэш хранит только названия переводов нужных языков', () => {
    expect(trimIdentity(tvIdentity).translations).toEqual({
      translations: [
        {
          iso_639_1: 'ru',
          iso_3166_1: 'RU',
          data: { title: undefined, name: 'Тихая гавань' },
        },
        {
          iso_639_1: 'en',
          iso_3166_1: 'US',
          data: { title: undefined, name: '' },
        },
      ],
    })
  })
})
