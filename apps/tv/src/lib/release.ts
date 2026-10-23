import type { Card, ReleaseCard } from '@torsher/api-client'
import { coverageLabel } from './sources.ts'

/** Подсказка распознавания: «Название, 2024» */
export function suggestionName(card: Pick<Card, 'title' | 'year'>) {
  return card.year ? `${card.title}, ${card.year}` : card.title
}

/** Что скачано из раздачи: сезоны, число видео (серии, если сезоны известны) и размер */
export function releaseFacts(
  card: Pick<ReleaseCard, 'seasons' | 'videos' | 'size'>,
) {
  return {
    coverage: coverageLabel({ seasons: card.seasons, episodes: null }),
    count: card.videos,
    countKey: card.seasons.length > 0 ? 'release.episodes' : 'release.files',
    size: card.size,
  } as const
}
