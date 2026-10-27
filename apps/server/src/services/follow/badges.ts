import { and, eq, inArray, isNotNull, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followEpisodes,
  followProfiles,
  follows,
  titleProgress,
} from '../../db/schema.ts'
import { watchedEpisodes } from '../mine/status.ts'
import { isProgressWatched } from '../sources/progress.ts'
import { episodeKey } from './wanted.ts'

/**
 * Значок «слежу» на постерах: тайтлы, за которыми следит профиль, и сколько
 * серий автоматика положила в библиотеку или выбрала, а профиль не досмотрел
 */
export function followBadges(profileId: string, titleIds: string[]) {
  const badges = new Map<string, number>()

  if (!titleIds.length)
    return badges

  const db = getDb()
  const followed = db
    .select({ id: follows.id, titleId: follows.titleId })
    .from(followProfiles)
    .innerJoin(follows, eq(follows.id, followProfiles.followId))
    .where(
      and(
        eq(followProfiles.profileId, profileId),
        inArray(follows.titleId, [...new Set(titleIds)]),
        inArray(follows.state, ['active', 'paused']),
      ),
    )
    .all()

  if (!followed.length)
    return badges

  const downloaded = db
    .select({
      followId: followEpisodes.followId,
      season: followEpisodes.season,
      episode: followEpisodes.episode,
    })
    .from(followEpisodes)
    .where(
      and(
        inArray(
          followEpisodes.followId,
          followed.map(item => item.id),
        ),
        // Серия, которую заменяет апгрейд, уже лежит в библиотеке
        or(
          isNotNull(followEpisodes.downloadedAt),
          isNotNull(followEpisodes.upgradeFrom),
          isNotNull(followEpisodes.picked),
        ),
      ),
    )
    .all()
  const progress = db
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        inArray(
          titleProgress.titleId,
          followed.map(item => item.titleId),
        ),
      ),
    )
    .all()

  for (const { id, titleId } of followed) {
    const watched = watchedEpisodes(
      progress.filter(point => point.titleId === titleId),
    )

    badges.set(
      titleId,
      downloaded.filter(
        row =>
          row.followId === id
          && row.season > 0
          && !watched.has(episodeKey(row)),
      ).length,
    )
  }

  return badges
}

/** Новая серия слежения, которую профиль ещё не досмотрел */
export interface FollowNewEpisode {
  season: number
  episode: number
  /** Когда серия стала готова или легла в библиотеку */
  at: Date
  /** Файл скачанной серии; у выбора режима `notify` его нет */
  file: { torrentId: string, fileIndex: number } | null
}

/**
 * Новые серии слежений профиля для «Продолжить»: по тайтлу — первая серия
 * после самой дальней, которую профиль открывал, из тех, что автоматика
 * положила в библиотеку или выбрала; дальняя не досмотрена — новой нет.
 * `at` — самое свежее такое событие тайтла
 */
export function followNewEpisodes(profileId: string) {
  const fresh = new Map<string, FollowNewEpisode>()
  const db = getDb()
  const followed = db
    .select({ id: follows.id, titleId: follows.titleId })
    .from(followProfiles)
    .innerJoin(follows, eq(follows.id, followProfiles.followId))
    .where(
      and(
        eq(followProfiles.profileId, profileId),
        // Фильм `done` выбран или скачан, но его ещё могут не посмотреть
        inArray(follows.state, ['active', 'paused', 'done']),
      ),
    )
    .all()

  if (!followed.length)
    return fresh

  const rows = db
    .select()
    .from(followEpisodes)
    .where(
      and(
        inArray(
          followEpisodes.followId,
          followed.map(item => item.id),
        ),
        or(
          isNotNull(followEpisodes.downloadedAt),
          isNotNull(followEpisodes.upgradeFrom),
          isNotNull(followEpisodes.picked),
        ),
      ),
    )
    .all()
  const progress = db
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        inArray(
          titleProgress.titleId,
          followed.map(item => item.titleId),
        ),
      ),
    )
    .all()

  for (const { id, titleId } of followed) {
    const points = progress.filter(point => point.titleId === titleId)
    const watched = new Set(points.filter(isProgressWatched).map(episodeKey))
    // Новое — после самой дальней серии, которую профиль открывал: пропущенная
    // раньше серия не новость, а недосмотренная дальняя — это «Продолжить»
    const farthest = [...points].sort(
      (a, b) => b.season - a.season || b.episode - a.episode,
    )[0]

    if (farthest && !watched.has(episodeKey(farthest)))
      continue

    const unwatched = rows
      .filter(
        row =>
          row.followId === id
          && !watched.has(episodeKey(row))
          && (!farthest
            || row.season > farthest.season
            || (row.season === farthest.season && row.episode > farthest.episode)),
      )
      .sort((a, b) => a.season - b.season || a.episode - b.episode)
    const first = unwatched[0]

    if (!first)
      continue

    const times = unwatched.map(row =>
      (
        row.pickedAt
        ?? row.downloadedAt
        ?? row.grabbedAt
        ?? new Date(0)
      ).getTime(),
    )
    const from = first.upgradeFrom

    fresh.set(titleId, {
      season: first.season,
      episode: first.episode,
      at: new Date(Math.max(...times)),
      file: from
        ? { torrentId: from.torrentId, fileIndex: from.fileIndex }
        : first.torrentId && first.fileIndex !== null && first.downloadedAt
          ? { torrentId: first.torrentId, fileIndex: first.fileIndex }
          : null,
    })
  }

  return fresh
}
