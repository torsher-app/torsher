import type { SQL } from 'drizzle-orm'
import { sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'
import { diaryTimeZone } from '../transfer/diaryTimeZone.ts'
import { calendarDayAt } from './calendar.ts'
import {
  countryValue,
  countryValues,
  firstDayInterestScope,
  hydrateDiary,
  journalRead,
  metadataTail,
  movieCriterion,
} from './journal.ts'
import { earlierMarkedTitles } from './personal.ts'
import { localMineMetadata } from './personalMetadata.ts'

function legacyMarks(profileId: string, language: string) {
  const found = earlierMarkedTitles(profileId, language)
  const movies = found.filter(row => row.kind === 'movie').length
  return {
    movies,
    series: found.length - movies,
    examples: found
      .slice(0, 5)
      .map(row => ({
        titleId: row.titleId,
        metadata: localMineMetadata(row.titleId, language),
      })),
  }
}

interface Totals {
  movies: number
  episodes: number
  series: number
  rewatch: number
  days: number
  distinctMovies: number
  distinctEpisodes: number
  runtimeMinutes: number
  runtimeKnown: number
  runtimeUnknown: number
}

function interestColumns(titleRows: SQL) {
  return sql`
    (
      SELECT json_object('titles', count(*), 'titlesWithMetadata', count(json))
      FROM (${titleRows})
    ) AS coverage,
    (
      SELECT json_group_array(json_array(type, value, label, n)) FROM (
        SELECT type, value, min(label) AS label, count(DISTINCT title_id) AS n FROM (
          SELECT 'genre' AS type, f.title_id, json_extract(genre.value, '$.id') AS value,
            json_extract(genre.value, '$.name') AS label
          FROM (${titleRows}) f, json_each(f.json, '$.genres') genre WHERE genre.type = 'object'
            AND typeof(json_extract(genre.value, '$.id')) = 'integer'
            AND json_extract(genre.value, '$.id') > 0
            AND typeof(json_extract(genre.value, '$.name')) = 'text'
          UNION ALL
          SELECT 'country' AS type, f.title_id, ${countryValue} AS value, ${countryValue} AS label
          FROM (${titleRows}) f, ${countryValues} country
          WHERE ${countryValue} GLOB '[A-Z][A-Z]'
        ) GROUP BY type, value ORDER BY n DESC, value
      )
    ) AS facets
  `
}

interface InterestAggregate {
  coverage: string
  facets: string
}
interface PeriodAggregate extends InterestAggregate {
  totals: string
  days: string
  recent: string
}
type InterestRow = ['genre' | 'country', number | string, string, number]

function periodStats(scope: SQL, language: string, threshold: number) {
  return getDb().get<PeriodAggregate>(sql`
    ${scope},
    objects AS MATERIALIZED (
      SELECT title_id, season, episode, count(*) AS n, sum(rewatch) AS rewatch
      FROM result GROUP BY title_id, season, episode
    ),
    title_keys AS (SELECT DISTINCT title_id FROM objects),
    metadata AS MATERIALIZED (${metadataTail(language, threshold)}),
    season_keys AS (SELECT DISTINCT title_id, season FROM objects WHERE episode > 0),
    season_keys_localized AS MATERIALIZED (
      SELECT k.title_id, k.season, m.json,
        CASE WHEN m.key = k.title_id || ':season:' || k.season || ':' || ${language} THEN 0
          WHEN m.key LIKE '%:en-US' THEN 1 ELSE 2 END AS priority
      FROM season_keys k JOIN meta_cache m ON m.key IN (
        k.title_id || ':season:' || k.season || ':' || ${language},
        k.title_id || ':season:' || k.season || ':en-US',
        k.title_id || ':season:' || k.season || ':ru-RU'
      ) AND m.fetched_at > ${threshold} AND json_valid(m.json)
    ),
    episode_runtimes AS MATERIALIZED (
      SELECT wanted.title_id, wanted.season, wanted.episode, k.priority,
        CAST(e.key AS INTEGER) AS episode_index, json_extract(e.value, '$.runtime') AS minutes
      FROM season_keys_localized k
      CROSS JOIN json_each(k.json, '$.episodes') e
      CROSS JOIN objects wanted
      WHERE e.type = 'object'
        AND wanted.title_id = k.title_id AND wanted.season = k.season
        AND wanted.episode = json_extract(e.value, '$.episode_number')
        AND json_type(e.value, '$.episode_number') = 'integer'
        AND json_type(e.value, '$.runtime') = 'integer'
        AND json_extract(e.value, '$.runtime') > 0
    ),
    object_runtime AS MATERIALIZED (
      SELECT f.*, CASE
        WHEN ${movieCriterion} THEN json_extract(m.json, '$.runtime')
        WHEN f.episode > 0 THEN (
          SELECT ep.minutes FROM episode_runtimes ep
          WHERE ep.title_id = f.title_id AND ep.season = f.season AND ep.episode = f.episode
          ORDER BY ep.priority, ep.episode_index LIMIT 1
        )
      END AS minutes
      FROM objects f
      LEFT JOIN metadata m ON m.title_id = f.title_id
    ),
    days AS MATERIALIZED (
      SELECT local_day AS day, count(*) AS n FROM result GROUP BY local_day ORDER BY local_day
    )
    SELECT
      (SELECT json_object(
        'movies', COALESCE(sum(n) FILTER (WHERE ${movieCriterion}), 0),
        'episodes', COALESCE(sum(n) FILTER (WHERE episode > 0), 0),
        'series', COALESCE(sum(n) FILTER (WHERE title_id LIKE 'tmdb:tv:%' AND episode = 0), 0),
        'rewatch', COALESCE(sum(rewatch), 0),
        'days', (SELECT count(*) FROM days),
        'distinctMovies', count(*) FILTER (WHERE ${movieCriterion}),
        'distinctEpisodes', count(*) FILTER (WHERE episode > 0),
        'runtimeMinutes', COALESCE(sum(n * CAST(minutes AS INTEGER)) FILTER (WHERE minutes > 0), 0),
        'runtimeKnown', COALESCE(sum(n) FILTER (WHERE minutes > 0), 0),
        'runtimeUnknown', COALESCE(sum(n) FILTER (WHERE minutes > 0 IS NOT TRUE), 0)
      ) FROM object_runtime f) AS totals,
      (SELECT json_group_array(json_array(day, n)) FROM days) AS days,
      (SELECT json_group_array(json_array(id, rewatch)) FROM (
        SELECT id, rewatch FROM result ORDER BY local_day DESC, precision_rank DESC, instant_sort DESC, id DESC LIMIT 5
      )) AS recent,
      ${interestColumns(sql`SELECT title_id, json FROM metadata`)}
  `)!
}

export function getMineOverview(
  profileId: string,
  language: string,
  requested?: string,
  now = Date.now(),
) {
  const timeZone = diaryTimeZone()
  const today = calendarDayAt(now, timeZone)
  const period = requested ?? today.slice(0, 7)
  const filter = {
    kind: 'all' as const,
    rewatch: 'any' as const,
    date: 'dated' as const,
    ...(period.length === 4
      ? { year: period }
      : period.length === 7
        ? { month: period }
        : { day: period }),
  }
  const reader = journalRead({ profileId, language, filter }, timeZone, now)
  const stats = periodStats(
    reader.scope(),
    language,
    now - TMDB_MAX_CACHE_AGE_MS,
  )
  const days = (JSON.parse(stats.days) as [string, number][]).map(
    ([day, count]) => ({ day, count }),
  )
  const hasDatedDiary = days.length > 0 || reader.hasDatedHistory()
  const interests = hasDatedDiary
    ? stats
    : getDb().get<InterestAggregate>(sql`
    ${firstDayInterestScope(profileId, language, {}, now)}
    SELECT ${interestColumns(sql`SELECT title_id, json FROM result`)}
  `)!
  const coverage = JSON.parse(interests.coverage) as {
    titles: number
    titlesWithMetadata: number
  }
  const facets = JSON.parse(interests.facets) as InterestRow[]
  return {
    profileId,
    timeZone,
    today,
    period,
    totals: JSON.parse(stats.totals) as Totals,
    days,
    recent: hydrateDiary(
      profileId,
      JSON.parse(stats.recent) as [string, number][],
      language,
      timeZone,
    ),
    interests: {
      source: hasDatedDiary
        ? ('diary' as const)
        : ('ratingsAndFavorites' as const),
      ...coverage,
      genres: facets.flatMap(([type, value, label, count]) =>
        type === 'genre' && typeof value === 'number'
          ? [{ value, label, count }]
          : [],
      ),
      countries: facets.flatMap(([type, value, , count]) =>
        type === 'country' && typeof value === 'string'
          ? [{ value, count }]
          : [],
      ),
    },
    previousMarks: legacyMarks(profileId, language),
  }
}
