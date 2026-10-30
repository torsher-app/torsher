import type { ScheduleItem, TitleFollow } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import {
  episodesStatusKey,
  followNote,
  followStatus,
  isFollowed,
  qualityName,
  relativeDay,
  scheduleDays,
  untilDay,
  voiceChoices,
  waitChoices,
  waitingStatusKey,
} from './follow.ts'

function follow(patch: Partial<TitleFollow> = {}): TitleFollow {
  return {
    id: 'f1',
    kind: 'series',
    state: 'active',
    start: { season: 3, episode: 1 },
    voiceStudio: null,
    voiceStrict: false,
    requireRussian: true,
    waitHours: 24,
    qualityPreset: 'best',
    mode: 'download',
    audio: null,
    audioEffective: 'ru',
    audioServer: 'ru',
    next: null,
    subscribed: true,
    profileCount: 1,
    season: 3,
    voice: null,
    quality: { value: '1080p', lowered: false },
    waiting: null,
    counts: { downloading: 0, noSpace: 0, missing: 0, searching: 0, ready: 0 },
    first: {},
    ready: null,
    ...patch,
  }
}

describe('episodesStatusKey', () => {
  it('одна серия — строкой с кодом, несколько — с числом, 21 тоже', () => {
    expect(episodesStatusKey('searching', 1, false)).toBe('searching')
    expect(episodesStatusKey('searching', 2, false)).toBe('searchingMany')
    expect(episodesStatusKey('noSpace', 21, false)).toBe('noSpaceMany')
  })

  it('у фильма — свои строки без кода', () => {
    expect(episodesStatusKey('missing', 1, true)).toBe('movieMissing')
    expect(episodesStatusKey('downloading', 1, true)).toBe('movieDownloading')
  })
})

describe('waitingStatusKey', () => {
  it('знаем, чего ждём, или ждём лучшее; у фильма без кода', () => {
    expect(waitingStatusKey(true, false)).toBe('waiting')
    expect(waitingStatusKey(false, false)).toBe('waitingBetter')
    expect(waitingStatusKey(true, true)).toBe('movieWaiting')
    expect(waitingStatusKey(false, true)).toBe('movieWaitingBetter')
  })
})

describe('waitChoices', () => {
  it('значение из панели вне набора — своей строкой по порядку', () => {
    expect(waitChoices(24)).toEqual([0, 12, 24, 72])
    expect(waitChoices(48)).toEqual([0, 12, 24, 48, 72])
  })
})

describe('isFollowed', () => {
  it('подписан на идущее или приостановленное', () => {
    expect(isFollowed(follow())).toBe(true)
    expect(isFollowed(follow({ state: 'paused' }))).toBe(true)
    expect(isFollowed(follow({ state: 'stopped' }))).toBe(false)
    expect(isFollowed(follow({ subscribed: false }))).toBe(false)
    expect(isFollowed(null)).toBe(false)
  })
})

describe('followStatus', () => {
  const counts = {
    downloading: 2,
    noSpace: 1,
    missing: 1,
    searching: 1,
    ready: 1,
  }
  const waiting = {
    season: 3,
    episode: 4,
    until: '2026-10-25T20:00:00.000Z',
    studio: 'Studio One',
  }
  const first = {
    noSpace: { season: 3, episode: 2 },
    downloading: { season: 3, episode: 3 },
    missing: { season: 3, episode: 5 },
    searching: { season: 3, episode: 6 },
  }

  it('по важности: пауза, место, ждём, качается, не нашли, ищем, следующая', () => {
    expect(followStatus(follow({ state: 'paused', counts }))).toEqual({
      kind: 'paused',
    })
    expect(followStatus(follow({ counts, first, waiting }))).toEqual({
      kind: 'noSpace',
      count: 1,
      code: 'S3E2',
    })
    expect(
      followStatus(
        follow({ counts: { ...counts, noSpace: 0 }, first, waiting }),
      ),
    ).toEqual({ kind: 'waiting', waiting, code: 'S3E4' })
    expect(
      followStatus(follow({ counts: { ...counts, noSpace: 0 }, first })),
    ).toEqual({ kind: 'downloading', count: 2, code: 'S3E3' })
    expect(
      followStatus(
        follow({ counts: { ...counts, noSpace: 0, downloading: 0 }, first }),
      ),
    ).toEqual({ kind: 'missing', count: 1, code: 'S3E5' })
    expect(
      followStatus(
        follow({
          counts: { ...counts, noSpace: 0, downloading: 0, missing: 0 },
          first,
        }),
      ),
    ).toEqual({ kind: 'searching', count: 1, code: 'S3E6' })
  })

  it('готовая серия, которую профиль не досмотрел, — раньше ожидания', () => {
    const ready = { season: 3, episode: 4 }

    expect(
      followStatus(follow({ counts: { ...counts, noSpace: 0 }, ready })),
    ).toEqual({ kind: 'ready', code: 'S3E4' })
    expect(followStatus(follow({ counts, ready }))?.kind).toBe('noSpace')
  })

  it('ничего не нужно — следующая серия с датой, без неё — ничего', () => {
    const next = { season: 3, episode: 5, airDate: '2026-10-30' }

    expect(followStatus(follow({ next }))).toEqual({
      kind: 'next',
      code: 'S3E5',
      airDate: '2026-10-30',
    })
    expect(
      followStatus(follow({ next: { season: 3, episode: 5 } })),
    ).toBeUndefined()
    expect(followStatus(follow())).toBeUndefined()
  })
})

describe('followNote', () => {
  it('опущенный cutoff важнее закреплённой студии', () => {
    const voice = { studio: 'Studio One', pinned: true }

    expect(
      followNote(follow({ voice, quality: { value: '720p', lowered: true } })),
    ).toEqual({ kind: 'bestQuality', quality: '720p' })
    expect(followNote(follow({ voice }))).toEqual({
      kind: 'pinned',
      studio: 'Studio One',
    })
    expect(
      followNote(follow({ voice: { studio: 'Studio One', pinned: false } })),
    ).toBeUndefined()
  })
})

describe('qualityName', () => {
  it('2160p — 4K', () => {
    expect(qualityName('2160p')).toBe('4K')
    expect(qualityName('720p')).toBe('720p')
  })
})

describe('scheduleDays', () => {
  function item(episode: number, airDate: string): ScheduleItem {
    return {
      titleId: 'tmdb:tv:1',
      title: 'Series',
      season: 1,
      episode,
      airDate,
      followed: true,
      state: null,
    }
  }

  it('серии подряд по дням в порядке сервера', () => {
    const days = scheduleDays([
      item(1, '2026-10-25'),
      item(2, '2026-10-25'),
      item(3, '2026-10-27'),
    ])

    expect(days.map(day => [day.date, day.items.length])).toEqual([
      ['2026-10-25', 2],
      ['2026-10-27', 1],
    ])
  })
})

describe('relativeDay', () => {
  const now = new Date(2026, 9, 25, 14, 0)

  it('сегодня, завтра, вчера — словом', () => {
    expect(relativeDay('2026-10-25', now)).toBe('today')
    expect(relativeDay('2026-10-26', now)).toBe('tomorrow')
    expect(relativeDay('2026-10-24', now)).toBe('yesterday')
    expect(relativeDay('2026-10-30', now)).toBeUndefined()
  })

  it('через границу месяца', () => {
    expect(relativeDay('2026-11-01', new Date(2026, 9, 31, 23, 0))).toBe(
      'tomorrow',
    )
  })
})

describe('untilDay', () => {
  const now = new Date(2026, 9, 25, 14, 0)

  it('сегодня и завтра — словом, дальше — дата', () => {
    expect(untilDay(new Date(2026, 9, 25, 20, 0).toISOString(), now)).toBe(
      'today',
    )
    expect(untilDay(new Date(2026, 9, 26, 9, 0).toISOString(), now)).toBe(
      'tomorrow',
    )
    expect(untilDay(new Date(2026, 9, 28, 9, 0).toISOString(), now)).toBe(
      '2026-10-28',
    )
  })
})

describe('шаг «Озвучка»', () => {
  it('русская: как у сервера, студии, оригинал и другой язык', () => {
    expect(voiceChoices({ audioEffective: 'ru' }, 'LostFilm')).toEqual([
      'server',
      'prefer',
      'only',
      'any',
      'original',
      'languages',
    ])
    expect(voiceChoices({ audioEffective: 'ru' }, undefined)).toEqual([
      'server',
      'any',
      'original',
      'languages',
    ])
  })

  it('другой язык и оригинал: сразу список языков без студий', () => {
    const choices = voiceChoices({ audioEffective: 'original' }, 'LostFilm')

    expect(choices.slice(0, 4)).toEqual(['server', 'original', 'ru', 'en'])
    expect(choices).not.toContain('prefer')
    expect(voiceChoices({ audioEffective: 'de' }, undefined)).toContain('de')
  })
})
