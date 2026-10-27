import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINE_VIEW,
  gridWindow,
  isFiltered,
  mineQueryOf,
  mineTargetOf,
  pageTarget,
  parseMineTarget,
  parseMineView,
  sectionKey,
} from './mineView.ts'

describe('parseMineView', () => {
  it('читает сохранённый вид и откатывает незнакомые значения', () => {
    expect(
      parseMineView('{"sort":"rating","kind":"movie","rating":"9-10"}'),
    ).toEqual({
      sort: 'rating',
      kind: 'movie',
      rating: '9-10',
    })
    expect(parseMineView('{"sort":"title","kind":"anime"}')).toEqual(
      DEFAULT_MINE_VIEW,
    )
    expect(parseMineView('не json')).toEqual(DEFAULT_MINE_VIEW)
    expect(parseMineView(null)).toEqual(DEFAULT_MINE_VIEW)
  })
})

describe('sectionKey и isFiltered', () => {
  it('у подборки ключ свой, сортировка фильтром не считается', () => {
    expect(sectionKey({ id: 'collection', collectionId: 'c1' })).toBe(
      'collection:c1',
    )
    expect(sectionKey({ id: 'watchlist' })).toBe('watchlist')
    expect(isFiltered({ ...DEFAULT_MINE_VIEW, sort: 'rating' })).toBe(false)
    expect(isFiltered({ ...DEFAULT_MINE_VIEW, rating: 'rated' })).toBe(true)
  })
})

describe('gridWindow', () => {
  it('держит строки вокруг опорных и не выходит за края', () => {
    const at = (row: number) => ({ first: row, last: row })

    expect(gridWindow(at(0), 100, 4, 3, 5)).toEqual({ from: 0, to: 24 })
    expect(gridWindow(at(10), 100, 4, 3, 5)).toEqual({ from: 28, to: 64 })
    expect(gridWindow(at(24), 100, 4, 3, 5)).toEqual({ from: 84, to: 100 })
    expect(gridWindow({ first: 2, last: 6 }, 100, 4, 3, 5)).toEqual({
      from: 0,
      to: 48,
    })
  })
})

describe('mineTargetOf', () => {
  const card = {
    id: 'tmdb:movie:1',
    kind: 'movie',
    title: 'A',
    originalTitle: 'A',
  } as const
  const poster = (extra: object) => ({
    id: 'watchlist' as const,
    kind: 'posters' as const,
    title: 'home.rows.watchlist',
    items: [card],
    ...extra,
  })

  it('ведёт в раздел ряда, только когда за рядом что-то осталось', () => {
    expect(mineTargetOf(poster({ total: 5 }), 'all')).toEqual({
      key: 'watchlist',
    })
    expect(mineTargetOf(poster({ total: 1 }), 'all')).toBeUndefined()
    expect(mineTargetOf(poster({}), 'all')).toBeUndefined()
  })

  it('подборка — по своему ключу, тип — по режиму главной', () => {
    expect(
      mineTargetOf(poster({ id: 'collection', ref: 'c1', total: 3 }), 'all'),
    ).toEqual({ key: 'collection:c1' })
    expect(
      mineTargetOf(
        {
          id: 'continue',
          kind: 'continue',
          title: 'home.rows.continue',
          items: [],
          total: 2,
        },
        'series',
      ),
    ).toEqual({ key: 'continue', kind: 'series' })
  })

  it('ряды каталога и библиотеки никуда не ведут', () => {
    expect(
      mineTargetOf(poster({ id: 'popularMovies', total: 99 }), 'all'),
    ).toBeUndefined()
    expect(
      mineTargetOf(poster({ id: 'libraryMovies', total: 99 }), 'all'),
    ).toBeUndefined()
  })
})

describe('parseMineTarget и mineQueryOf', () => {
  it('читают друг друга, незнакомый тип отбрасывается', () => {
    const target = { key: 'collection:c1', kind: 'movie' } as const

    expect(parseMineTarget(mineQueryOf(target))).toEqual(target)
    expect(parseMineTarget({ section: 'continue', kind: 'anime' })).toEqual({
      key: 'continue',
    })
    expect(parseMineTarget({})).toBeUndefined()
  })
})

describe('pageTarget', () => {
  it('шагает на экран в той же колонке и упирается в края', () => {
    expect(pageTarget(1, 100, 4, 2, 'down')).toBe(9)
    expect(pageTarget(9, 100, 4, 2, 'up')).toBe(1)
    expect(pageTarget(5, 100, 4, 2, 'up')).toBe(0)
    expect(pageTarget(95, 100, 4, 2, 'down')).toBe(99)
    expect(pageTarget(0, 0, 4, 2, 'down')).toBe(0)
  })
})
