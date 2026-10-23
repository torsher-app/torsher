import type { ActiveDownload } from './downloadSlot.ts'
import { describe, expect, it } from 'vitest'
import { downloadSlot } from './downloadSlot.ts'

function active(
  phase: ActiveDownload['phase'],
  seasons: number[] = [],
): ActiveDownload {
  return {
    torrentId: `${phase}:${seasons.join(',')}`,
    phase,
    seasons,
    progress: 0.45,
    release: null,
    peers: { connected: 0, found: 0 },
    speed: 0,
    stalled: false,
  }
}

const movie = {
  series: false,
  downloads: [],
  movieInLibrary: false,
  seasonInLibrary: 0,
  seasonAired: 0,
}

const show = {
  series: true,
  season: 2,
  downloads: [],
  movieInLibrary: false,
  seasonInLibrary: 0,
  seasonAired: 8,
}

describe('слот загрузки на карточке', () => {
  it('фильм: нет — «Скачать», качается — закачка, в библиотеке — кнопки нет', () => {
    expect(downloadSlot(movie)).toEqual({ kind: 'start' })
    expect(
      downloadSlot({ ...movie, downloads: [active('downloading')] }),
    ).toMatchObject({ kind: 'active', download: { phase: 'downloading' } })
    expect(downloadSlot({ ...movie, movieInLibrary: true })).toEqual({
      kind: 'none',
    })
  })

  it('сериал: пусто и частично — «Скачать сезон», весь сезон — кнопки нет', () => {
    expect(downloadSlot(show)).toEqual({ kind: 'start' })
    expect(downloadSlot({ ...show, seasonInLibrary: 3 })).toEqual({
      kind: 'start',
    })
    expect(downloadSlot({ ...show, seasonInLibrary: 8 })).toEqual({
      kind: 'none',
    })
  })

  it('закачка другого сезона кнопку выбранного не трогает', () => {
    expect(
      downloadSlot({ ...show, downloads: [active('downloading', [1])] }),
    ).toEqual({ kind: 'start' })
    expect(
      downloadSlot({ ...show, downloads: [active('downloading', [1, 2, 3])] }),
    ).toMatchObject({ kind: 'active' })
    expect(
      downloadSlot({ ...show, downloads: [active('placing', [])] }),
    ).toMatchObject({ kind: 'active' })
  })

  it('из нескольких закачек сезона — та, что ещё качается', () => {
    expect(
      downloadSlot({
        ...show,
        downloads: [active('unmatched', [2]), active('downloading', [2])],
      }),
    ).toMatchObject({ kind: 'active', download: { phase: 'downloading' } })
  })

  it('сезон без вышедших серий не считается скачанным', () => {
    expect(downloadSlot({ ...show, seasonAired: 0 })).toEqual({
      kind: 'start',
    })
  })
})
