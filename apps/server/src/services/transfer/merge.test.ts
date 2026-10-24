import type { MineValues } from './merge.ts'
import { describe, expect, it } from 'vitest'
import { mergeMine } from './merge.ts'

const now = new Date('2026-10-24T12:00:00Z')
const old = new Date('2020-01-01T00:00:00Z')
const newer = new Date('2025-01-01T00:00:00Z')

function mine(values: Partial<MineValues>): MineValues {
  return {
    watchlistAt: null,
    favoriteAt: null,
    rating: null,
    ratedAt: null,
    droppedAt: null,
    ...values,
  }
}

describe('mergeMine', () => {
  it('новая оценка ложится с датой из файла, без даты — со временем импорта', () => {
    expect(
      mergeMine(
        undefined,
        { kind: 'series', rating: 7, ratedAt: old },
        'keep',
        now,
      ),
    ).toMatchObject({ rating: 7, ratedAt: old })
    expect(
      mergeMine(undefined, { kind: 'series', rating: 7 }, 'keep', now),
    ).toMatchObject({ rating: 7, ratedAt: now })
  })

  it('та же оценка ничего не меняет', () => {
    expect(
      mergeMine(
        mine({ rating: 7, ratedAt: old }),
        { kind: 'movie', rating: 7, ratedAt: newer },
        'replace',
        now,
      ),
    ).toBeUndefined()
  })

  it('конфликт: keep оставляет свою, replace берёт из файла, newer — по датам', () => {
    const current = mine({ rating: 5, ratedAt: old })

    expect(
      mergeMine(
        current,
        { kind: 'series', rating: 9, ratedAt: newer },
        'keep',
        now,
      ),
    ).toBeUndefined()
    expect(
      mergeMine(current, { kind: 'series', rating: 9 }, 'replace', now),
    ).toMatchObject({ rating: 9 })
    expect(
      mergeMine(
        current,
        { kind: 'series', rating: 9, ratedAt: newer },
        'newer',
        now,
      ),
    ).toMatchObject({ rating: 9, ratedAt: newer })
    expect(
      mergeMine(
        mine({ rating: 5, ratedAt: newer }),
        { kind: 'series', rating: 9, ratedAt: old },
        'newer',
        now,
      ),
    ).toBeUndefined()
    expect(
      mergeMine(current, { kind: 'series', rating: 9 }, 'newer', now),
    ).toBeUndefined()
  })

  it('«Позже» объединяется; оценённый фильм в «Позже» не остаётся', () => {
    expect(
      mergeMine(undefined, { kind: 'movie', watchlistAt: old }, 'keep', now),
    ).toMatchObject({ watchlistAt: old })
    expect(
      mergeMine(
        mine({ watchlistAt: newer }),
        { kind: 'movie', watchlistAt: old },
        'keep',
        now,
      ),
    ).toBeUndefined()
    expect(
      mergeMine(
        mine({ watchlistAt: old }),
        { kind: 'movie', rating: 8 },
        'keep',
        now,
      ),
    ).toMatchObject({ rating: 8, watchlistAt: null })
    expect(
      mergeMine(
        mine({ rating: 8 }),
        { kind: 'movie', watchlistAt: old },
        'keep',
        now,
      ),
    ).toBeUndefined()
    expect(
      mergeMine(
        mine({ rating: 8 }),
        { kind: 'series', watchlistAt: old },
        'keep',
        now,
      ),
    ).toMatchObject({ rating: 8, watchlistAt: old })
  })

  it('без «Избранного» и «Брошено» во входе их не трогает', () => {
    expect(
      mergeMine(
        mine({ favoriteAt: old, droppedAt: old }),
        { kind: 'series', rating: 3 },
        'keep',
        now,
      ),
    ).toMatchObject({ favoriteAt: old, droppedAt: old, rating: 3 })
  })

  it('«Избранное» объединяет, своя отметка остаётся', () => {
    expect(
      mergeMine(undefined, { kind: 'movie', favoriteAt: old }, 'keep', now),
    ).toMatchObject({ favoriteAt: old })
    expect(
      mergeMine(
        mine({ favoriteAt: newer }),
        { kind: 'movie', favoriteAt: old },
        'keep',
        now,
      ),
    ).toBeUndefined()
  })

  it('«Брошено» берёт более позднее', () => {
    expect(
      mergeMine(
        mine({ droppedAt: old }),
        { kind: 'series', droppedAt: newer },
        'keep',
        now,
      ),
    ).toMatchObject({ droppedAt: newer })
    expect(
      mergeMine(
        mine({ droppedAt: newer }),
        { kind: 'series', droppedAt: old },
        'keep',
        now,
      ),
    ).toBeUndefined()
  })
})
