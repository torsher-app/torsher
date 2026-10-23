import type { TitleIdentity } from '../tmdb/index.ts'
import { eq } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { titleAliases } from '../../db/schema.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'
import {
  aliasesOf,
  purgeExpiredAliases,
  queryCombos,
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

describe('queryCombos', () => {
  const rows = aliasesOf('tmdb:tv:101', identity, new Date(0))

  it('русское и оригинальное, вместе и по отдельности, с годом и без', () => {
    expect(queryCombos(rows, 2023)).toEqual([
      'Тихая гавань',
      'Тихая гавань 2023',
      'Тихая гавань Quiet Harbor',
      'Тихая гавань Quiet Harbor 2023',
      'Quiet Harbor',
      'Quiet Harbor 2023',
      'Quiet Harbor Тихая гавань',
      'Quiet Harbor Тихая гавань 2023',
    ])
  })

  it('без года и без русского — первое официальное', () => {
    const english = aliasesOf(
      'tmdb:tv:102',
      {
        ...identity,
        names: [
          { value: 'Quiet Harbor', lang: 'en', kind: 'official' },
          { value: 'Stiller Hafen', lang: 'de', kind: 'original' },
        ],
      },
      new Date(0),
    )

    expect(queryCombos(english)).toEqual([
      'Quiet Harbor',
      'Quiet Harbor Stiller Hafen',
      'Stiller Hafen',
      'Stiller Hafen Quiet Harbor',
    ])
  })

  it('без оригинала вместо него — английское название', () => {
    const anime = aliasesOf(
      'tmdb:tv:104',
      {
        ...identity,
        names: [
          { value: 'Монолог фармацевта', lang: 'ru', kind: 'official' },
          { value: 'The Apothecary Diaries', lang: 'en', kind: 'official' },
        ],
      },
      new Date(0),
    )

    expect(queryCombos(anime)).toEqual([
      'Монолог фармацевта',
      'Монолог фармацевта The Apothecary Diaries',
      'The Apothecary Diaries',
      'The Apothecary Diaries Монолог фармацевта',
    ])
  })

  it('оригинал, совпавший с русским, не повторяется', () => {
    const same = aliasesOf(
      'tmdb:tv:103',
      {
        ...identity,
        names: [
          { value: 'Гавань', lang: 'ru', kind: 'official' },
          { value: 'Гавань', lang: 'ru', kind: 'original' },
        ],
      },
      new Date(0),
    )

    expect(queryCombos(same, 2020)).toEqual(['Гавань', 'Гавань 2020'])
  })
})
