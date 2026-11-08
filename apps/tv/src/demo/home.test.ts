import type { HomeResponse } from '@torsher/api-client'
import { handle } from '@torsher/demo/router'
import { DAY } from '@torsher/demo/state'
import { titleNamed } from '@torsher/demo/titles'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { libraryFilesOf, libraryTitleIds } from './library.ts'
import { collections } from './viewer.ts'
import './handlers/home.ts'

const clock = vi.hoisted(() => {
  vi.useFakeTimers()
  return { now: Date.now() }
})
afterEach(() => vi.setSystemTime(clock.now))
afterAll(() => vi.useRealTimers())

async function home(mode = 'all') {
  const response = await handle(
    new URL(`http://demo/api/home?mode=${mode}`),
    { method: 'GET' },
    'Unavailable',
  )
  expect(response.status).toBe(200)
  return (await response.json()) as HomeResponse
}

describe('demo home priorities', () => {
  it('puts intentions before recent library additions, collections and discovery', async () => {
    const { rows } = await home()
    expect(rows.map(row => row.id)).toEqual([
      'continue',
      'newEpisodes',
      'watchlist',
      'libraryRecent',
      'collection',
      'collection',
      'trending',
      'popularMovies',
      'popularSeries',
      'themeSpace',
      'topRatedMovies',
    ])
    const recent = rows.find(row => row.id === 'libraryRecent')!
    expect(recent.title).toBe('home.rows.libraryRecentlyAdded')
    expect(
      recent.items.map(item => ('id' in item ? item.id : undefined)),
    ).toEqual(
      [
        'Saltwater Lullaby',
        'Big Buck Bunny',
        'Tears of Steel',
        'Lanterns of Vell',
        'The Quiet Orchard',
        'Winter in Tolvar',
      ].map(name => titleNamed(name).id),
    )
    expect(
      rows
        .filter(row => row.id === 'collection')
        .map(row => 'ref' in row && row.ref),
    ).toEqual(
      collections
        .filter(item => item.showOnHome)
        .map(item => ('id' in item ? item.id : undefined)),
    )
  })
  it('includes the exact 30-day boundary then drops it without removing the title from the library', async () => {
    const boundary = titleNamed('Winter in Tolvar').id
    const stale = titleNamed('Paper Comets').id
    expect(libraryTitleIds(clock.now - 30 * DAY * 1000)).toContain(boundary)
    expect(libraryTitleIds(clock.now - 30 * DAY * 1000)).not.toContain(stale)
    vi.setSystemTime(clock.now + 1)
    const { rows } = await home()
    expect(
      rows
        .find(row => row.id === 'libraryRecent')!
        .items.map(item => ('id' in item ? item.id : undefined)),
    ).not.toContain(boundary)
    expect(libraryTitleIds()).toContain(boundary)
    expect(libraryTitleIds()).toContain(stale)
  })
  it('hides an empty recent shelf when all additions have aged out', async () => {
    vi.setSystemTime(clock.now + 31 * DAY * 1000)
    expect((await home()).rows.some(row => row.id === 'libraryRecent')).toBe(
      false,
    )
  })
  it.each(['movies', 'series'])(
    'keeps personal and library shelves out of %s',
    async (mode) => {
      const { rows } = await home(mode)
      expect(rows[0]?.id).toBe('continue')
      expect(
        rows.some(row =>
          ['watchlist', 'newEpisodes', 'libraryRecent', 'collection'].includes(
            row.id,
          ),
        ),
      ).toBe(false)
      expect(rows[1]?.id).toBe(
        mode === 'movies' ? 'trendingMovies' : 'trendingSeries',
      )
    },
  )
  it('keeps the library section and its old titles, and does not leak fixture timestamps into file responses', async () => {
    const { rows } = await home('library')
    expect(rows.map(row => row.id)).toEqual([
      'libraryRecent',
      'libraryMovies',
      'librarySeries',
    ])
    expect(rows[0]?.title).toBe('home.rows.libraryRecent')
    const id = titleNamed('Paper Comets').id
    expect(
      rows
        .find(row => row.id === 'libraryMovies')!
        .items.map(item => ('id' in item ? item.id : undefined)),
    ).toContain(id)
    const files = libraryFilesOf(id)
    expect(files).toHaveLength(1)
    expect(files[0]).not.toHaveProperty('addedAt')
    expect(files[0]).not.toHaveProperty('titleId')
    expect(files[0]).not.toHaveProperty('name')
  })
})
