import type { ParsedRelease } from '@torsher/release-parser'
import type { Torrent } from '../../db/schema.ts'
import { matchTitle, parseRelease, titleKey } from '@torsher/release-parser'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleAliases, torrents } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { syncTitleAliases } from '../sources/aliases.ts'
import { getTitleIdentity, searchCatalog } from '../tmdb/index.ts'
import { getTorrent, linkTitle } from '../torrents/index.ts'

// Поиск TMDB — по каждому названию раздачи, кандидатов на проверку — не больше
const MAX_QUERIES = 3
const MAX_CANDIDATES = 6
// Язык поиска не важен: проверка идёт по алиасам тайтла на всех языках
const SEARCH_LANGUAGE = 'en-US'

export type Recognition
  = | { status: 'matched', titleId: string }
    | { status: 'unsure', suggestion: string }
    | { status: 'unmatched' }

export function namesOf(parsed: ParsedRelease) {
  const { ru, orig, translit, alt = [] } = parsed.titles

  return [
    ...new Set(
      [ru, orig, translit, ...alt].filter((name): name is string => !!name),
    ),
  ]
}

/** Тайтлы, которые владелец уже выбирал для такого же названия (алиас `user`) */
function userTitles(names: string[]) {
  const keys = names.map(titleKey).filter(Boolean)

  if (!keys.length)
    return []

  return getDb()
    .selectDistinct({ titleId: titleAliases.titleId })
    .from(titleAliases)
    .where(
      and(
        eq(titleAliases.kind, 'user'),
        inArray(titleAliases.normalized, keys),
      ),
    )
    .all()
    .map(row => row.titleId)
}

/**
 * Название без подзаголовка: «Звёзды в джунглях. Карибский» → «Звёзды в
 * джунглях». Парсер не отличает подзаголовок сезона от части названия, а поиск
 * TMDB по полному имени тогда пуст. Только для поиска: сверка идёт по полному
 * имени, иначе «Игра престолов. Дом дракона» молча стала бы «Игрой престолов».
 */
export function headOf(name: string) {
  const head = name.split(/\. |: /)[0]!.trim()

  return head && head !== name ? head : undefined
}

export type KindHint = 'movie' | 'series'

async function candidatesOf(
  parsed: ParsedRelease,
  names: string[],
  hint?: KindHint,
) {
  const ids = userTitles(names)
  const kind
    = hint
      ?? (parsed.kind === 'movie'
        ? 'movie'
        : parsed.kind === 'series'
          ? 'series'
          : undefined)
  const head = headOf(names[0]!)
  const queries = [...names.slice(0, MAX_QUERIES), ...(head ? [head] : [])]

  for (const name of queries) {
    const found = await searchCatalog(name, SEARCH_LANGUAGE)

    for (const card of found.items) {
      // Вид из имени раздачи отсекает однофамильцев другого вида
      if (!kind || card.kind === kind)
        ids.push(card.id)
    }
  }

  return [...new Set(ids)].slice(0, MAX_CANDIDATES)
}

/**
 * Тайтл раздачи по её имени, как в «Источниках», только наоборот: названия
 * из `parseRelease` → поиск TMDB → алиасы кандидата → `matchTitle`. Один
 * `high` — узнали; несколько `high` (омонимы) или `medium` — похоже, ждём
 * подтверждения; иначе — не узнали. Выбор владельца для такого же названия
 * (алиас `user`) проверяется первым.
 */
export async function recognizeRelease(
  name: string,
  hint?: KindHint,
): Promise<Recognition> {
  const parsed = parseRelease(name)
  const names = namesOf(parsed)

  if (!names.length)
    return { status: 'unmatched' }

  const high: string[] = []
  const medium: string[] = []

  for (const id of await candidatesOf(parsed, names, hint)) {
    const identity = await getTitleIdentity(id)

    if (!identity)
      continue

    const match = matchTitle(parsed, {
      kind: identity.kind,
      aliases: syncTitleAliases(id, identity).map(alias => alias.value),
      year: identity.year,
      endYear: identity.endYear,
    })

    if (match.confidence === 'high')
      high.push(id)
    else if (match.confidence === 'medium')
      medium.push(id)
  }

  if (high.length === 1)
    return { status: 'matched', titleId: high[0]! }

  const suggestion = high[0] ?? medium[0]

  return suggestion
    ? { status: 'unsure', suggestion }
    : { status: 'unmatched' }
}

const queue: string[] = []
let draining: Promise<void> | undefined
let onMatched: (() => void) | undefined

async function recognizeOne(id: string) {
  const torrent = getTorrent(id)

  // Тайтл уже есть (раздачу выбрали из карточки) или владелец уже решил
  if (
    !torrent
    || torrent.status !== 'ready'
    || torrent.titleId
    || torrent.matchStatus
  ) {
    return
  }

  const result = await recognizeRelease(torrent.name)
  const fresh = getTorrent(id)

  if (!fresh || fresh.titleId || fresh.matchStatus)
    return

  if (result.status === 'matched') {
    linkTitle(fresh, result.titleId)
    setMatch(id, { matchStatus: 'matched', matchSuggestion: null })
    logFor('catalog').info({ torrentId: id }, 'Torrent recognized')
    onMatched?.()
  }
  else {
    setMatch(id, {
      matchStatus: result.status,
      matchSuggestion: result.status === 'unsure' ? result.suggestion : null,
    })
  }
}

function setMatch(
  id: string,
  values: Pick<Torrent, 'matchStatus' | 'matchSuggestion'>,
) {
  getDb().update(torrents).set(values).where(eq(torrents.id, id)).run()
}

async function drain() {
  for (let id = queue.shift(); id; id = queue.shift()) {
    try {
      await recognizeOne(id)
    }
    catch (err) {
      // Каталог недоступен — распознаем при следующем старте
      logFor('catalog').warn(
        { err, torrentId: id },
        'Torrent recognition failed',
      )
    }
  }
}

/** Ставит раздачу в очередь распознавания: по одной, запросы к TMDB не толпятся */
export function queueRecognition(id: string) {
  if (!queue.includes(id))
    queue.push(id)

  draining ??= drain().finally(() => {
    draining = undefined

    if (queue.length)
      void queueRecognition(queue[0]!)
  })

  return draining
}

/**
 * Распознавание раздач без тайтла: новых — когда пришёл список файлов, прежних —
 * при старте. `matched` — после распознавания (связыватель кладёт файлы).
 */
export function startRecognition(matched: () => void) {
  onMatched = matched

  const pending = getDb()
    .select({ id: torrents.id })
    .from(torrents)
    .where(
      and(
        isNull(torrents.titleId),
        isNull(torrents.matchStatus),
        eq(torrents.status, 'ready'),
      ),
    )
    .all()

  for (const row of pending) void queueRecognition(row.id)
}

/** Только для тестов: дождаться очереди */
export function recognitionIdle() {
  return draining ?? Promise.resolve()
}

/** Выбор владельца для названия раздачи или папки: такое же имя узнаётся само */
export function rememberUserAlias(titleId: string, releaseName: string) {
  const { ru, orig, translit } = parseRelease(releaseName).titles
  const names = [ru, orig, translit].filter((name): name is string => !!name)

  if (!names.length)
    return

  getDb()
    .insert(titleAliases)
    .values(
      names.map(value => ({
        titleId,
        value,
        normalized: titleKey(value),
        lang: null,
        kind: 'user' as const,
        syncedAt: new Date(),
      })),
    )
    .onConflictDoNothing()
    .run()
}
