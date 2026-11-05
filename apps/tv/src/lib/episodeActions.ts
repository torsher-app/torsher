import type { EpisodeProgress, TitleSeason } from '@torsher/api-client'

/** Первый выбор делается после прогресса; ручной выбор хранит сам экран. */
export function initialSeason(
  seasons: Pick<TitleSeason, 'number'>[],
  resumeSeason?: number | null,
) {
  return (
    seasons.find(item => item.number === resumeSeason)?.number
    ?? seasons[0]?.number
  )
}

/** Пороги resumePosition из server/services/torrents/playback.ts. */
export function canResumeEpisode(position: number, duration: number | null) {
  if (!duration || duration <= 0)
    return position >= 30
  const share = position / duration
  return (
    duration >= 300 && share >= 0.05 && share <= 0.9 && position < duration - 1
  )
}

/** Отметка просмотренного не доказывает наличие сохранённой позиции. */
export function episodeActions(
  point?: Pick<EpisodeProgress, 'position' | 'duration' | 'watched'>,
) {
  const position = point?.position ?? 0
  return {
    resume: canResumeEpisode(position, point?.duration ?? null),
    fromStart: position > 0,
    watched: point?.watched ?? false,
  }
}

/** Тот же сброс позиции, что делает markWatched на сервере. */
export function markedEpisode(
  point: EpisodeProgress,
  watched: boolean,
): EpisodeProgress {
  return {
    ...point,
    watched,
    position: 0,
    duration: watched ? point.duration : null,
  }
}
