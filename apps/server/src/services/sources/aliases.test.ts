import type { TitleIdentity } from '../tmdb/index.ts'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { titleAliases } from '../../db/schema.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'
import {
  aliasesOf,
  purgeExpiredAliases,
  syncTitleAliases,
  textQueriesOf,
} from './aliases.ts'

const DAY_MS = 24 * 60 * 60 * 1000

const identity: TitleIdentity = {
  kind: 'series',
  tmdbId: 101,
  year: 2023,
  names: [
    { value: 'Тихая гавань', lang: 'ru', kind: 'official' },
    { value: 'Quiet Harbor', lang: 'en', kind: 'original' },
    { value: 'Гавань', lang: null, kind: 'alternative' },
  ],
}

beforeAll(() => {
  migrateDb()
})

describe('aliasesOf', () => {
  it('добавляет транслит русских названий и общий ключ', () => {
    const rows = aliasesOf('tmdb:tv:101', identity, new Date(0))

    expect(rows.map(row => [row.kind, row.value])).toEqual([
      ['official', 'Тихая гавань'],
      ['original', 'Quiet Harbor'],
      ['alternative', 'Гавань'],
      ['translit', 'tikhaya gavan'],
      ['translit', 'gavan'],
    ])
    expect(rows[0]!.normalized).toBe(rows[3]!.normalized)
  })
})

describe('syncTitleAliases', () => {
  it('пишет алиасы и не пересобирает свежие', () => {
    const now = Date.now()
    const first = syncTitleAliases('tmdb:tv:1', identity, now)

    expect(first).toHaveLength(5)

    const changed = { ...identity, names: identity.names.slice(0, 1) }

    expect(syncTitleAliases('tmdb:tv:1', changed, now + DAY_MS)).toHaveLength(
      5,
    )
    expect(
      syncTitleAliases('tmdb:tv:1', changed, now + 8 * DAY_MS),
    ).toHaveLength(2)
  })

  it('пересборка не трогает алиасы пользователя', () => {
    const db = getDb()

    db.insert(titleAliases)
      .values({
        titleId: 'tmdb:tv:2',
        value: 'Гавань тишины',
        normalized: 'gavantishini',
        lang: null,
        kind: 'user',
        syncedAt: new Date(0),
      })
      .run()

    const aliases = syncTitleAliases('tmdb:tv:2', identity)

    expect(aliases.filter(alias => alias.kind === 'user')).toHaveLength(1)
    expect(aliases).toHaveLength(6)
  })
})

describe('purgeExpiredAliases', () => {
  it('удаляет только алиасы из TMDB старше предела', () => {
    const now = Date.now()

    syncTitleAliases('tmdb:tv:3', identity, now - TMDB_MAX_CACHE_AGE_MS - 1)
    getDb()
      .insert(titleAliases)
      .values({
        titleId: 'tmdb:tv:3',
        value: 'Свой алиас',
        normalized: 'svoialias',
        lang: null,
        kind: 'user',
        syncedAt: new Date(0),
      })
      .run()

    expect(purgeExpiredAliases(now)).toBe(5)
    expect(
      getDb()
        .select()
        .from(titleAliases)
        .where(eq(titleAliases.titleId, 'tmdb:tv:3'))
        .all()
        .map(alias => alias.kind),
    ).toEqual(['user'])
  })
})

describe('textQueriesOf', () => {
  it('русское, оригинальное, затем транслит; не больше трёх', () => {
    const rows = aliasesOf('tmdb:tv:101', identity, new Date(0))

    expect(textQueriesOf(rows)).toEqual([
      'Тихая гавань',
      'Quiet Harbor',
      'tikhaya gavan',
    ])
  })
})
