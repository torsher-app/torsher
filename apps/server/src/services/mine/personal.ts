import type { z } from 'zod'
import type { MineKind, MineRatingFilter } from '../../dto/mine.ts'
import type {
  mineContinueQuery,
  MineStart,
  mineWatchedQuery,
} from '../../dto/minePersonal.ts'
import type { ProfileTitle } from '../../db/schema.ts'
import type { CurrentProfile } from './personalAccess.ts'
import type { ProgressPoint } from './status.ts'
import { and, eq, notExists, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  collectionHiddenProfiles,
  collections,
  mineProfilePreferences,
  mineTitlePreferences,
  profileTitles,
  rewatchCycles,
  titleProgress,
} from '../../db/schema.ts'
import {
  collectionItems,
  visibleCollectionRef,
  visibleCollections,
} from '../collections/index.ts'
import { allowedTitleIds, titleAllowedCached } from '../profiles/access.ts'
import { getProfile } from '../profiles/index.ts'
import { getTitleProgress, markWatched } from '../sources/progress.ts'
import { resumeTarget, visibleResumeSource } from '../sources/resume.ts'
import { TMDB_MAX_CACHE_AGE_MS } from '../tmdb/cache.ts'
import { cachedTitleAges } from '../tmdb/certification.ts'
import { cachedTvAiring } from '../tmdb/index.ts'
import { ensureDiaryTimeZone } from '../transfer/diaryTimeZone.ts'
import { calendarDayAt } from './calendar.ts'
import { cycleWire, unfinishedCycle } from './cycles.ts'
import { validateDiaryTarget } from './diaryWrites.ts'
import {
  droppedSince,
  kindOf,
  markTitleWatched,
  MineNotFoundError,
} from './index.ts'
import {
  facetsFilter,
  firstDayInterestScope,
  metadataTail,
} from './journal.ts'
import { allowMineTitle, MinePersonalError } from './personalAccess.ts'
import { localMineMetadata, localTitleDetails } from './personalMetadata.ts'
import { lastWatchedAt, titleStatus } from './status.ts'
import { personalSeenRows } from './seen.ts'

function startOf(profileId: string): MineStart {
  const row = getDb()
    .select()
    .from(mineProfilePreferences)
    .where(eq(mineProfilePreferences.profileId, profileId))
    .get()
  const visible
    = row?.startCollectionId
      && visibleCollectionRef(profileId, { id: row.startCollectionId })
  if (visible)
    return { kind: 'collection', collectionId: visible.id }
  return {
    kind: 'section',
    section: row?.startCollectionId
      ? 'continue'
      : (row?.startSection ?? 'continue'),
  }
}

function listCounts(
  rows: Iterable<ProfileTitle>,
  allowed?: ReadonlySet<string>,
) {
  const counts = { watchlist: 0, favorites: 0, ratings: 0 }
  for (const row of rows) {
    if (allowed && !allowed.has(row.titleId))
      continue
    counts.watchlist += Number(!!row.watchlistAt)
    counts.favorites += Number(!!row.favoriteAt)
    counts.ratings += Number(row.rating !== null)
  }
  return counts
}

export function getMineBootstrap(current: CurrentProfile) {
  const profileId = current()
  const profile = getProfile(profileId)!
  const tz = ensureDiaryTimeZone()
  const db = getDb()
  const visible = db
    .select({ id: collections.id, name: collections.name })
    .from(collections)
    .where(
      notExists(
        db
          .select()
          .from(collectionHiddenProfiles)
          .where(
            and(
              eq(collectionHiddenProfiles.collectionId, collections.id),
              eq(collectionHiddenProfiles.profileId, profileId),
            ),
          ),
      ),
    )
    .all()
    .sort((a, b) => a.name.localeCompare(b.name))
  const simple
    = profile.ageLimit === null
      ? listCounts(
          db
            .select()
            .from(profileTitles)
            .where(eq(profileTitles.profileId, profileId))
            .all(),
        )
      : { watchlist: null, favorites: null, ratings: null }
  return {
    version: 1 as const,
    profileId,
    language: profile.language,
    timeZone: tz,
    today: calendarDayAt(Date.now(), tz),
    start: startOf(profileId),
    collections: visible.map(row => ({ ...row, count: null })),
    counts: {
      ...simple,
      continue: null,
      schedule: null,
      watched: null,
      dropped: null,
    },
  }
}

export function putMineStart(current: CurrentProfile, start: MineStart) {
  const profileId = current()
  if (
    start.kind === 'collection'
    && !visibleCollectionRef(profileId, { id: start.collectionId })
  ) {
    throw new MinePersonalError('notFound', 404)
  }
  const data = {
    startSection:
      start.kind === 'section' ? start.section : ('continue' as const),
    startCollectionId: start.kind === 'collection' ? start.collectionId : null,
    updatedAt: new Date(),
  }
  getDb()
    .insert(mineProfilePreferences)
    .values({ profileId, ...data })
    .onConflictDoUpdate({ target: mineProfilePreferences.profileId, set: data })
    .run()
  return { start: startOf(profileId) }
}

interface Seen {
  title: boolean
  episodes: Set<string>
}

function personalSeenOf(profileId: string, titleId?: string) {
  const rows = personalSeenRows(profileId, titleId)
  const result = new Map<string, Seen>()
  for (const row of rows) {
    const seen = result.get(row.titleId) ?? {
      title: false,
      episodes: new Set(),
    }
    if (row.episode)
      seen.episodes.add(`${row.season}:${row.episode}`)
    else seen.title = true
    result.set(row.titleId, seen)
  }
  return result
}

function personalScope(profileId: string, language: string, titleId?: string) {
  const db = getDb()
  const progress = new Map<string, ProgressPoint[]>()
  const mine = new Map(
    db
      .select()
      .from(profileTitles)
      .where(
        and(
          eq(profileTitles.profileId, profileId),
          titleId ? eq(profileTitles.titleId, titleId) : undefined,
        ),
      )
      .all()
      .map(row => [row.titleId, row]),
  )
  const preferences = new Map(
    db
      .select()
      .from(mineTitlePreferences)
      .where(
        and(
          eq(mineTitlePreferences.profileId, profileId),
          titleId ? eq(mineTitlePreferences.titleId, titleId) : undefined,
        ),
      )
      .all()
      .map(row => [row.titleId, row]),
  )
  const seen = personalSeenOf(profileId, titleId)
  for (const row of db
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        titleId ? eq(titleProgress.titleId, titleId) : undefined,
      ),
    )
    .all()) {
    const points = progress.get(row.titleId) ?? []
    points.push(row)
    progress.set(row.titleId, points)
  }

  function item(id: string) {
    const kind = kindOf(id)
    const details
      = kind === 'series' ? localTitleDetails(id, language) : undefined
    const tv = details ? cachedTvAiring(id) : undefined
    const own = mine.get(id)
    const points = progress.get(id) ?? []
    const personal = seen.get(id)
    const statusInput = {
      kind,
      progress: points,
      watchedMarkedAt: own?.watchedMarkedAt,
      droppedAt: own?.droppedAt,
      rating: own?.rating,
      seasons: details?.seasons,
      ongoing: details?.ongoing,
      lastAired: tv?.last,
      next: tv?.next,
    }
    const normalStatus = titleStatus(statusInput)
    return {
      titleId: id,
      kind,
      details,
      own,
      points,
      seen: personal,
      preference: preferences.get(id),
      lastAt: lastWatchedAt(points) ?? own?.watchedMarkedAt ?? own?.ratedAt,
      normalStatus,
      statusInput,
      status: personal
        ? titleStatus({ ...statusInput, diarySeen: personal })
        : normalStatus,
    }
  }
  return {
    item,
    mine,
    ids: new Set([
      ...mine.keys(),
      ...progress.keys(),
      ...seen.keys(),
      ...preferences.keys(),
    ]),
  }
}

/** Shared cache-only status, including imported diary events. */
export function personalTitleStatus(
  profileId: string,
  titleId: string,
  language: string,
) {
  return personalScope(profileId, language, titleId).item(titleId).status
}

export function getMineTitlePersonal(
  current: CurrentProfile,
  titleId: string,
  language: string,
  target: { season?: number, episode?: number } = {},
) {
  const profileId = current()
  if (
    !/^tmdb:(?:movie|tv):[1-9]\d*$/.test(titleId)
    || !titleAllowedCached(profileId, titleId)
  ) {
    throw new MinePersonalError('notFound', 404)
  }
  const item = personalScope(profileId, language, titleId).item(titleId)
  const season = target.season
  const episode = target.episode
  const cycle = unfinishedCycle(profileId, titleId)
  return {
    titleId,
    note: item.preference?.note ?? null,
    continuation: item.preference?.continuation ?? ('normal' as const),
    notInterested: item.preference?.notInterested ?? false,
    status: item.status,
    seen: {
      title:
        titleStatus({
          ...item.statusInput,
          droppedAt: null,
          rating: null,
          diarySeen: item.seen,
        }) === 'watched',
      episode:
        season === undefined || episode === undefined
          ? null
          : !!item.seen?.episodes.has(`${season}:${episode}`)
            || !!getTitleProgress({ profileId, titleId, season, episode })
              ?.watchedAt,
    },
    cycle: cycle ? cycleWire(cycle, language) : null,
  }
}

export async function patchMineTitle(
  current: CurrentProfile,
  titleId: string,
  language: string,
  patch: {
    note?: string | null
    continuation?: 'normal' | 'paused' | 'hidden'
    notInterested?: boolean
  },
) {
  await allowMineTitle(titleId, current)
  const profileId = current()
  const change = {
    ...(patch.note !== undefined && { note: patch.note }),
    ...(patch.continuation !== undefined && {
      continuation: patch.continuation,
    }),
    ...(patch.notInterested !== undefined && {
      notInterested: patch.notInterested,
    }),
  }
  if (Object.keys(change).length) {
    const data = { ...change, updatedAt: new Date() }
    getDb()
      .insert(mineTitlePreferences)
      .values({ profileId, titleId, ...data })
      .onConflictDoUpdate({
        target: [mineTitlePreferences.profileId, mineTitlePreferences.titleId],
        set: data,
      })
      .run()
  }
  return getMineTitlePersonal(current, titleId, language)
}

export async function putMineSeen(
  current: CurrentProfile,
  ref: { titleId: string, season: number, episode: number },
  watched: boolean,
  language: string,
) {
  const title = watched
    ? await validateDiaryTarget(current, ref, language)
    : await allowMineTitle(ref.titleId, current)
  if (
    (ref.season > 0 && !ref.episode)
    || (ref.episode > 0 && title.type !== 'tv')
  ) {
    throw new MinePersonalError('invalidEpisode', 400)
  }

  const profileId = current()
  const beforeWrite = () => {
    current()
    if (!titleAllowedCached(profileId, ref.titleId))
      throw new MinePersonalError('notFound', 404)
  }
  if (ref.episode) {
    beforeWrite()
    markWatched({ profileId, ...ref }, watched)
  }
  else {
    try {
      await markTitleWatched(
        profileId,
        ref.titleId,
        watched,
        language,
        beforeWrite,
      )
    }
    catch (error) {
      if (error instanceof MineNotFoundError)
        throw new MinePersonalError('catalogUnavailable', 503)
      throw error
    }
  }
  return getMineTitlePersonal(
    current,
    ref.titleId,
    language,
    ref.episode ? ref : {},
  )
}

function ratingMatches(
  rating: number | null | undefined,
  filter: MineRatingFilter,
) {
  if (filter === 'any')
    return true
  if (filter === 'rated')
    return rating != null
  if (filter === 'unrated')
    return rating == null
  const [min, max] = filter.split('-').map(Number)
  return rating != null && rating >= min! && rating <= max!
}

function catalogIds(ids: Iterable<string>) {
  return [...ids].filter(id => /^tmdb:(?:movie|tv):[1-9]\d*$/.test(id))
}

function personalContinueScope(
  profileId: string,
  language: string,
  scope = personalScope(profileId, language),
) {
  const cycles = new Map(
    getDb()
      .select()
      .from(rewatchCycles)
      .where(eq(rewatchCycles.profileId, profileId))
      .all()
      .filter(row => row.state !== 'ended')
      .map(row => [row.titleId, row]),
  )
  return {
    scope,
    cycles,
    ids: catalogIds(new Set([...scope.ids, ...cycles.keys()])),
  }
}

function personalContinueCandidates(
  { scope, cycles }: ReturnType<typeof personalContinueScope>,
  ids: string[],
  {
    state,
    kind,
    rating,
  }: Pick<z.infer<typeof mineContinueQuery>, 'state' | 'kind' | 'rating'>,
) {
  return ids
    .map((id) => {
      const item = scope.item(id)
      return {
        ...item,
        cycle: cycles.get(id),
        continuation: item.preference?.continuation ?? ('normal' as const),
      }
    })
    .filter(
      row =>
        row.continuation === state
        && (kind === 'all' || row.kind === kind)
        && ratingMatches(row.own?.rating, rating)
        && (state !== 'normal'
          || row.normalStatus === 'watching'
          || row.cycle?.state === 'active'),
    )
}

export function personalContinueCount(
  profileId: string,
  language: string,
  kind: MineKind,
) {
  const continuing = personalContinueScope(profileId, language)
  return personalContinueCandidates(
    continuing,
    allowedLocalIds(profileId, continuing.ids),
    { state: 'normal', kind, rating: 'any' },
  ).length
}

export async function getMinePersonalContinue(
  current: CurrentProfile,
  query: z.infer<typeof mineContinueQuery>,
) {
  const profileId = current()
  const continuing = personalContinueScope(profileId, query.language)
  await loadMissingMineAges(profileId, continuing.ids)
  current()
  const candidates = personalContinueCandidates(
    continuing,
    allowedLocalIds(profileId, continuing.ids),
    query,
  )
    .map((row) => {
      const at
        = query.state !== 'normal'
          ? row.preference?.updatedAt
          : row.cycle?.state === 'active'
            ? row.cycle.updatedAt
            : row.lastAt
      return { ...row, time: at?.getTime() ?? 0 }
    })
    .sort(
      (a, b) =>
        (query.sort === 'rating'
          ? (b.own?.rating ?? 0) - (a.own?.rating ?? 0)
          : 0)
        || b.time - a.time
        || a.titleId.localeCompare(b.titleId),
    )
  const items = []
  for (const row of candidates.slice(
    query.offset,
    query.offset + query.limit,
  )) {
    const cycle = row.cycle ? cycleWire(row.cycle, query.language) : null
    const ordinary
      = cycle?.state === 'active'
        ? undefined
        : await resumeTarget(
            profileId,
            row.titleId,
            async () => row.details?.seasons,
          )
    current()
    if (!titleAllowedCached(profileId, row.titleId))
      continue
    const visible = ordinary && visibleResumeSource(profileId, ordinary)
    const normalPoint
      = ordinary
        && getTitleProgress({
          profileId,
          titleId: row.titleId,
          season: ordinary.season ?? 0,
          episode: ordinary.episode ?? 0,
        })
    items.push({
      titleId: row.titleId,
      kind: row.kind,
      continuation: row.continuation,
      cycle,
      ownRating: row.own?.rating ?? null,
      updatedAt: new Date(row.time).toISOString(),
      metadata: localMineMetadata(row.titleId, query.language),
      normalResume:
        ordinary && visible
          ? {
              season: ordinary.season ?? 0,
              episode: ordinary.episode ?? 0,
              position: ordinary.position,
              duration: ordinary.duration,
              next: ordinary.next,
              source: visible.mediaFileId
                ? { kind: 'library' as const, mediaFileId: visible.mediaFileId }
                : visible.file
                  ? { kind: 'torrent' as const, ...visible.file }
                  : null,
              voiceStudio: normalPoint?.voiceStudio ?? null,
              voiceType: normalPoint?.voiceType ?? null,
            }
          : null,
    })
  }
  return { profileId, items, total: candidates.length }
}

type WatchedQuery = z.infer<typeof mineWatchedQuery>
type TitleFilters = Pick<WatchedQuery, 'kind' | 'rating'>
interface DisplayTitle {
  titleId: string
  kind: 'movie' | 'series'
  ownRating: number | null
}

function inListFilters(row: DisplayTitle, query: TitleFilters) {
  return (
    (query.kind === 'all' || row.kind === query.kind)
    && ratingMatches(row.ownRating, query.rating)
  )
}

function allowedLocalIds(profileId: string, ids: string[]) {
  const limit = getProfile(profileId)?.ageLimit
  if (limit === null)
    return ids
  if (limit === undefined)
    return []
  const ages = cachedTitleAges(ids)
  return ids.filter(id => (ages.get(id) ?? Infinity) < limit)
}

async function loadMissingMineAges(profileId: string, ids: string[]) {
  if (getProfile(profileId)?.ageLimit === null)
    return
  const cached = cachedTitleAges(ids)
  const missing = ids.filter(id => !cached.has(id))
  if (missing.length)
    await allowedTitleIds(profileId, missing)
}

export function earlierMarkedTitles(profileId: string, language: string) {
  const rows = getDb().all<{ title_id: string }>(sql`
    SELECT title_id FROM (
      SELECT title_id FROM profile_titles WHERE profile_id = ${profileId} AND watched_marked_at IS NOT NULL
      UNION
      SELECT title_id FROM title_progress WHERE profile_id = ${profileId} AND watched_at IS NOT NULL
      UNION
      SELECT title_id FROM diary_seen WHERE profile_id = ${profileId}
      UNION
      SELECT title_id FROM cycle_playback_facts WHERE profile_id = ${profileId} AND watched_at IS NOT NULL
    ) m
    WHERE (title_id LIKE 'tmdb:movie:%' OR title_id LIKE 'tmdb:tv:%')
      AND NOT EXISTS (SELECT 1 FROM diary_entries d WHERE d.profile_id = ${profileId} AND d.title_id = m.title_id)
    ORDER BY title_id
  `)
  const ids = allowedLocalIds(
    profileId,
    rows.map(row => row.title_id),
  )
  if (!ids.length)
    return []
  const scope = personalScope(profileId, language)
  return ids.map(scope.item).filter(
    row =>
      titleStatus({
        ...row.statusInput,
        rating: null,
        diarySeen: row.seen,
      }) === 'watched',
  )
}

function firstDayInterestTitles(profileId: string, query: WatchedQuery) {
  const scope = firstDayInterestScope(profileId, query.language, query)
  const order = query.sort === 'rating' ? sql`rating DESC,` : sql``
  return getDb()
    .all<{ title_id: string, rating: number | null }>(
      sql`
    ${scope} SELECT title_id, rating FROM result
    ORDER BY ${order} max(COALESCE(rated_at, 0), COALESCE(favorite_at, 0)) DESC, title_id
  `,
    )
    .map(row => ({
      titleId: row.title_id,
      kind: kindOf(row.title_id),
      ownRating: row.rating,
    }))
}

function matchingFacets(rows: DisplayTitle[], query: WatchedQuery) {
  if (!rows.length || (!query.genre && !query.country))
    return rows
  const from = Date.now() - TMDB_MAX_CACHE_AGE_MS
  const ids = getDb().all<{ title_id: string }>(sql`
    WITH title_keys AS (SELECT value AS title_id FROM json_each(${JSON.stringify(rows.map(row => row.titleId))})),
    metadata AS (${metadataTail(query.language, from)})
    SELECT f.title_id FROM metadata f WHERE 1 = 1 ${facetsFilter(query)}
  `)
  const matching = new Set(ids.map(row => row.title_id))
  return rows.filter(row => matching.has(row.titleId))
}

function watchedTitles(scope: ReturnType<typeof personalScope>, ids: string[]) {
  return ids.map(scope.item).filter(row => row.status === 'watched')
}

export async function getMineSectionCounts(
  current: CurrentProfile,
  language: string,
) {
  const profileId = current()
  const scope = personalScope(profileId, language)
  const continuing = personalContinueScope(profileId, language, scope)
  const collections = visibleCollections(profileId).map(({ id }) => ({
    id,
    titles: collectionItems(id).map(item => item.titleId),
  }))
  const ids = [
    ...new Set([
      ...scope.ids,
      ...continuing.ids,
      ...collections.flatMap(item => item.titles),
    ]),
  ]
  await loadMissingMineAges(profileId, ids)
  current()
  const allowed = new Set(allowedLocalIds(profileId, ids))
  const dropped = droppedSince(profileId)
  return {
    profileId,
    counts: {
      ...listCounts(scope.mine.values(), allowed),
      continue: personalContinueCandidates(
        continuing,
        continuing.ids.filter(id => allowed.has(id)),
        { state: 'normal', kind: 'all', rating: 'any' },
      ).length,
      watched: watchedTitles(
        scope,
        catalogIds(scope.ids).filter(id => allowed.has(id)),
      ).length,
      dropped: [...dropped.keys()].filter(id => allowed.has(id)).length,
    },
    collections: collections.map(({ id, titles }) => ({
      id,
      count: titles.filter(titleId => allowed.has(titleId)).length,
    })),
  }
}

export async function getMinePersonalWatched(
  current: CurrentProfile,
  query: WatchedQuery,
) {
  const profileId = current()
  let rows: DisplayTitle[]
  if (query.source === 'ratingsAndFavorites') {
    rows = firstDayInterestTitles(profileId, query)
  }
  else {
    let watched
    if (query.source === 'earlierMarks') {
      watched = earlierMarkedTitles(profileId, query.language)
    }
    else {
      const scope = personalScope(profileId, query.language)
      const ids = catalogIds(scope.ids)
      await loadMissingMineAges(profileId, ids)
      current()
      watched = watchedTitles(scope, allowedLocalIds(profileId, ids))
    }
    rows = matchingFacets(
      watched
        .sort(
          (a, b) =>
            (query.sort === 'rating'
              ? (b.own?.rating ?? 0) - (a.own?.rating ?? 0)
              : 0)
            || (b.lastAt?.getTime() ?? 0) - (a.lastAt?.getTime() ?? 0)
            || a.titleId.localeCompare(b.titleId),
        )
        .map(row => ({
          titleId: row.titleId,
          kind: row.kind,
          ownRating: row.own?.rating ?? null,
        })),
      query,
    )
  }
  const items = rows.filter(row => inListFilters(row, query))
  return {
    profileId,
    total: items.length,
    items: items.slice(query.offset, query.offset + query.limit).map(row => ({
      ...row,
      metadata: localMineMetadata(row.titleId, query.language),
    })),
  }
}
