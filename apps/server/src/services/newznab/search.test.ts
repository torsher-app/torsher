import { describe, expect, it } from 'vitest'
import { newznabRequests } from './search.ts'

const identity = {
  kind: 'series',
  tmdbId: 12,
  imdbId: 'tt0000012',
  tvdbId: 24,
  names: [],
} as const
const base = {
  search: { available: true, params: ['q'] },
  movieSearch: { available: false, params: [] },
  tvSearch: { available: true, params: ['tvdbid', 'season', 'ep'] },
  categories: [{ id: 5000, name: 'TV', subcategories: [] }],
}
const target = { titleId: 'tmdb:tv:12', season: 2, episode: 3 }

describe('newznabRequests', () => {
  it('uses supported identifiers and episode filters', () => {
    expect(
      newznabRequests(base, { ...identity, names: [] }, target, ['Fixture']),
    ).toEqual([
      {
        t: 'tvsearch',
        tvdbid: '24',
        season: '2',
        ep: '3',
        limit: '50',
        cat: '5000',
      },
      { t: 'search', q: 'Fixture', limit: '50', cat: '5000' },
    ])
  })

  it('uses text only when no identifier was advertised', () => {
    expect(
      newznabRequests(
        { ...base, tvSearch: { available: true, params: ['ep'] } },
        {
          ...identity,
          names: [],
        },
        target,
        ['Fixture'],
      ),
    ).toEqual([{ t: 'search', q: 'Fixture', limit: '50', cat: '5000' }])
  })
})
