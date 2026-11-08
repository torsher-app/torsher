import type { Card } from '../dto/catalog.ts'
import type { CatalogRow, ContinueRow } from '../dto/home.ts'
import Fastify from 'fastify'
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../db/index.ts'
import {
  libraries,
  libraryFolders,
  libraryHiddenProfiles,
  mediaFiles,
  profiles,
} from '../db/schema.ts'
import { homeRoutes } from './home.ts'

const mocks = vi.hoisted(() => ({
  personal: vi.fn(),
  resume: vi.fn(),
  catalog: vi.fn(),
  ratings: vi.fn((items: Card[]) => items),
}))
vi.mock('../middleware/auth.ts', () => ({
  requireViewer: async (request: { profileId: string }) => {
    request.profileId = 'home-profile'
  },
  canManageLibrary: () => true,
}))
vi.mock('../services/mine/home.ts', () => ({
  personalHomeRows: mocks.personal,
}))
vi.mock('../services/sources/continue.ts', () => ({
  getContinueRow: mocks.resume,
}))
vi.mock('../services/mine/index.ts', () => ({
  withPosterRatings: mocks.ratings,
}))
vi.mock('../services/mine/cards.ts', () => ({
  cardsOf: async (ids: string[]) =>
    ids.map(id => ({
      id,
      kind: id.includes(':tv:') ? 'series' : 'movie',
      title: id,
      originalTitle: id,
    })),
}))
vi.mock('../services/tmdb/index.ts', async original => ({
  ...(await original<typeof import('../services/tmdb/index.ts')>()),
  getHomeRows: mocks.catalog,
}))
vi.mock('../services/library/unmatched.ts', () => ({
  unmatchedReleases: async () => [],
}))

const app = Fastify()
app.setValidatorCompiler(validatorCompiler)
app.setSerializerCompiler(serializerCompiler)
app.register(homeRoutes, { prefix: '/api/home' })
const NOW = Date.UTC(2026, 10, 8, 12)
const DAY = 24 * 60 * 60 * 1000
const card: Card = {
  id: 'tmdb:movie:900001',
  kind: 'movie',
  title: 'Home test',
  originalTitle: 'Home test',
}
function row(id: CatalogRow['id']): CatalogRow {
  return {
    id,
    kind: 'posters',
    title: `home.rows.${id}`,
    items: [card],
  }
}
const resume: ContinueRow = {
  id: 'continue',
  kind: 'continue',
  title: 'home.rows.continue',
  items: [
    {
      ...card,
      season: null,
      episode: null,
      position: 900,
      duration: 3600,
      next: false,
      file: null,
    },
  ],
}

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(profiles)
    .values({ id: 'home-profile', name: 'Home', color: 'violet' })
    .run()
  getDb()
    .insert(libraries)
    .values([
      { id: 'visible', kind: 'video', name: 'Visible' },
      { id: 'hidden', kind: 'video', name: 'Hidden' },
    ])
    .run()
  getDb()
    .insert(libraryFolders)
    .values([
      {
        id: 'visible-folder',
        libraryId: 'visible',
        path: '/home-test/visible',
      },
      { id: 'hidden-folder', libraryId: 'hidden', path: '/home-test/hidden' },
    ])
    .run()
  getDb()
    .insert(libraryHiddenProfiles)
    .values({ libraryId: 'hidden', profileId: 'home-profile' })
    .run()
})
beforeEach(() => {
  vi.spyOn(Date, 'now').mockReturnValue(NOW)
  mocks.personal.mockResolvedValue([
    {
      ...row('newEpisodes'),
      kind: 'episodes',
      items: [],
      episodes: [
        {
          titleId: 'tmdb:tv:900002',
          title: 'Series',
          season: 1,
          episode: 2,
          airDate: '2026-11-08',
          newCount: 1,
        },
      ],
    },
    row('watchlist'),
    { ...row('collection'), ref: 'first', name: 'First' },
    { ...row('collection'), ref: 'second', name: 'Second' },
  ])
  mocks.resume.mockResolvedValue(resume)
  mocks.catalog.mockResolvedValue([row('trending'), row('popularMovies')])
  mocks.ratings.mockClear()
  getDb().delete(mediaFiles).run()
})
afterEach(() => vi.restoreAllMocks())

function file(
  id: number,
  age: number,
  extra: Partial<typeof mediaFiles.$inferInsert> = {},
) {
  getDb()
    .insert(mediaFiles)
    .values({
      id: `file-${id}`,
      titleId: `tmdb:movie:${id}`,
      folderId: 'visible-folder',
      relPath: `${id}.mkv`,
      size: 100,
      mtime: new Date(NOW),
      addedAt: new Date(NOW - age),
      ...extra,
    })
    .run()
}
async function home(mode = 'all') {
  const response = await app.inject(`/api/home?mode=${mode}&language=ru-RU`)
  expect(response.statusCode).toBe(200)
  return response.json().rows
}

describe('home viewing priorities', () => {
  it('orders all own and discovery rows, keeps the 30-day boundary and newest visible present files', async () => {
    file(1, 1 * DAY)
    file(2, 30 * DAY)
    file(3, 30 * DAY + 1)
    file(4, 0, { folderId: 'hidden-folder' })
    file(5, 0, { state: 'missing' })
    file(6, 2 * DAY, { titleId: 'tmdb:tv:6' })
    // A newer file refreshes the same title without duplicating its poster.
    file(7, 0, { titleId: 'tmdb:movie:1' })
    const rows = await home()
    expect(rows.map((item: CatalogRow) => item.id)).toEqual([
      'continue',
      'newEpisodes',
      'watchlist',
      'libraryRecent',
      'collection',
      'collection',
      'trending',
      'popularMovies',
    ])
    expect(rows[3].title).toBe('home.rows.libraryRecentlyAdded')
    expect(rows[3].items.map((item: Card) => item.id)).toEqual([
      'tmdb:movie:1',
      'tmdb:tv:6',
      'tmdb:movie:2',
    ])
    expect(
      rows
        .filter((item: CatalogRow) => item.id === 'collection')
        .map((item: CatalogRow) => item.ref),
    ).toEqual(['first', 'second'])
    expect(mocks.ratings).toHaveBeenCalledTimes(7)
  })
  it('keeps the existing 20-title shelf limit with the most recently added first', async () => {
    for (let id = 1; id <= 22; id++) file(id, id * DAY)
    const rows = await home()
    const recent = rows.find((item: CatalogRow) => item.id === 'libraryRecent')
    expect(recent.items.map((item: Card) => item.id)).toEqual(
      Array.from({ length: 20 }, (_, index) => `tmdb:movie:${index + 1}`),
    )
  })
  it('hides an empty or entirely old recent shelf and empty personal/continue rows', async () => {
    mocks.personal.mockResolvedValue([])
    mocks.resume.mockResolvedValue({ ...resume, items: [] })
    expect((await home()).map((item: CatalogRow) => item.id)).toEqual([
      'trending',
      'popularMovies',
    ])
    file(3, 31 * DAY)
    expect((await home()).map((item: CatalogRow) => item.id)).toEqual([
      'trending',
      'popularMovies',
    ])
  })
  it.each(['movies', 'series'])(
    'keeps %s free of home-only rows',
    async (mode) => {
      file(1, DAY)
      mocks.personal.mockClear()
      expect((await home(mode)).map((item: CatalogRow) => item.id)).toEqual([
        'continue',
        'trending',
        'popularMovies',
      ])
      expect(mocks.personal).not.toHaveBeenCalled()
      expect(mocks.catalog).toHaveBeenLastCalledWith(mode, 'ru-RU')
    },
  )
  it('keeps the library mode order and old titles in its full movie/series rows', async () => {
    file(1, DAY)
    file(2, 31 * DAY)
    file(3, 32 * DAY, { titleId: 'tmdb:tv:3' })
    mocks.catalog.mockClear()
    const rows = await home('library')
    expect(rows.map((item: CatalogRow) => item.id)).toEqual([
      'continue',
      'libraryRecent',
      'libraryMovies',
      'librarySeries',
    ])
    expect(rows[1].title).toBe('home.rows.libraryRecent')
    expect(rows[2].items.map((item: Card) => item.id)).toEqual([
      'tmdb:movie:1',
      'tmdb:movie:2',
    ])
    expect(rows[3].items[0].id).toBe('tmdb:tv:3')
    expect(mocks.catalog).not.toHaveBeenCalled()
  })
  it('keeps successful rows when personal and catalog requests fail', async () => {
    file(1, DAY)
    mocks.personal.mockRejectedValue(new Error('Personal failed'))
    mocks.catalog.mockRejectedValue(new Error('Catalog failed'))
    expect((await home()).map((item: CatalogRow) => item.id)).toEqual([
      'continue',
      'libraryRecent',
    ])
  })
})
