import type { Follow, FollowQualityPreset } from '../../db/schema.ts'
import type { TitleSummary } from '../mine/cards.ts'
import type { EpisodeRef, SeriesSchedule } from './wanted.ts'
import { and, asc, count, desc, eq, isNotNull, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followEpisodes,
  followProfiles,
  follows,
  profiles,
} from '../../db/schema.ts'
import { watchedEpisodes } from '../mine/status.ts'
import { episodeProgress } from '../sources/progress.ts'
import { getTitleSummary } from '../tmdb/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { cursorOptions, defaultCursor } from './wanted.ts'

export type {
  EpisodeRef,
  FollowEpisodeState,
  SeriesSchedule,
} from './wanted.ts'

// Окно ожидания своей озвучки и качества: у фильма первые русские релизы часто
// с любительским переводом, дубляж выходит позже
const DEFAULT_WAIT_HOURS = { series: 24, movie: 72 } as const
const HOUR_MS = 60 * 60 * 1000

export class FollowNotFoundError extends Error {}

export interface FollowRules {
  voiceStudio?: string | null
  voiceStrict?: boolean
  requireRussian?: boolean
  waitHours?: number
  qualityPreset?: FollowQualityPreset
}

/** «С какой серии»: умолчание по просмотрам, один из пресетов или своя серия */
export type CursorChoice = 'auto' | 'new' | 'season' | 'beginning' | EpisodeRef

export function followOf(titleId: string) {
  return getDb()
    .select()
    .from(follows)
    .where(eq(follows.titleId, titleId))
    .get()
}

export function followById(id: string) {
  return getDb().select().from(follows).where(eq(follows.id, id)).get()
}

/** Подписанные профили в порядке профилей */
export function subscribersOf(followId: string) {
  return getDb()
    .select({ id: profiles.id, name: profiles.name, color: profiles.color })
    .from(followProfiles)
    .innerJoin(profiles, eq(profiles.id, followProfiles.profileId))
    .where(eq(followProfiles.followId, followId))
    .orderBy(asc(profiles.position))
    .all()
}

export function isSubscribed(followId: string, profileId: string) {
  return !!getDb()
    .select({ id: followProfiles.followId })
    .from(followProfiles)
    .where(
      and(
        eq(followProfiles.followId, followId),
        eq(followProfiles.profileId, profileId),
      ),
    )
    .get()
}

/** Слежения, на которые подписан профиль */
export function followsOfProfile(profileId: string) {
  return getDb()
    .select({ follow: follows })
    .from(followProfiles)
    .innerJoin(follows, eq(follows.id, followProfiles.followId))
    .where(eq(followProfiles.profileId, profileId))
    .all()
    .map(row => row.follow)
}

/** Слежение действует: идёт или стоит на паузе владельца */
export function isFollowing<T extends Pick<Follow, 'state'>>(
  follow: T | undefined,
): follow is T {
  return follow?.state === 'active' || follow?.state === 'paused'
}

export function scheduleOf(summary: TitleSummary): SeriesSchedule {
  const { last, next } = summary.airing ?? {}

  return {
    seasons: summary.details.seasons ?? [],
    last: last && { season: last.season, episode: last.episode },
    next: next && { season: next.season, episode: next.episode },
  }
}

function watchedOf(profileId: string, titleId: string) {
  return watchedEpisodes(episodeProgress(profileId, titleId))
}

/** Курсор по выбору зрителя; у фильма — 0/0 */
export function resolveCursor(
  choice: CursorChoice,
  schedule: SeriesSchedule | undefined,
  profileId: string,
  titleId: string,
): EpisodeRef {
  if (!schedule)
    return { season: 0, episode: 0 }

  if (typeof choice === 'object')
    return choice

  if (choice === 'auto')
    return defaultCursor(schedule, watchedOf(profileId, titleId))

  return cursorOptions(schedule)[choice]
}

/**
 * Окно ожидания сменили: отложенные кандидаты ждут от того же первого
 * появления серии, но новый срок.
 */
function rescheduleWaits(
  db: Pick<ReturnType<typeof getDb>, 'update'>,
  followId: string,
  waitHours: number,
) {
  db.update(followEpisodes)
    .set({
      waitUntil: sql`${followEpisodes.firstSeenAt} + ${waitHours * HOUR_MS}`,
    })
    .where(
      and(
        eq(followEpisodes.followId, followId),
        isNotNull(followEpisodes.waitUntil),
      ),
    )
    .run()
}

function rulesOf(rules: FollowRules = {}) {
  return Object.fromEntries(
    Object.entries(rules).filter(([, value]) => value !== undefined),
  ) as FollowRules
}

/**
 * Подписывает профиль. Первая подписка создаёт слежение с правилами по
 * умолчанию и курсором по просмотрам профиля; подписка на остановленное
 * слежение запускает его заново с новым курсором: старый курсор скачал бы всё,
 * что вышло за время остановки. Детали TMDB нужны только новому или
 * остановленному слежению и смене курсора; ошибки TMDB — `TmdbError`.
 */
export async function followTitle(
  titleId: string,
  profileId: string,
  input: { start?: CursorChoice, rules?: FollowRules },
  language: string,
): Promise<Follow> {
  const ref = parseCatalogId(titleId)

  if (!ref)
    throw new FollowNotFoundError()

  const kind = ref.type === 'movie' ? 'movie' : 'series'
  const existing = followOf(titleId)
  const restart = !existing || existing.state === 'stopped'
  const summary
    = !existing || (kind === 'series' && (restart || input.start))
      ? await getTitleSummary(titleId, language)
      : undefined
  const schedule
    = kind === 'series' && summary ? scheduleOf(summary) : undefined
  const start
    = restart || input.start
      ? resolveCursor(input.start ?? 'auto', schedule, profileId, titleId)
      : undefined
  const rules = rulesOf(input.rules)
  const now = new Date()

  return getDb().transaction((tx) => {
    const current = tx
      .select()
      .from(follows)
      .where(eq(follows.titleId, titleId))
      .get()
    const row = current
      ? tx
          .update(follows)
          .set({
            ...rules,
            ...(start && {
              startSeason: start.season,
              startEpisode: start.episode,
              // Новый курсор — новые нужные серии: ищем сразу
              lastSearchAt: null,
            }),
            ...(current.state === 'stopped' && { state: 'active' as const }),
            nextSearchAt: null,
            updatedAt: now,
          })
          .where(eq(follows.id, current.id))
          .returning()
          .get()
      : tx
          .insert(follows)
          .values({
            titleId,
            kind,
            state: 'active',
            startSeason: start?.season ?? 0,
            startEpisode: start?.episode ?? 0,
            requireRussian: summary?.details.originalLanguage !== 'ru',
            waitHours: DEFAULT_WAIT_HOURS[kind],
            ...rules,
            createdByProfileId: profileId,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get()

    tx.insert(followProfiles)
      .values({ followId: row.id, profileId, createdAt: now })
      .onConflictDoNothing()
      .run()

    if (current && rules.waitHours !== undefined)
      rescheduleWaits(tx, row.id, rules.waitHours)

    return row
  })
}

/**
 * Отписывает профиль. Последний отписавшийся останавливает слежение: новое не
 * ищется и не качается, начатые закачки и библиотека остаются.
 */
export function unfollowTitle(titleId: string, profileId: string) {
  const follow = followOf(titleId)

  if (!follow)
    return undefined

  return getDb().transaction((tx) => {
    tx.delete(followProfiles)
      .where(
        and(
          eq(followProfiles.followId, follow.id),
          eq(followProfiles.profileId, profileId),
        ),
      )
      .run()

    const left = tx
      .select({ count: count() })
      .from(followProfiles)
      .where(eq(followProfiles.followId, follow.id))
      .get()

    if ((left?.count ?? 0) > 0 || !isFollowing(follow))
      return follow

    return tx
      .update(follows)
      .set({ state: 'stopped', nextSearchAt: null, updatedAt: new Date() })
      .where(eq(follows.id, follow.id))
      .returning()
      .get()
  })
}

export interface FollowPatch {
  rules?: FollowRules
  start?: CursorChoice
  /** Пауза и возобновление — из панели */
  state?: 'active' | 'paused'
}

/** Правка из панели; смена курсора по пресету читает расписание из TMDB */
export async function updateFollow(
  id: string,
  patch: FollowPatch,
  language: string,
) {
  const follow = followById(id)

  if (!follow)
    return undefined

  let start: EpisodeRef | undefined

  if (patch.start) {
    const summary
      = follow.kind === 'series' && typeof patch.start !== 'object'
        ? await getTitleSummary(follow.titleId, language)
        : undefined

    // «По просмотрам» у слежения на сервер — по профилю, который его включил
    start
      = follow.kind === 'series'
        ? resolveCursor(
            patch.start,
            summary ? scheduleOf(summary) : { seasons: [] },
            follow.createdByProfileId ?? '',
            follow.titleId,
          )
        : undefined
  }

  const rules = rulesOf(patch.rules)

  if (rules.waitHours !== undefined)
    rescheduleWaits(getDb(), id, rules.waitHours)

  return getDb()
    .update(follows)
    .set({
      ...rules,
      ...(start && {
        startSeason: start.season,
        startEpisode: start.episode,
        lastSearchAt: null,
      }),
      ...(patch.state && { state: patch.state }),
      // Планировщик посмотрит слежение заново: правила или курсор сменились
      nextSearchAt: null,
      updatedAt: new Date(),
    })
    .where(eq(follows.id, id))
    .returning()
    .get()
}

/** Удаление слежения целиком; скачанное и библиотека остаются */
export function deleteFollow(id: string) {
  return getDb().delete(follows).where(eq(follows.id, id)).run().changes > 0
}

/** Все слежения, свежие сверху */
export function listFollows() {
  return getDb().select().from(follows).orderBy(desc(follows.createdAt)).all()
}
