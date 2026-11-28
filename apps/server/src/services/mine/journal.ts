import type { SQL } from 'drizzle-orm'
import type { DiaryContext, diaryOrigins } from '../../db/schema.ts'
import type {
  MineDiaryFilter,
  MineDiaryQuery,
} from '../../dto/minePersonal.ts'
import { Buffer } from 'node:buffer'
import { sql } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../db/index.ts'
import { getProfile } from '../profiles/index.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'
import { cachedTitleAges, DETAILS_KEY_VERSION } from '../tmdb/certification.ts'
import { diaryTimeZone } from '../transfer/diaryTimeZone.ts'
import { calendarPeriod, DAY_MS, foldForSearch } from './calendar.ts'
import { diaryEntryWire } from './diaryWrites.ts'
import { MinePersonalError } from './personalAccess.ts'
import { effectiveRewatchCtes } from './rewatch.ts'

interface JournalContext {
  profileId: string
  language: string
  filter: MineDiaryFilter
}
const noRange = sql``
const cursorSchema = z.tuple([
  z.iso.date().or(z.literal('')),
  z.number().int().min(0).max(2),
  z.number().int(),
  z.uuid(),
])

interface RawEntry {
  id: string
  title_id: string
  season: number
  episode: number
  precision: 'instant' | 'day' | 'unknown'
  instant: number | null
  day: string | null
  origin: (typeof diaryOrigins)[number]
  origin_key: string | null
  rewatch: number
  note: string | null
  viewing_context: string | null
  context: string | null
  created_at: number
  updated_at: number
  local_day: string
  precision_rank: number
  instant_sort: number
}

function civilRange(filter: MineDiaryFilter) {
  const dates = [filter.year, filter.month, filter.day].filter(
    (value): value is string => !!value,
  )
  if (!dates.length)
    return undefined
  const from = dates.every(value => dates.at(-1)!.startsWith(value))
    ? dates.at(-1)
    : undefined
  return from ? calendarPeriod(from) : null
}

interface Range {
  from: string
  to: string
}
type DiaryWindow = Range | 'unknown'

function rawCandidates(
  { profileId, filter }: JournalContext,
  window?: DiaryWindow,
) {
  const period = civilRange(filter)
  const columns = sql`d.id, d.title_id, d.season, d.episode, d.rewatch, d.origin, d.origin_key, d.precision, d.day, d.instant
    ${filter.search ? sql`, d.note, d.viewing_context` : noRange}`
  const none = sql`SELECT ${columns} FROM diary_entries d WHERE 0`
  if (period === null || (period && filter.date === 'unknown'))
    return { candidates: none, range: undefined }

  const from = period?.dayFrom
  const to = period?.dayTo
  const range
    = window === 'unknown'
      ? undefined
      : window
        ? {
            from: from && from > window.from ? from : window.from,
            to: to && to < window.to ? to : window.to,
          }
        : from && to
          ? { from, to }
          : undefined
  if (range && range.from >= range.to)
    return { candidates: none, range }

  const common = sql`d.profile_id = ${profileId}
    ${filter.kind === 'movie' ? sql`AND d.title_id LIKE 'tmdb:movie:%'` : noRange}
    ${filter.kind === 'episode' ? sql`AND d.title_id LIKE 'tmdb:tv:%' AND d.episode > 0` : noRange}
    ${filter.kind === 'series' ? sql`AND d.title_id LIKE 'tmdb:tv:%' AND d.episode = 0` : noRange}`

  const arms: SQL[] = []
  if (filter.date !== 'unknown' && window !== 'unknown') {
    arms.push(sql`
      SELECT ${columns} FROM diary_entries d
      WHERE ${common} AND precision = 'day'
        ${range ? sql`AND day >= ${range.from} AND day < ${range.to}` : noRange}
    `)
    const lower = range && calendarPeriod(range.from).instantFrom
    const upper
      = range
        && (range.to === '9999-12-32'
          ? calendarPeriod('9999-12-31').instantTo
          : Date.parse(`${range.to}T00:00:00Z`) + DAY_MS)
    arms.push(sql`
      SELECT ${columns} FROM diary_entries d
      WHERE ${common} AND precision = 'instant'
        ${range ? sql`AND instant >= ${lower} AND instant < ${upper}` : noRange}
    `)
  }
  if (!period && (!window || window === 'unknown') && filter.date !== 'dated') {
    arms.push(
      sql`SELECT ${columns} FROM diary_entries d WHERE ${common} AND precision = 'unknown'`,
    )
  }
  return {
    candidates: arms.length ? sql.join(arms, sql` UNION ALL `) : none,
    range,
  }
}

/** Restriction proof is shared across calendar, page and unfiltered first-day detection. */
function cachedAccess(profileId: string, candidates: SQL, now: number) {
  const profile = getProfile(profileId)
  if (!profile)
    throw new MinePersonalError('profileChanged', 409)
  if (profile.ageLimit === null)
    return sql`1 = 1`

  const limit = profile.ageLimit
  const ids = getDb()
    .all<{ title_id: string }>(
      sql`
    SELECT DISTINCT title_id FROM (${candidates}) AS matching_titles
  `,
    )
    .map(row => row.title_id)
  const ages = cachedTitleAges(ids, now)
  const allowed = ids.filter(id => (ages.get(id) ?? Infinity) < limit)
  return sql`title_id IN (SELECT value FROM json_each(${JSON.stringify(allowed)}))`
}

export function metadataTail(language: string, threshold: number) {
  return sql`
    SELECT keys.title_id, COALESCE(requested.json, english.json, russian.json) AS json
    FROM title_keys keys
    LEFT JOIN meta_cache requested ON requested.key = keys.title_id || ':' || ${language} || ':' || ${DETAILS_KEY_VERSION}
      AND requested.fetched_at > ${threshold} AND json_valid(requested.json)
    LEFT JOIN meta_cache english ON english.key = keys.title_id || ':en-US:' || ${DETAILS_KEY_VERSION}
      AND english.fetched_at > ${threshold} AND json_valid(english.json)
    LEFT JOIN meta_cache russian ON russian.key = keys.title_id || ':ru-RU:' || ${DETAILS_KEY_VERSION}
      AND russian.fetched_at > ${threshold} AND json_valid(russian.json)
  `
}

export const movieCriterion = sql`f.title_id LIKE 'tmdb:movie:%'`
export const countryValues = sql`json_each(CASE WHEN ${movieCriterion}
  THEN json_extract(f.json, '$.production_countries')
  ELSE json_extract(f.json, '$.origin_country') END)`
export const countryValue = sql`CASE WHEN country.type = 'object' THEN json_extract(country.value, '$.iso_3166_1') ELSE country.value END`

export function facetsFilter(
  filter: Pick<MineDiaryFilter, 'genre' | 'country'>,
) {
  return sql`
    ${
      filter.genre
        ? sql`AND EXISTS (
      SELECT 1 FROM json_each(f.json, '$.genres') genre
      WHERE genre.type = 'object' AND json_extract(genre.value, '$.id') = ${filter.genre}
    )`
        : noRange
    }
    ${
      filter.country
        ? sql`AND EXISTS (
      SELECT 1 FROM ${countryValues} country WHERE ${countryValue} = ${filter.country}
    )`
        : noRange
    }
  `
}

export function firstDayInterestScope(
  profileId: string,
  language: string,
  filter: Pick<MineDiaryFilter, 'genre' | 'country'> = {},
  now = Date.now(),
) {
  const candidates = sql`
    SELECT title_id, rating, rated_at, favorite_at FROM profile_titles
    WHERE profile_id = ${profileId} AND (rating IS NOT NULL OR favorite_at IS NOT NULL)
      AND (title_id LIKE 'tmdb:movie:%' OR title_id LIKE 'tmdb:tv:%')
  `
  const access = cachedAccess(profileId, candidates, now)
  return sql`
    WITH candidates AS (${candidates}),
    visible AS (SELECT * FROM candidates WHERE ${access}),
    title_keys AS (SELECT title_id FROM visible),
    metadata AS (${metadataTail(language, now - TMDB_MAX_CACHE_AGE_MS)}),
    filtered AS (SELECT f.*, m.json FROM visible f LEFT JOIN metadata m ON m.title_id = f.title_id),
    result AS (SELECT * FROM filtered f WHERE 1 = 1 ${facetsFilter(filter)})
  `
}

export function journalRead(
  context: JournalContext,
  timeZone = diaryTimeZone(),
  now = Date.now(),
) {
  const { filter, language, profileId } = context
  const access = cachedAccess(
    profileId,
    sql`SELECT title_id FROM diary_entries WHERE profile_id = ${profileId}`,
    now,
  )

  function scope(window?: DiaryWindow) {
    const { candidates, range } = rawCandidates(context, window)
    const dayRange = range
      ? sql`local_day >= ${range.from} AND local_day < ${range.to}`
      : sql`1 = 1`
    const search = filter.search ? foldForSearch(filter.search) : undefined
    const dated = sql`
      WITH dated AS MATERIALIZED (
        SELECT id, title_id, season, episode, origin, origin_key, rewatch AS recorded_rewatch,
          CASE precision WHEN 'instant' THEN mine_day_at(instant, ${timeZone}) ELSE COALESCE(day, '') END AS local_day,
          CASE precision WHEN 'instant' THEN 2 WHEN 'day' THEN 1 ELSE 0 END AS precision_rank,
          COALESCE(instant, 0) AS instant_sort
          ${search ? sql`, note, viewing_context` : noRange}
        FROM (${candidates}) AS candidate WHERE ${access}
      ), scoped AS MATERIALIZED (SELECT * FROM dated WHERE ${dayRange}),
      ${effectiveRewatchCtes(profileId, timeZone)}
    `
    const include = filter.rewatch === 'only' ? sql`rewatch = 1` : sql`1 = 1`
    if (!filter.genre && !filter.country && !search) {
      return sql`${dated}, result AS MATERIALIZED (
        SELECT id, title_id, season, episode, rewatch, local_day, precision_rank, instant_sort
        FROM effective WHERE ${include}
      )`
    }

    return sql`
      ${dated},
      title_keys AS (SELECT DISTINCT title_id FROM scoped),
      metadata AS MATERIALIZED (${metadataTail(language, now - TMDB_MAX_CACHE_AGE_MS)}),
      result AS MATERIALIZED (
        SELECT s.id, s.title_id, s.season, s.episode, s.rewatch, s.local_day, s.precision_rank, s.instant_sort
        FROM effective s LEFT JOIN metadata f ON f.title_id = s.title_id
        WHERE ${include}
          ${
            search
              ? sql`AND (
            instr(mine_fold(COALESCE(s.note, '')), ${search}) > 0
            OR instr(mine_fold(COALESCE(s.viewing_context, '')), ${search}) > 0
            OR instr(mine_fold(COALESCE(json_extract(f.json, '$.title'), json_extract(f.json, '$.name'), '')), ${search}) > 0
            OR instr(mine_fold(COALESCE(json_extract(f.json, '$.original_title'), json_extract(f.json, '$.original_name'), '')), ${search}) > 0
          )`
              : noRange
          }
          ${facetsFilter(filter)}
      )
    `
  }

  function hasDatedHistory() {
    return !!getDb().get(sql`
      SELECT 1 FROM diary_entries
      WHERE profile_id = ${profileId} AND precision IN ('day', 'instant') AND ${access}
      LIMIT 1
    `)
  }

  return { scope, hasDatedHistory }
}

export function journalScope(
  context: JournalContext,
  timeZone = diaryTimeZone(),
) {
  return journalRead(context, timeZone).scope()
}

export function wireFromJournal(
  row: RawEntry,
  language: string,
  timeZone: string,
) {
  return diaryEntryWire(
    {
      id: row.id,
      titleId: row.title_id,
      season: row.season,
      episode: row.episode,
      precision: row.precision,
      instant: row.instant === null ? null : new Date(row.instant),
      day: row.day,
      origin: row.origin,
      originKey: row.origin_key,
      rewatch: !!row.rewatch,
      note: row.note,
      viewingContext: row.viewing_context,
      context: row.context ? (JSON.parse(row.context) as DiaryContext) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    },
    language,
    timeZone,
  )
}

const tuple = sql`(local_day, precision_rank, instant_sort, id)`
type PageKey = Pick<
  RawEntry,
  'local_day' | 'precision_rank' | 'instant_sort' | 'id' | 'rewatch'
>
function cursorFor(row: PageKey) {
  return Buffer.from(
    JSON.stringify([
      row.local_day,
      row.precision_rank,
      row.instant_sort,
      row.id,
    ]),
  ).toString('base64url')
}

function readCursor(cursor: string) {
  try {
    return cursorSchema.parse(
      JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')),
    )
  }
  catch {
    throw new MinePersonalError('notFound', 404)
  }
}

type DayCount = [day: string, count: number]
function diaryTotals(scope: SQL) {
  const stats = getDb().get<{ days: string, distinctTitles: number }>(sql`
    ${scope}
    SELECT
      (SELECT json_group_array(json_array(local_day, n)) FROM (
        SELECT local_day, count(*) AS n FROM result GROUP BY local_day ORDER BY local_day DESC
      )) AS days,
      (SELECT count(DISTINCT title_id) FROM result) AS distinctTitles
  `)!
  const days = JSON.parse(stats.days) as DayCount[]
  const months = new Map<string | null, number>()
  let total = 0
  for (const [day, count] of days) {
    const month = day ? day.slice(0, 7) : null
    months.set(month, (months.get(month) ?? 0) + count)
    total += count
  }
  return {
    days,
    months: [...months].map(([month, count]) => ({ month, count })),
    total,
    distinctTitles: stats.distinctTitles,
  }
}

export function getDiaryMonths(context: JournalContext) {
  return { months: diaryTotals(journalRead(context).scope()).months }
}

/** Bounded date windows on the raw indexes; the undated tail is a separate query. */
function pageKeys(
  scope: ReturnType<typeof journalRead>['scope'],
  days: DayCount[],
  query: MineDiaryQuery,
  cursor: ReturnType<typeof readCursor> | undefined,
  newer: boolean,
) {
  const length = query.limit + 1
  const anchor
    = !cursor && query.anchorMonth
      ? calendarPeriod(query.anchorMonth)
      : undefined
  const active = days.filter(([day]) =>
    cursor
      ? newer
        ? day >= cursor[0]
        : day <= cursor[0]
      : !anchor || day < anchor.dayTo,
  )
  if (newer)
    active.reverse()
  const bounds = cursor
    ? sql`WHERE ${tuple} ${newer ? sql`>` : sql`<`} (${sql.join(
      cursor.map(value => sql`${value}`),
      sql`, `,
    )})`
    : noRange
  const order = newer ? sql`ASC` : sql`DESC`
  const rows: PageKey[] = []
  for (let i = 0; i < active.length && rows.length < length;) {
    const [first, count] = active[i]!
    let last = first
    let possible = count
    i++
    if (first) {
      const month = first.slice(0, 7)
      while (
        possible < length - rows.length
        && i < active.length
        && active[i]![0].slice(0, 7) === month
      ) {
        const next = active[i++]!
        last = next[0]
        possible += next[1]
      }
    }
    const window = first
      ? {
          from: newer ? first : last,
          to: calendarPeriod(newer ? last : first).dayTo,
        }
      : 'unknown'
    rows.push(
      ...getDb().all<PageKey>(sql`
      ${scope(window)} SELECT id, rewatch, local_day, precision_rank, instant_sort FROM result ${bounds}
      ORDER BY local_day ${order}, precision_rank ${order}, instant_sort ${order}, id ${order}
      LIMIT ${length - rows.length}
    `),
    )
  }
  return { rows, anchor }
}

export function hydrateDiary(
  profileId: string,
  keys: [string, number][],
  language: string,
  timeZone: string,
) {
  if (!keys.length)
    return []
  return getDb()
    .all<RawEntry & { effective_rewatch: number }>(
      sql`
    SELECT d.*, json_extract(j.value, '$[1]') AS effective_rewatch FROM json_each(${JSON.stringify(keys)}) j
    CROSS JOIN diary_entries d
    WHERE d.profile_id = ${profileId} AND d.id = json_extract(j.value, '$[0]')
    ORDER BY CAST(j.key AS INTEGER)
  `,
    )
    .map(row =>
      wireFromJournal(
        { ...row, rewatch: row.effective_rewatch },
        language,
        timeZone,
      ),
    )
}

export function getDiaryPage(profileId: string, query: MineDiaryQuery) {
  const timeZone = diaryTimeZone()
  const reader = journalRead(
    { profileId, language: query.language, filter: query },
    timeZone,
  )
  const { days, months, total, distinctTitles } = diaryTotals(reader.scope())
  const cursor = query.cursor ? readCursor(query.cursor) : undefined
  const newer = query.direction === 'newer' && !!cursor
  const { rows, anchor } = pageKeys(reader.scope, days, query, cursor, newer)
  const over = rows.length > query.limit
  const page = rows.slice(0, query.limit)
  if (newer)
    page.reverse()

  const first = page[0]
  const last = page.at(-1)
  const hasNewer = newer
    ? over
    : !!cursor || (!!anchor && days.some(([day]) => day >= anchor.dayTo))
  const hasOlder = newer ? !!cursor : over
  return {
    profileId,
    entries: hydrateDiary(
      profileId,
      page.map(row => [row.id, row.rewatch]),
      query.language,
      timeZone,
    ),
    total,
    distinctTitles,
    olderCursor: last && hasOlder ? cursorFor(last) : null,
    newerCursor: first && hasNewer ? cursorFor(first) : null,
    months,
  }
}
