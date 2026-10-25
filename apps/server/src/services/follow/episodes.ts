import type { SeasonDetails } from '../../dto/catalog.ts'
import type { Follow } from '../../db/schema.ts'
import type {
  EpisodeRef,
  EpisodeWithState,
  ScheduledEpisode,
  SeriesSchedule,
} from './wanted.ts'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, torrents } from '../../db/schema.ts'
import { planVideos } from '../library/linker.ts'
import { getSeason } from '../tmdb/index.ts'
import {
  episodeKey,
  episodeStates,
  localDay,
  scheduledEpisodes,
} from './wanted.ts'

/** Серии тайтла в библиотеке; файл на несколько серий даёт каждую */
export function libraryEpisodes(titleId: string) {
  const keys = new Set<string>()
  const rows = getDb()
    .select({
      season: mediaFiles.season,
      episode: mediaFiles.episode,
      episodeTo: mediaFiles.episodeTo,
    })
    .from(mediaFiles)
    .where(
      and(
        eq(mediaFiles.titleId, titleId),
        eq(mediaFiles.state, 'present'),
        isNotNull(mediaFiles.season),
      ),
    )
    .all()

  for (const row of rows) {
    if (row.season === null || row.episode === null)
      continue

    for (
      let episode = row.episode;
      episode <= (row.episodeTo ?? row.episode);
      episode++
    )
      keys.add(episodeKey({ season: row.season, episode }))
  }

  return keys
}

/**
 * Серии, которые качаются целиком: выбранные видео закреплённых раздач тайтла
 * (у фильма — серия 0/0). Докачанная серия, которую связыватель ещё не
 * положил, — тоже здесь, пока её нет в библиотеке.
 */
export function downloadingEpisodes(
  titleId: string,
  kind: 'movie' | 'series' = 'series',
) {
  const keys = new Set<string>()
  const rows = getDb()
    .select()
    .from(torrents)
    .where(and(eq(torrents.titleId, titleId), eq(torrents.retention, 'keep')))
    .all()

  for (const row of rows) {
    const selected = new Set(row.selectedFiles ?? [])

    for (const video of planVideos(row, kind)) {
      if (!selected.has(video.fileIndex))
        continue

      const { season, episode, episodeTo } = video.episode ?? {
        season: 0,
        episode: 0,
      }

      for (let number = episode; number <= (episodeTo ?? episode); number++)
        keys.add(episodeKey({ season, episode: number }))
    }
  }

  return keys
}

/** Сезоны, где нужны даты серий: ещё выходят или в них последняя вышедшая */
function seasonsToLoad(schedule: SeriesSchedule, from: EpisodeRef) {
  return schedule.seasons
    .filter(
      season =>
        season.number > 0
        && season.number >= from.season
        && (season.airedEpisodeCount < season.episodeCount
          || season.number === schedule.last?.season),
    )
    .map(season => season.number)
}

/**
 * Серии сериала с курсора и их состояния. Сезоны грузятся из кэша TMDB;
 * не загрузился — серии сезона по числу вышедших из деталей.
 */
export async function followEpisodeStates(
  follow: Pick<Follow, 'titleId' | 'startSeason' | 'startEpisode'>,
  schedule: SeriesSchedule,
  language: string,
  now = new Date(),
): Promise<EpisodeWithState[]> {
  const cursor = { season: follow.startSeason, episode: follow.startEpisode }
  const loaded = new Map<number, { number: number, airDate?: string }[]>()

  await Promise.all(
    seasonsToLoad(schedule, cursor).map(async (number) => {
      try {
        const season = await getSeason(follow.titleId, number, language)

        if (season)
          loaded.set(number, season.episodes)
      }
      catch {
        // Без дат серии сезона считаются по деталям
      }
    }),
  )

  return episodeStates({
    cursor,
    episodes: scheduledEpisodes(schedule, loaded, cursor, localDay(now)),
    library: libraryEpisodes(follow.titleId),
    downloading: downloadingEpisodes(follow.titleId),
  })
}

/** Фильм — одна «серия» 0/0: вышел — значит, его ищем */
export function movieState(titleId: string, released: boolean) {
  return episodeStates({
    cursor: { season: 0, episode: 0 },
    episodes: [{ season: 0, episode: 0, aired: released }],
    library: libraryEpisodes(titleId),
    downloading: downloadingEpisodes(titleId, 'movie'),
  })
}

/** Состояния серий одного уже загруженного сезона — для карточки */
export function seasonEpisodeStates(
  follow: Pick<Follow, 'titleId' | 'startSeason' | 'startEpisode'>,
  season: SeasonDetails,
  now = new Date(),
): Map<number, EpisodeWithState> {
  const today = localDay(now)
  const episodes: ScheduledEpisode[] = season.episodes.map(item => ({
    season: season.number,
    episode: item.number,
    aired: !!item.airDate && item.airDate <= today,
    airDate: item.airDate,
  }))
  const states = episodeStates({
    cursor: { season: follow.startSeason, episode: follow.startEpisode },
    episodes,
    library: libraryEpisodes(follow.titleId),
    downloading: downloadingEpisodes(follow.titleId),
  })

  return new Map(states.map(item => [item.episode, item]))
}
