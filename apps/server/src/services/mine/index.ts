import type { ProfileTitle } from '../../db/schema.ts'
import type {
  MineKind,
  MineRatingFilter,
  MineSectionId,
  MineSort,
  TitleMine,
  TitleStatus,
} from '../../dto/mine.ts'
import type { TitleSummary } from './cards.ts'
import type { ProgressPoint } from './status.ts'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { profileTitles, titleProgress } from '../../db/schema.ts'
import {
  collectionItems,
  collectionsWith,
  isVisibleTo,
  visibleCollections,
} from '../collections/index.ts'
import { episodeProgress, markWatched } from '../sources/progress.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { cardsOf, summariesOf, summaryOf } from './cards.ts'
import { ratingsOf } from './posterRatings.ts'
import { isDropped, lastWatchedAt, titleStatus } from './status.ts'

export { withPosterRatings } from './posterRatings.ts'

export class MineNotFoundError extends Error {}

export interface MinePatch {
  watchlist?: boolean
  favorite?: boolean
  rating?: number | null
  dropped?: boolean
}

export function kindOf(titleId: string) {
  return parseCatalogId(titleId)?.type === 'movie'
    ? ('movie' as const)
    : ('series' as const)
}

function whereTitle(profileId: string, titleId: string) {
  return and(
    eq(profileTitles.profileId, profileId),
    eq(profileTitles.titleId, titleId),
  )
}

export function getMineRow(profileId: string, titleId: string) {
  return getDb()
    .select()
    .from(profileTitles)
    .where(whereTitle(profileId, titleId))
    .get()
}

function isEmpty(row: ProfileTitle) {
  return !row.watchlistAt && !row.favoriteAt && !row.rating && !row.droppedAt
}

function stamp(on: boolean | undefined, current: Date | null, now: Date) {
  if (on === undefined)
    return current

  return on ? (current ?? now) : null
}

/**
 * Списки, оценка и «Брошено». Оценку фильму ставят после просмотра: он
 * считается просмотренным и уходит из «Позже». Пустая строка удаляется.
 */
export function updateMine(
  profileId: string,
  titleId: string,
  patch: MinePatch,
) {
  const db = getDb()
  const now = new Date()

  return db.transaction(() => {
    const current = getMineRow(profileId, titleId)
    const rating
      = patch.rating === undefined ? (current?.rating ?? null) : patch.rating
    const ratedNow = patch.rating !== undefined && patch.rating !== null
    const clearsWatchlist
      = ratedNow && kindOf(titleId) === 'movie' && patch.watchlist !== true
    const next: ProfileTitle = {
      profileId,
      titleId,
      watchlistAt: clearsWatchlist
        ? null
        : stamp(patch.watchlist, current?.watchlistAt ?? null, now),
      favoriteAt: stamp(patch.favorite, current?.favoriteAt ?? null, now),
      rating,
      ratedAt:
        patch.rating === undefined
          ? (current?.ratedAt ?? null)
          : patch.rating === null
            ? null
            : now,
      // Повторная отметка двигает время: «Брошено» снова действует после свежего просмотра
      droppedAt:
        patch.dropped === undefined
          ? (current?.droppedAt ?? null)
          : patch.dropped
            ? now
            : null,
      updatedAt: now,
    }

    if (isEmpty(next)) {
      db.delete(profileTitles).where(whereTitle(profileId, titleId)).run()

      return undefined
    }

    db.insert(profileTitles)
      .values(next)
      .onConflictDoUpdate({
        target: [profileTitles.profileId, profileTitles.titleId],
        set: next,
      })
      .run()

    return next
  })
}

/** Досмотренный фильм уходит из «Позже»: смотреть его «позже» уже незачем */
export function clearMovieWatchlist(profileId: string, titleId: string) {
  if (kindOf(titleId) !== 'movie')
    return

  const row = getMineRow(profileId, titleId)

  if (row?.watchlistAt)
    updateMine(profileId, titleId, { watchlist: false })
}

function progressRows(profileId: string, titleId?: string) {
  const rows = getDb()
    .select({
      titleId: titleProgress.titleId,
      season: titleProgress.season,
      episode: titleProgress.episode,
      position: titleProgress.position,
      duration: titleProgress.duration,
      watchedAt: titleProgress.watchedAt,
      updatedAt: titleProgress.updatedAt,
    })
    .from(titleProgress)
    .where(
      titleId
        ? and(
            eq(titleProgress.profileId, profileId),
            eq(titleProgress.titleId, titleId),
          )
        : eq(titleProgress.profileId, profileId),
    )
    .all()
  const byTitle = new Map<string, ProgressPoint[]>()

  for (const { titleId: id, ...point } of rows)
    byTitle.set(id, [...(byTitle.get(id) ?? []), point])

  return byTitle
}

function mineRows(profileId: string) {
  return new Map(
    getDb()
      .select()
      .from(profileTitles)
      .where(eq(profileTitles.profileId, profileId))
      .all()
      .map(row => [row.titleId, row]),
  )
}

/**
 * Тайтлы «Брошено» и время отметки: тайтл скрыт из «Продолжить», если отметка
 * позже его последнего просмотра.
 */
export function droppedSince(profileId: string) {
  const progress = progressRows(profileId)
  const dropped = new Map<string, Date>()

  for (const row of mineRows(profileId).values()) {
    if (
      row.droppedAt
      && isDropped(row.droppedAt, lastWatchedAt(progress.get(row.titleId) ?? []))
    ) {
      dropped.set(row.titleId, row.droppedAt)
    }
  }

  return dropped
}

export interface TitleState {
  titleId: string
  kind: 'movie' | 'series'
  status: TitleStatus | null
  // Последний просмотр; у оценённого без просмотра фильма — время оценки
  lastAt?: Date
  progress: ProgressPoint[]
  mine?: ProfileTitle
  summary?: TitleSummary
}

function stateOf(
  titleId: string,
  progress: ProgressPoint[],
  mine: ProfileTitle | undefined,
  summary: TitleSummary | undefined,
): TitleState {
  const kind = kindOf(titleId)
  const lastAt = lastWatchedAt(progress) ?? mine?.ratedAt ?? undefined

  return {
    titleId,
    kind,
    status: titleStatus({
      kind,
      progress,
      rating: mine?.rating,
      droppedAt: mine?.droppedAt,
      seasons: summary?.details.seasons,
      ongoing: summary?.details.ongoing,
      lastAired: summary?.airing?.last,
      next: summary?.airing?.next,
    }),
    lastAt,
    progress,
    mine,
    summary,
  }
}

/**
 * Статусы всех тайтлов профиля, у которых есть просмотры или отметки. Детали
 * TMDB нужны только сериалам: по ним видно, всё ли вышедшее просмотрено.
 */
export async function profileStates(profileId: string, language: string) {
  const progress = progressRows(profileId)
  const mine = mineRows(profileId)
  const ids = [...new Set([...progress.keys(), ...mine.keys()])]
  const series = ids.filter(
    id => kindOf(id) === 'series' && progress.has(id),
  )
  const summaries = new Map(
    (await summariesOf(series, language)).map((summary, index) => [
      series[index],
      summary,
    ]),
  )

  return ids.map(id =>
    stateOf(id, progress.get(id) ?? [], mine.get(id), summaries.get(id)),
  )
}

export async function titleState(
  profileId: string,
  titleId: string,
  language: string,
) {
  const progress = progressRows(profileId, titleId).get(titleId) ?? []
  const summary
    = kindOf(titleId) === 'series' && progress.length
      ? await summaryOf(titleId, language)
      : undefined

  return stateOf(titleId, progress, getMineRow(profileId, titleId), summary)
}

export async function getTitleMine(
  profileId: string,
  titleId: string,
  language: string,
): Promise<TitleMine> {
  const state = await titleState(profileId, titleId, language)
  const contains = collectionsWith(titleId)

  return {
    watchlist: !!state.mine?.watchlistAt,
    favorite: !!state.mine?.favoriteAt,
    rating: state.mine?.rating ?? null,
    status: state.status,
    collections: visibleCollections(profileId).map(item => ({
      id: item.id,
      name: item.name,
      contains: contains.has(item.id),
    })),
  }
}

/**
 * «Отметить просмотренным»: фильм — отметкой, сериал — всеми вышедшими
 * сериями. Снятие убирает отметки и позиции всех серий тайтла.
 */
export async function markTitleWatched(
  profileId: string,
  titleId: string,
  watched: boolean,
  language: string,
) {
  if (kindOf(titleId) === 'movie') {
    markWatched({ profileId, titleId }, watched)

    if (watched)
      clearMovieWatchlist(profileId, titleId)

    return
  }

  if (!watched) {
    for (const point of episodeProgress(profileId, titleId)) {
      markWatched(
        { profileId, titleId, season: point.season, episode: point.episode },
        false,
      )
    }

    return
  }

  const summary = await summaryOf(titleId, language)

  if (!summary)
    throw new MineNotFoundError('Title details unavailable')

  for (const season of summary.details.seasons ?? []) {
    for (let episode = 1; episode <= season.airedEpisodeCount; episode++)
      markWatched({ profileId, titleId, season: season.number, episode }, true)
  }
}

export interface MineQuery {
  section: MineSectionId
  collection?: string
  sort: MineSort
  kind: MineKind
  rating: MineRatingFilter
  offset: number
  limit: number
  language: string
}

interface Entry {
  titleId: string
  at: Date
}

function byTimeDesc(a: Entry, b: Entry) {
  return b.at.getTime() - a.at.getTime()
}

function statusEntries(states: TitleState[], status: TitleStatus) {
  return states
    .filter(state => state.status === status)
    .map(state => ({
      titleId: state.titleId,
      at:
        (status === 'dropped' ? state.mine?.droppedAt : state.lastAt)
        ?? new Date(0),
    }))
}

function listEntries(profileId: string, field: 'watchlistAt' | 'favoriteAt') {
  return [...mineRows(profileId).values()].flatMap((row) => {
    const at = row[field]

    return at ? [{ titleId: row.titleId, at }] : []
  })
}

// «Продолжить» в «Моё» — всё, что профиль смотрит сейчас; ряд главной строит свой срез
const STATUS_OF_SECTION = {
  continue: 'watching',
  watched: 'watched',
  dropped: 'dropped',
} as const

async function sectionEntries(
  profileId: string,
  query: Pick<MineQuery, 'section' | 'collection' | 'language'>,
  states?: TitleState[],
) {
  switch (query.section) {
    case 'watchlist':
      return listEntries(profileId, 'watchlistAt')
    case 'favorites':
      return listEntries(profileId, 'favoriteAt')
    case 'collection': {
      if (!query.collection || !isVisibleTo(query.collection, profileId))
        throw new MineNotFoundError('Collection not found')

      return collectionItems(query.collection).map(item => ({
        titleId: item.titleId,
        at: item.at,
      }))
    }
    default:
      return statusEntries(
        states ?? (await profileStates(profileId, query.language)),
        STATUS_OF_SECTION[query.section],
      )
  }
}

function matchesRating(rating: number | undefined, filter: MineRatingFilter) {
  switch (filter) {
    case 'any':
      return true
    case 'rated':
      return rating !== undefined
    case 'unrated':
      return rating === undefined
    default: {
      const [from, to] = filter.split('-').map(Number)

      return rating !== undefined && rating >= from && rating <= to
    }
  }
}

/** Раздел «Моё»: фильтры и сортировка — по базе, карточки — только для страницы */
export async function mineItems(profileId: string, query: MineQuery) {
  const entries = await sectionEntries(profileId, query)
  const ratings = ratingsOf(
    profileId,
    entries.map(entry => entry.titleId),
  )
  const filtered = entries
    .filter(
      entry => query.kind === 'all' || kindOf(entry.titleId) === query.kind,
    )
    .filter(entry => matchesRating(ratings.get(entry.titleId), query.rating))
    .sort((a, b) => {
      if (query.sort === 'rating') {
        const diff
          = (ratings.get(b.titleId) ?? 0) - (ratings.get(a.titleId) ?? 0)

        if (diff)
          return diff
      }

      return byTimeDesc(a, b)
    })
  const page = filtered.slice(query.offset, query.offset + query.limit)

  return {
    items: await cardsOf(
      page.map(entry => entry.titleId),
      query.language,
    ),
    total: filtered.length,
  }
}

/** Разделы экрана «Моё» со счётчиками; подборки — видимые профилю */
export async function mineSections(profileId: string, language: string) {
  const states = await profileStates(profileId, language)
  const count = (status: TitleStatus) =>
    states.filter(state => state.status === status).length

  return [
    { id: 'continue' as const, count: count('watching') },
    {
      id: 'watchlist' as const,
      count: listEntries(profileId, 'watchlistAt').length,
    },
    {
      id: 'favorites' as const,
      count: listEntries(profileId, 'favoriteAt').length,
    },
    ...visibleCollections(profileId).map(item => ({
      id: 'collection' as const,
      collectionId: item.id,
      name: item.name,
      count: item.count,
    })),
    { id: 'watched' as const, count: count('watched') },
    { id: 'dropped' as const, count: count('dropped') },
  ]
}

/** Карточки «Позже» для ряда главной: свежие сверху */
export async function watchlistCards(
  profileId: string,
  language: string,
  limit: number,
) {
  const ids = listEntries(profileId, 'watchlistAt')
    .sort(byTimeDesc)
    .slice(0, limit)
    .map(entry => entry.titleId)

  return cardsOf(ids, language)
}

/** Карточки подборки для ряда главной и панели */
export async function collectionCards(
  id: string,
  language: string,
  limit?: number,
) {
  const ids = collectionItems(id).map(item => item.titleId)

  return cardsOf(limit ? ids.slice(0, limit) : ids, language)
}
