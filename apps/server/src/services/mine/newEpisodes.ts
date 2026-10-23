import type { TitleDetails } from '../../dto/catalog.ts'
import type { EpisodeCard } from '../../dto/home.ts'
import type { TitleState } from './index.ts'
import { mapLimit } from '../../utils/mapLimit.ts'
import { getSeason } from '../tmdb/index.ts'
import { DETAILS_CONCURRENCY } from './cards.ts'
import { watchedEpisodes } from './status.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Серия, вышедшая раньше, — уже не новость, её место в «Продолжить»
export const NEW_EPISODE_DAYS = 30

interface NewEpisodePick {
  details: TitleDetails
  season: number
  episode: number
  newCount: number
  airDate: string
}

function dayOf(date: Date) {
  return date.toISOString().slice(0, 10)
}

/**
 * Первая непросмотренная вышедшая серия после самой дальней просмотренной и
 * число вышедших после неё. `undefined` — смотреть нечего.
 */
export function nextAired(
  seasons: { number: number, airedEpisodeCount: number }[],
  watched: Set<string>,
) {
  const aired = seasons
    .filter(season => season.number > 0)
    .sort((a, b) => a.number - b.number)
    .flatMap(season =>
      Array.from({ length: season.airedEpisodeCount }, (_, index) => ({
        season: season.number,
        episode: index + 1,
      })),
    )
  let furthest = -1

  aired.forEach((item, index) => {
    if (watched.has(`${item.season}:${item.episode}`))
      furthest = index
  })

  const rest = aired.slice(furthest + 1)

  return rest.length ? { ...rest[0], newCount: rest.length } : undefined
}

/**
 * Новые серии того, что профиль смотрит: последняя вышедшая серия вышла за
 * 30 дней, позже последнего просмотра тайтла и не просмотрена.
 */
export function pickNewEpisodes(
  states: TitleState[],
  now = new Date(),
): NewEpisodePick[] {
  const since = dayOf(new Date(now.getTime() - NEW_EPISODE_DAYS * DAY_MS))
  const picks: NewEpisodePick[] = []

  for (const state of states) {
    const summary = state.summary
    const last = summary?.airing?.last

    if (
      state.kind !== 'series'
      || !summary
      || (state.status !== 'watching' && state.status !== 'waiting')
      || !last?.airDate
      || last.airDate < since
      || last.airDate > dayOf(now)
      || !state.lastAt
      || last.airDate <= dayOf(state.lastAt)
    ) {
      continue
    }

    const watched = watchedEpisodes(state.progress)

    if (watched.has(`${last.season}:${last.episode}`))
      continue

    const next = nextAired(summary.details.seasons ?? [], watched)

    if (next)
      picks.push({ details: summary.details, ...next, airDate: last.airDate })
  }

  return picks.sort((a, b) => b.airDate.localeCompare(a.airDate))
}

/** Карточки 16:9: кадр серии из сезона TMDB, без него — бэкдроп тайтла */
export async function newEpisodeCards(
  states: TitleState[],
  language: string,
  limit: number,
): Promise<EpisodeCard[]> {
  const picks = pickNewEpisodes(states).slice(0, limit)

  return mapLimit(picks, DETAILS_CONCURRENCY, async (pick) => {
    const { details } = pick
    let episode: { title?: string, still?: string } | undefined

    try {
      const season = await getSeason(details.id, pick.season, language)
      const found = season?.episodes.find(
        item => item.number === pick.episode,
      )

      episode = found && {
        title: found.title || undefined,
        still: found.still,
      }
    }
    catch {
      // Без названия и кадра серии карточка всё равно полезна
    }

    return {
      titleId: details.id,
      title: details.title,
      season: pick.season,
      episode: pick.episode,
      episodeTitle: episode?.title,
      image: episode?.still ?? details.backdrop,
      airDate: pick.airDate,
      newCount: pick.newCount,
    }
  })
}
