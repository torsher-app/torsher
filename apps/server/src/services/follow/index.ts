import type {
  Follow,
  FollowAudio,
  FollowMode,
  FollowQualityPreset,
} from '../../db/schema.ts'
import type { TitleSummary } from '../mine/cards.ts'
import type { EpisodeRef, SeriesSchedule } from './wanted.ts'
import { and, asc, count, desc, eq, gt, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followEpisodes,
  followProfiles,
  follows,
  profiles,
} from '../../db/schema.ts'
import { getTitleSummary } from '../tmdb/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { applyModeChange } from './pick.ts'
import { followSettings } from './settings.ts'
import { firstUnaired } from './wanted.ts'

export type {
  EpisodeRef,
  FollowEpisodeState,
  SeriesSchedule,
} from './wanted.ts'

const HOUR_MS = 60 * 60 * 1000

export class FollowNotFoundError extends Error {}

export interface FollowRules {
  voiceStudio?: string | null
  voiceStrict?: boolean
  requireRussian?: boolean
  waitHours?: number
  qualityPreset?: FollowQualityPreset
  mode?: FollowMode
  /** null — как у сервера */
  audio?: FollowAudio | null
}

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

/**
 * Курсор слежения — первая невышедшая серия: «Следить» только про новые
 * серии, вышедшее качают «Скачать сезон» или смотрят стримом. У фильма — 0/0
 */
function startOf(schedule: SeriesSchedule | undefined): EpisodeRef {
  return schedule ? firstUnaired(schedule) : { season: 0, episode: 0 }
}

/**
 * Окно ожидания сменили: отложенные кандидаты ждут от того же первого
 * появления серии, но новый срок. Кончившееся окно не продлевается: такой
 * кандидат уже ждёт захвата (в том числе выбор после смены режима), а форма
 * панели присылает окно при любой правке правил.
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
        gt(followEpisodes.waitUntil, new Date()),
      ),
    )
    .run()
}

/** Правила нового слежения из «Настройки → Слежу» */
function defaultRules(kind: Follow['kind'], originalLanguage?: string) {
  const defaults = followSettings().defaults

  return {
    waitHours: kind === 'movie' ? defaults.movieWaitHours : defaults.waitHours,
    qualityPreset: defaults.qualityPreset,
    mode: defaults.mode,
    requireRussian:
      defaults.requireRussian === 'auto'
        ? originalLanguage !== 'ru'
        : defaults.requireRussian === 'always',
  }
}

function rulesOf(rules: FollowRules = {}) {
  return Object.fromEntries(
    Object.entries(rules).filter(([, value]) => value !== undefined),
  ) as FollowRules
}

/**
 * Подписывает профиль. Первая подписка создаёт слежение с правилами по
 * умолчанию и курсором на первой невышедшей серии; подписка на остановленное
 * слежение запускает его заново с новым курсором: старый курсор скачал бы всё,
 * что вышло за время остановки. Детали TMDB нужны только новому или
 * остановленному слежению; ошибки TMDB — `TmdbError`.
 */
export async function followTitle(
  titleId: string,
  profileId: string,
  input: { rules?: FollowRules },
  language: string,
): Promise<Follow> {
  const ref = parseCatalogId(titleId)

  if (!ref)
    throw new FollowNotFoundError()

  const kind = ref.type === 'movie' ? 'movie' : 'series'
  const existing = followOf(titleId)
  const restart = !existing || existing.state === 'stopped'
  const summary
    = !existing || (kind === 'series' && restart)
      ? await getTitleSummary(titleId, language)
      : undefined
  const schedule
    = kind === 'series' && summary ? scheduleOf(summary) : undefined
  const start = restart ? startOf(schedule) : undefined
  const rules = rulesOf(input.rules)
  const now = new Date()

  const saved = getDb().transaction((tx) => {
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
            ...defaultRules(kind, summary?.details.originalLanguage),
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

  if (existing && rules.mode && rules.mode !== existing.mode)
    applyModeChange(saved, rules.mode)

  return saved
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
  /** Пауза и возобновление — из панели */
  state?: 'active' | 'paused'
}

/** Правка из панели */
export function updateFollow(id: string, patch: FollowPatch) {
  const follow = followById(id)

  if (!follow)
    return undefined

  const rules = rulesOf(patch.rules)

  if (rules.waitHours !== undefined)
    rescheduleWaits(getDb(), id, rules.waitHours)

  if (rules.mode && rules.mode !== follow.mode)
    applyModeChange(follow, rules.mode)

  return getDb()
    .update(follows)
    .set({
      ...rules,
      ...(patch.state && { state: patch.state }),
      // Планировщик посмотрит слежение заново: правила сменились
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
