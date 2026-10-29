import type {
  MineItems,
  MineResponse,
  MineSection,
  ScheduleItem,
  ScheduleResponse,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { get } from '@torsher/demo/router'
import { DAY } from '@torsher/demo/state'
import { seasonOf, TITLES } from '@torsher/demo/titles'
import { cardsOf } from '../cards.ts'
import {
  collections,
  isFollowed,
  mineEntry,
  statusOf,
  touchedAt,
} from '../viewer.ts'

type Section = MineSection['id']

interface Entry {
  title: DemoTitle
  /** Когда попал в раздел: по нему сортировка «по добавлению» */
  at: number
}

function byStatus(status: 'watching' | 'watched' | 'dropped'): Entry[] {
  return TITLES.filter(title => statusOf(title) === status).map(title => ({
    title,
    at:
      status === 'dropped'
        ? (mineEntry(title.id).droppedAt ?? 0)
        : touchedAt(title.id),
  }))
}

function listed(field: 'watchlistAt' | 'favoriteAt'): Entry[] {
  return TITLES.flatMap((title) => {
    const at = mineEntry(title.id)[field]

    return at ? [{ title, at }] : []
  })
}

function entriesOf(section: Section, collectionId?: string): Entry[] {
  switch (section) {
    case 'continue':
      return byStatus('watching')
    case 'watchlist':
      return listed('watchlistAt')
    case 'favorites':
      return listed('favoriteAt')
    case 'collection': {
      const ids
        = collections.find(item => item.id === collectionId)?.titles ?? []

      // Подборка хранит новые первыми: время — по месту в ней
      return ids.flatMap((id, index) => {
        const title = TITLES.find(item => item.id === id)

        return title ? [{ title, at: -index }] : []
      })
    }
    case 'watched':
      return byStatus('watched')
    case 'dropped':
      return byStatus('dropped')
  }
}

get<MineResponse>('/api/mine', () => ({
  sections: [
    { id: 'continue', count: entriesOf('continue').length },
    { id: 'watchlist', count: entriesOf('watchlist').length },
    { id: 'favorites', count: entriesOf('favorites').length },
    ...collections.map(item => ({
      id: 'collection' as const,
      collectionId: item.id,
      name: item.name,
      count: item.titles.length,
    })),
    { id: 'watched', count: entriesOf('watched').length },
    { id: 'dropped', count: entriesOf('dropped').length },
  ],
}))

function matchesRating(rating: number | undefined, filter: string | null) {
  switch (filter) {
    case 'rated':
      return !!rating
    case 'unrated':
      return !rating
    case '9-10':
    case '7-8':
    case '5-6':
    case '1-4': {
      const [from, to] = filter.split('-').map(Number) as [number, number]

      return !!rating && rating >= from && rating <= to
    }
    default:
      return true
  }
}

get<MineItems>('/api/mine/items', ({ query }) => {
  const kind = query.get('kind')
  const offset = Number(query.get('offset')) || 0
  const limit = Number(query.get('limit')) || 40
  const rating = (title: DemoTitle) => mineEntry(title.id).rating
  const found = entriesOf(
    (query.get('section') ?? 'continue') as Section,
    query.get('collection') ?? undefined,
  )
    .filter(
      ({ title }) =>
        (kind !== 'movie' && kind !== 'series') || title.kind === kind,
    )
    .filter(({ title }) => matchesRating(rating(title), query.get('rating')))
    .sort((a, b) =>
      query.get('sort') === 'rating'
        ? (rating(b.title) ?? 0) - (rating(a.title) ?? 0) || b.at - a.at
        : b.at - a.at,
    )

  return {
    items: cardsOf(
      found.slice(offset, offset + limit).map(item => item.title),
    ),
    total: found.length,
  }
})

// Расписание: ближайшие и вышедшие за две недели серии идущих сериалов,
// которые смотрят или за которыми следят
const RECENT_MS = 14 * DAY * 1000
const UPCOMING_COUNT = 3

get<ScheduleResponse>('/api/schedule', () => {
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - RECENT_MS).toISOString().slice(0, 10)
  const upcoming: ScheduleItem[] = []
  const recent: ScheduleItem[] = []

  for (const title of TITLES) {
    const followed = isFollowed(title.id)
    const status = statusOf(title)

    if (
      !title.ongoing
      || (!followed && status !== 'watching' && status !== 'waiting')
    ) {
      continue
    }

    const number = title.seasons?.length ?? 1
    const episodes = seasonOf(title, number)?.episodes ?? []
    let ahead = 0

    for (const episode of episodes) {
      const airDate = episode.airDate ?? ''
      const item: ScheduleItem = {
        titleId: title.id,
        title: title.title,
        season: number,
        episode: episode.number,
        episodeTitle: episode.title,
        airDate,
        image: episode.still,
        followed,
        state: null,
      }

      if (airDate > today && ahead < UPCOMING_COUNT) {
        ahead += 1
        upcoming.push({ ...item, state: 'upcoming' })
      }
      else if (airDate >= since && airDate <= today) {
        recent.push(item)
      }
    }
  }

  return {
    upcoming: upcoming.sort((a, b) => a.airDate.localeCompare(b.airDate)),
    recent: recent.sort((a, b) => b.airDate.localeCompare(a.airDate)),
  }
})
