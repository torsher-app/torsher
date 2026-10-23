import type { ProgressPoint } from './status.ts'
import { describe, expect, it } from 'vitest'
import { isDropped, titleStatus } from './status.ts'

const day = (n: number) => new Date(Date.UTC(2026, 9, n))

function watched(season: number, episode: number, at = day(10)): ProgressPoint {
  return { season, episode, position: 1, duration: 1, updatedAt: at }
}

function started(season: number, episode: number, at = day(10)): ProgressPoint {
  return { season, episode, position: 300, duration: 3000, updatedAt: at }
}

const seasons = [
  { number: 1, airedEpisodeCount: 2 },
  { number: 2, airedEpisodeCount: 1 },
]
const allAired = [watched(1, 1), watched(1, 2), watched(2, 1)]

describe('titleStatus', () => {
  it('фильм: без просмотра — нет статуса, начат — «Смотрю», досмотрен — «Просмотрено»', () => {
    expect(titleStatus({ kind: 'movie', progress: [] })).toBeNull()
    expect(titleStatus({ kind: 'movie', progress: [started(0, 0)] })).toBe(
      'watching',
    )
    expect(titleStatus({ kind: 'movie', progress: [watched(0, 0)] })).toBe(
      'watched',
    )
  })

  it('оценённый фильм считается просмотренным, сериал — нет', () => {
    expect(titleStatus({ kind: 'movie', progress: [], rating: 8 })).toBe(
      'watched',
    )
    expect(
      titleStatus({ kind: 'series', progress: [], rating: 8, seasons }),
    ).toBeNull()
  })

  it('сериал: часть вышедшего — «Смотрю»', () => {
    expect(
      titleStatus({
        kind: 'series',
        progress: [watched(1, 1)],
        seasons,
        ongoing: true,
      }),
    ).toBe('watching')
  })

  it('сериал: всё вышедшее у завершённого — «Просмотрено»', () => {
    expect(
      titleStatus({
        kind: 'series',
        progress: allAired,
        seasons,
        ongoing: false,
      }),
    ).toBe('watched')
  })

  it('сериал: всё вышедшее у идущего — «Ждём новый сезон», а при анонсе в текущем сезоне — «Смотрю»', () => {
    const base = {
      kind: 'series' as const,
      progress: allAired,
      seasons,
      ongoing: true,
      lastAired: { season: 2 },
    }

    expect(titleStatus(base)).toBe('waiting')
    expect(titleStatus({ ...base, next: { season: 3 } })).toBe('waiting')
    expect(titleStatus({ ...base, next: { season: 2 } })).toBe('watching')
  })

  it('без деталей сериала начатый считается «Смотрю»', () => {
    expect(titleStatus({ kind: 'series', progress: allAired })).toBe(
      'watching',
    )
  })

  it('«Брошено» действует до следующего просмотра', () => {
    const progress = [started(1, 1, day(10))]

    expect(
      titleStatus({ kind: 'series', progress, seasons, droppedAt: day(12) }),
    ).toBe('dropped')
    expect(
      titleStatus({ kind: 'series', progress, seasons, droppedAt: day(8) }),
    ).toBe('watching')
    expect(isDropped(day(12), undefined)).toBe(true)
    expect(isDropped(null, day(1))).toBe(false)
    expect(isDropped(day(10), day(10))).toBe(true)
  })
})
