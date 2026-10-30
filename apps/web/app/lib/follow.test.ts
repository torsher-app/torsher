import { describe, expect, it } from 'vitest'
import { followStatusKey } from './follow'

const series = { kind: 'series', mode: 'download' } as const
const movie = { kind: 'movie', mode: 'download' } as const
const first = { season: 2, episode: 6 }

describe('followStatusKey', () => {
  it('одна серия — строкой с кодом, несколько — с числом, 21 тоже', () => {
    expect(
      followStatusKey(series, { status: 'searching', count: 1, first }),
    ).toBe('panel.follow.status.series.searching')
    expect(
      followStatusKey(series, { status: 'missing', count: 2, first }),
    ).toBe('panel.follow.status.series.missingMany')
    expect(
      followStatusKey(series, { status: 'noSpace', count: 21, first }),
    ).toBe('panel.follow.status.series.noSpaceMany')
  })

  it('у фильма — свои строки без кода', () => {
    expect(followStatusKey(movie, { status: 'missing', count: 1, first })).toBe(
      'panel.follow.status.movie.missing',
    )
  })

  it('состояние без серии и «всё готово» в режиме уведомлений', () => {
    expect(followStatusKey(series, { status: 'unsure', count: 3 })).toBe(
      'panel.follow.status.series.unsure',
    )
    expect(
      followStatusKey(
        { kind: 'series', mode: 'notify' },
        { status: 'done', count: 0 },
      ),
    ).toBe('panel.follow.status.series.doneNotify')
  })
})
