import type {
  Card,
  CatalogTag,
  SeasonDetails,
  TitleDetails,
  TitleExtras,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { DemoError } from '@torsher/demo/router'
import {
  cardOf,
  detailsOf,
  extrasOf,
  findTitle,
  seasonOf,
} from '@torsher/demo/titles'
import { backdropFor, posterFor } from './art.ts'
import { availabilityOf } from './library.ts'
import { follows, isFollowed, mineEntry } from './viewer.ts'

/** Тайтл каталога по id или 404, как у сервера */
export function titleById(id: string) {
  const title = findTitle(id)

  if (!title)
    throw new DemoError(404, { message: 'Title not found' })

  return title
}

/** Карточка с тем, что знает зритель: библиотека, загрузка, «Следить», оценка */
export function cardFor(title: DemoTitle): Card {
  const rating = mineEntry(title.id).rating

  return {
    ...cardOf(title),
    poster: posterFor(title),
    ...availabilityOf(title.id),
    ...(isFollowed(title.id) && { followed: true }),
    ...(rating && { ownRating: rating }),
  }
}

export function cardsOf(titles: DemoTitle[]) {
  return titles.map(cardFor)
}

export function followBrief(title: DemoTitle) {
  if (!follows.has(title.id))
    return null

  const last = title.seasons?.length ?? 1

  return {
    id: `follow-${title.id}`,
    state: 'active' as const,
    subscribed: true,
    start: { season: last, episode: 1 },
    mode: 'download' as const,
  }
}

export function detailsFor(title: DemoTitle): TitleDetails {
  const details = detailsOf(title)

  return {
    ...details,
    ...cardFor(title),
    ratings: details.ratings,
    backdrop: backdropFor(title),
    ...(title.kind === 'series' && { follow: followBrief(title) }),
  }
}

/**
 * ID жанров и студий — числовые, как у TMDB: по ним фильтр каталога
 * открывается с тега карточки
 */
const GENRE_IDS: Record<string, string> = {
  'Action': '28',
  'Adventure': '12',
  'Animation': '16',
  'Comedy': '35',
  'Crime': '80',
  'Drama': '18',
  'Family': '10751',
  'Fantasy': '14',
  'Horror': '27',
  'Mystery': '9648',
  'Romance': '10749',
  'Sci-Fi': '878',
  'Thriller': '53',
}

export function genreTag(name: string): CatalogTag {
  return { id: GENRE_IDS[name] ?? '0', name }
}

export function studioTag(title: DemoTitle): CatalogTag {
  return title.real
    ? { id: 'company:9900002', name: 'Blender Foundation' }
    : { id: 'company:9900001', name: 'Hearthlight Pictures' }
}

export function extrasFor(title: DemoTitle): TitleExtras {
  const extras = extrasOf(title)

  return {
    ...extras,
    similar: extras.similar.map(card => cardFor(titleById(card.id))),
    tags: {
      genres: title.genres.map(genreTag),
      studios: [studioTag(title)],
      keywords: [],
    },
  }
}

/** Сезон; у сериала, за которым следят, невышедшие серии — «ждём выхода» */
export function seasonFor(title: DemoTitle, number: number): SeasonDetails {
  const season = seasonOf(title, number)

  if (!season)
    throw new DemoError(404, { message: 'Season not found' })

  if (!isFollowed(title.id))
    return season

  return {
    ...season,
    episodes: season.episodes.map(episode =>
      episode.still ? episode : { ...episode, follow: 'upcoming' as const },
    ),
  }
}
