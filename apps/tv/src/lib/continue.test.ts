import type { ContinueRow, HomeRow } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import {
  continueOrder,
  episodeCode,
  hoursMinutes,
  remainingSeconds,
  replaceContinueRow,
  resumeRoute,
  watchedShare,
} from './continue.ts'

const started = {
  season: 2,
  episode: 5,
  position: 1800,
  duration: 3000,
  next: false,
  file: { torrentId: 't1', fileIndex: 4 },
}

function continueRow(ids: string[]): ContinueRow {
  return {
    id: 'continue',
    kind: 'continue',
    title: 'home.rows.continue',
    items: ids.map(id => ({
      id,
      kind: 'series',
      title: id,
      originalTitle: id,
      ...started,
    })),
  }
}

const catalog: HomeRow = {
  id: 'trending',
  kind: 'top10',
  title: 'home.rows.trending',
  items: [],
}

describe('подписи', () => {
  it('серия, доля и остаток', () => {
    expect(episodeCode(2, 5)).toBe('S2E5')
    expect(episodeCode(null, null)).toBe('')
    expect(watchedShare(started)).toBe(0.6)
    expect(watchedShare({ ...started, next: true })).toBe(0)
    expect(remainingSeconds(started)).toBe(1200)
    expect(remainingSeconds({ ...started, duration: null })).toBeNull()
  })

  it('минуты вверх, не меньше одной', () => {
    expect(hoursMinutes(20)).toEqual({ hours: 0, minutes: 1 })
    expect(hoursMinutes(4320)).toEqual({ hours: 1, minutes: 12 })
  })
})

describe('resumeRoute', () => {
  it('известный файл — сразу плеер с серией', () => {
    expect(resumeRoute('tmdb:tv:1', started)).toEqual({
      path: '/play/t1/4',
      query: { title: 'tmdb:tv:1', season: '2', episode: '5' },
    })
  })

  it('без файла — подготовка, фильм — «Источники»', () => {
    expect(resumeRoute('tmdb:tv:1', { ...started, file: null })).toEqual({
      path: '/title/tmdb:tv:1/play',
      query: { season: '2', episode: '5', torrent: undefined },
    })
    expect(
      resumeRoute('tmdb:movie:2', {
        ...started,
        season: null,
        episode: null,
        file: null,
      }),
    ).toEqual({ path: '/title/tmdb:movie:2/sources' })
  })
})

describe('replaceContinueRow', () => {
  it('ряд встаёт первым, пустой убирается', () => {
    const fresh = continueRow(['a'])

    expect(replaceContinueRow([catalog], fresh)).toEqual([fresh, catalog])
    expect(replaceContinueRow([fresh, catalog], continueRow([]))).toEqual([
      catalog,
    ])
  })

  it('без изменений — тот же массив', () => {
    const rows = [continueRow(['a', 'b']), catalog]

    expect(replaceContinueRow(rows, continueRow(['a', 'b']))).toBe(rows)
    expect(
      continueOrder(replaceContinueRow(rows, continueRow(['b', 'a']))),
    ).toBe('b,a')
  })
})
