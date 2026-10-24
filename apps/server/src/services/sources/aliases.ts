import type { TitleAlias, TitleAliasKind } from '../../db/schema.ts'
import type { TitleIdentity } from '../tmdb/index.ts'
import {
  normalizeTitle,
  titleKey,
  transliterate,
} from '@torsher/release-parser'
import { and, eq, inArray, lte } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleAliases } from '../../db/schema.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'

// Алиасы, собранные из данных TMDB: их срок хранения — как у кэша TMDB
export const TMDB_ALIAS_KINDS: TitleAliasKind[] = [
  'official',
  'original',
  'alternative',
  'translit',
]
const ALIAS_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Столько названий уходит в индексатор текстом: каждый запрос стоит секунды
export const MAX_TEXT_QUERIES = 3

const CYRILLIC = /\p{Script=Cyrillic}/u

/** Алиасы тайтла из TMDB: названия как есть и транслит русских названий */
export function aliasesOf(
  titleId: string,
  identity: TitleIdentity,
  syncedAt: Date,
): TitleAlias[] {
  const rows: TitleAlias[] = []
  const seen = new Set<string>()

  function add(value: string, lang: string | null, kind: TitleAliasKind) {
    const key = `${kind}:${value.toLowerCase()}`
    const normalized = titleKey(value)

    if (!normalized || seen.has(key))
      return

    seen.add(key)
    rows.push({ titleId, value, normalized, lang, kind, syncedAt })
  }

  for (const name of identity.names) add(name.value, name.lang, name.kind)

  for (const name of identity.names) {
    if (CYRILLIC.test(name.value))
      add(transliterate(name.value), name.lang, 'translit')
  }

  return rows
}

function readAliases(titleId: string) {
  return getDb()
    .select()
    .from(titleAliases)
    .where(eq(titleAliases.titleId, titleId))
    .all()
}

/**
 * Алиасы тайтла с пересборкой части из TMDB, если она устарела. Алиасы
 * других видов (из раздач, от пользователя) не трогаются.
 */
export function syncTitleAliases(
  titleId: string,
  identity: TitleIdentity,
  now = Date.now(),
): TitleAlias[] {
  const current = readAliases(titleId)
  const fromTmdb = current.filter(alias =>
    TMDB_ALIAS_KINDS.includes(alias.kind),
  )
  const fresh
    = fromTmdb.length > 0
      && fromTmdb.every(alias => now - alias.syncedAt.getTime() < ALIAS_TTL_MS)

  if (fresh)
    return current

  const rows = aliasesOf(titleId, identity, new Date(now))
  const db = getDb()

  db.transaction((tx) => {
    tx.delete(titleAliases)
      .where(
        and(
          eq(titleAliases.titleId, titleId),
          inArray(titleAliases.kind, TMDB_ALIAS_KINDS),
        ),
      )
      .run()

    if (rows.length > 0)
      tx.insert(titleAliases).values(rows).onConflictDoNothing().run()
  })

  return readAliases(titleId)
}

/** Удаляет алиасы из TMDB, достигшие предела хранения его данных */
export function purgeExpiredAliases(now = Date.now()) {
  return getDb()
    .delete(titleAliases)
    .where(
      and(
        inArray(titleAliases.kind, TMDB_ALIAS_KINDS),
        lte(titleAliases.syncedAt, new Date(now - TMDB_MAX_CACHE_AGE_MS)),
      ),
    )
    .run()
    .changes
}

const QUERY_ORDER: { kind: TitleAliasKind, lang?: string }[] = [
  { kind: 'user' },
  { kind: 'official', lang: 'ru' },
  { kind: 'original' },
  { kind: 'official', lang: 'en' },
  { kind: 'translit' },
  { kind: 'tracker' },
  { kind: 'official' },
  { kind: 'alternative' },
]

/**
 * Названия для текстового поиска: русское, оригинальное, английское,
 * транслит — без повторов после нормализации.
 */
export function textQueriesOf(aliases: TitleAlias[], max = MAX_TEXT_QUERIES) {
  const queries: string[] = []
  const seen = new Set<string>()

  for (const { kind, lang } of QUERY_ORDER) {
    for (const alias of aliases) {
      if (alias.kind !== kind || (lang && alias.lang !== lang))
        continue

      const key = normalizeTitle(alias.value)

      if (!key || seen.has(key))
        continue

      seen.add(key)
      queries.push(alias.value)

      if (queries.length === max)
        return queries
    }
  }

  return queries
}

/**
 * Готовые строки для «Уточнить запрос»: русское и оригинальное название
 * по отдельности и вместе, с годом и без, — без повторов после нормализации.
 * Русского нет — берётся первое официальное. Оригинала нет (у аниме он
 * японский, а в алиасы попадают только латиница и кириллица) — английское.
 */
export function queryCombos(aliases: TitleAlias[], year?: number) {
  const russian
    = aliases.find(alias => alias.kind === 'official' && alias.lang === 'ru')
      ?? aliases.find(alias => alias.kind === 'official')
  const found
    = aliases.find(alias => alias.kind === 'original')
      ?? aliases.find(
        alias =>
          alias.kind === 'official' && alias.lang === 'en' && alias !== russian,
      )
  const original
    = found
      && normalizeTitle(found.value) !== normalizeTitle(russian?.value ?? '')
      ? found
      : undefined
  const bases: string[] = []

  if (russian)
    bases.push(russian.value)

  if (russian && original)
    bases.push(`${russian.value} ${original.value}`)

  if (original)
    bases.push(original.value)

  if (russian && original)
    bases.push(`${original.value} ${russian.value}`)

  const combos: string[] = []
  const seen = new Set<string>()

  for (const value of bases.flatMap(base =>
    year ? [base, `${base} ${year}`] : [base],
  )) {
    const key = normalizeTitle(value)

    if (!key || seen.has(key))
      continue

    seen.add(key)
    combos.push(value)
  }

  return combos
}
