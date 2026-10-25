import type { SeasonDetails } from '../../dto/catalog.ts'
import type { Follow } from '../../db/schema.ts'
import type {
  EpisodeFacts,
  EpisodeRef,
  EpisodeWithState,
  ScheduledEpisode,
  SeriesSchedule,
} from './wanted.ts'
import { and, eq, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, mediaFiles, torrents } from '../../db/schema.ts'
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

/** Что записал решатель о сериях слежения */
export function episodeFacts(followId: string): EpisodeFacts {
  const facts: EpisodeFacts = {
    seen: new Set(),
    grabbing: new Set(),
    noSpace: new Set(),
    waitUntil: new Map(),
  }
  const rows = getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, followId))
    .all()

  for (const row of rows) {
    const key = episodeKey(row)

    facts.seen.add(key)

    // Захват есть, а файла ещё нет: magnet ждёт метаданные
    if (row.torrentId && row.fileIndex === null && !row.downloadedAt)
      facts.grabbing.add(key)
    else if (row.stateNote === 'no_space')
      facts.noSpace.add(key)
    else if (row.pending && row.waitUntil && !row.torrentId)
      facts.waitUntil.set(key, row.waitUntil)
  }

  return facts
}

type StateFollow = Pick<
  Follow,
  'id' | 'titleId' | 'startSeason' | 'startEpisode' | 'lastSearchAt'
>

/** Библиотека, закачки и записи решателя для состояний серий */
export function stateInputs(
  follow: StateFollow,
  kind: 'movie' | 'series' = 'series',
) {
  return {
    library: libraryEpisodes(follow.titleId),
    downloading: downloadingEpisodes(follow.titleId, kind),
    facts: episodeFacts(follow.id),
    searched: !!follow.lastSearchAt,
  }
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
  follow: StateFollow,
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
    ...stateInputs(follow),
    now,
  })
}

/**
 * Фильм — одна «серия» 0/0: вышел — значит, его ищем. «Не нашли» у фильма
 * нет: его ищут, пока следят (доступность — срез «Апгрейд и фильмы»).
 */
export function movieState(follow: StateFollow, released: boolean) {
  return episodeStates({
    cursor: { season: 0, episode: 0 },
    episodes: [{ season: 0, episode: 0, aired: released }],
    ...stateInputs(follow, 'movie'),
  })
}

/** Состояния серий одного уже загруженного сезона — для карточки */
export function seasonEpisodeStates(
  follow: StateFollow,
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
    ...stateInputs(follow),
    now,
  })

  return new Map(states.map(item => [item.episode, item]))
}
