import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MINE_VIEW,
  gridWindow,
  isFiltered,
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
  it('держит строки вокруг фокусной и не выходит за края', () => {
    expect(gridWindow(0, 100, 4, 3, 5)).toEqual({ from: 0, to: 24 })
    expect(gridWindow(41, 100, 4, 3, 5)).toEqual({ from: 28, to: 64 })
    expect(gridWindow(98, 100, 4, 3, 5)).toEqual({ from: 84, to: 100 })
  })
})
