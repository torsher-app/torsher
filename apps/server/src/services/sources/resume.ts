import type { TitleProgress } from '../../db/schema.ts'
import { and, desc, eq, gt, isNotNull, max } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { titleProgress } from '../../db/schema.ts'
import { droppedSince } from '../mine/index.ts'
import { getTorrent } from '../torrents/index.ts'
import { isWatched } from '../torrents/playback.ts'
import { titleFiles } from './files.ts'
import { episodeProgress, lastTitleProgress } from './progress.ts'

export interface EpisodeRef {
  season: number
  episode: number
}

/** Сезон из деталей TMDB: сколько серий уже вышло */
export interface AiredSeason {
  number: number
  airedEpisodeCount: number
}

export interface EpisodeFile {
  torrentId: string
  fileIndex: number
}

/** Что продолжать: начатая серия (фильм) или следующая после досмотренной */
export interface ResumeTarget {
  /** У фильма сезона и серии нет */
  season: number | null
  episode: number | null
  position: number
  duration: number | null
  /** Серия следующая после досмотренной, а не та, что смотрели */
  next: boolean
  /** Файл серии в уже известной раздаче; null — раздачу ещё искать */
  file: EpisodeFile | null
  updatedAt: Date
}

/**
 * Следующая вышедшая серия после `after`, которую ещё не отметили
 * просмотренной: дальше в том же сезоне, потом с начала следующих
 */
export function nextAiredEpisode(
  seasons: AiredSeason[],
  after: EpisodeRef,
  watched: (ref: EpisodeRef) => boolean = () => false,
): EpisodeRef | undefined {
  const ordered = seasons
    .filter(item => item.number >= after.season && item.number > 0)
    .sort((a, b) => a.number - b.number)

  for (const item of ordered) {
    const first = item.number === after.season ? after.episode + 1 : 1

    for (let episode = first; episode <= item.airedEpisodeCount; episode++) {
      const ref = { season: item.number, episode }

      if (!watched(ref))
        return ref
    }
  }

  return undefined
}

/**
 * Тайтлы, которые профиль убрал из «Продолжить»: «Брошено» позже последнего
 * просмотра. Новый просмотр снимает отметку сам
 */
export function excludedFromContinue(profileId: string): Set<string> {
  return new Set(droppedSince(profileId).keys())
}

/** Файл серии в раздаче — по именам файлов, как экран «Файлы» */
export function episodeFileIn(
  torrentId: string,
  ref: { profileId: string, titleId: string } & EpisodeRef,
): EpisodeFile | null {
  const torrent = getTorrent(torrentId)

  if (!torrent || torrent.status !== 'ready')
    return null

  const file = titleFiles(torrent, { ...ref, kind: 'series' }).find(
    item => item.season === ref.season && item.episode === ref.episode,
  )

  return file ? { torrentId, fileIndex: file.fileIndex } : null
}

/** Прогресс серий тайтла по ключу «сезон:серия» */
function episodeRows(profileId: string, titleId: string) {
  return new Map(
    episodeProgress(profileId, titleId).map(row => [
      `${row.season}:${row.episode}`,
      row,
    ]),
  )
}

/** Следующая вышедшая серия профиля: отмеченные просмотренными пропускаются */
export function nextEpisodeFor(
  profileId: string,
  titleId: string,
  seasons: AiredSeason[],
  after: EpisodeRef,
) {
  const rows = episodeRows(profileId, titleId)

  return nextAiredEpisode(seasons, after, (ref) => {
    const row = rows.get(`${ref.season}:${ref.episode}`)

    return !!row && isWatched(row.position, row.duration)
  })
}

function fileOf(row: TitleProgress): EpisodeFile | null {
  return row.torrentId && row.fileIndex !== null
    ? { torrentId: row.torrentId, fileIndex: row.fileIndex }
    : null
}

/**
 * Цель «Продолжить»: последняя серия из плеера, если она не досмотрена; иначе
 * следующая вышедшая. Сезоны сериала загружаются, только когда нужна следующая.
 * `undefined` — продолжать нечего: не смотрели, фильм досмотрен, новых серий нет.
 */
export async function resumeTarget(
  profileId: string,
  titleId: string,
  loadSeasons: () => Promise<AiredSeason[] | undefined>,
): Promise<ResumeTarget | undefined> {
  const last = lastTitleProgress(profileId, titleId)

  if (!last)
    return undefined

  if (!isWatched(last.position, last.duration)) {
    return {
      season: last.season || null,
      episode: last.episode || null,
      position: last.position,
      duration: last.duration,
      next: false,
      file: fileOf(last),
      updatedAt: last.updatedAt,
    }
  }

  if (last.season === 0)
    return undefined

  const seasons = await loadSeasons()

  if (!seasons)
    return undefined

  const next = nextEpisodeFor(profileId, titleId, seasons, last)

  if (!next)
    return undefined

  const row = episodeRows(profileId, titleId).get(
    `${next.season}:${next.episode}`,
  )
  const ref = { profileId, titleId, ...next }

  return {
    ...next,
    position: row?.position ?? 0,
    duration: row?.duration ?? null,
    next: true,
    file:
      (row && fileOf(row))
      ?? (last.torrentId ? episodeFileIn(last.torrentId, ref) : null),
    updatedAt: last.updatedAt,
  }
}

/** Тайтлы, которые профиль смотрел в плеере, — свежие первыми */
export function watchedTitles(profileId: string, limit: number) {
  const latest = max(titleProgress.updatedAt)

  return getDb()
    .select({ titleId: titleProgress.titleId, updatedAt: latest })
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.profileId, profileId),
        gt(titleProgress.position, 0),
        isNotNull(titleProgress.torrentId),
      ),
    )
    .groupBy(titleProgress.titleId)
    .orderBy(desc(latest))
    .limit(limit)
    .all()
    .map(row => row.titleId)
}
