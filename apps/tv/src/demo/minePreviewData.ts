import type { Card } from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { cardOf, TITLES } from '@torsher/demo/titles'
import { localDate, offsetDay } from '../lib/mineDates.ts'

export const MINE_TODAY = localDate(new Date())
export const demoDate = (offset: number) => offsetDay(MINE_TODAY, offset)

export interface MineDiaryEntry {
  id: string
  card: Card
  day: string | null
  genres: string[]
  countries: string[]
  time?: string
  kind: 'movie' | 'episode'
  runtime: number
  season?: number
  episode?: number
  episodeTitle?: string
  rewatch?: boolean
  note?: boolean
  imported?: boolean
}

function entry(
  id: string,
  titleIndex: number,
  values: Omit<
    MineDiaryEntry,
    'id' | 'card' | 'day' | 'genres' | 'countries'
  > & { day: number | null },
): MineDiaryEntry {
  const title = TITLES[titleIndex]!

  return {
    id,
    card: cardOf(title),
    genres: title.genres,
    // Fictional production metadata, stable for each fictional demo title.
    countries: [titleIndex % 2 ? 'unitedKingdom' : 'unitedStates'],
    ...values,
    day: values.day === null ? null : demoDate(values.day - 18),
  }
}

export const MINE_DIARY_ENTRIES: MineDiaryEntry[] = [
  entry('18-lanterns', 0, {
    day: 18,
    time: '21:14',
    kind: 'movie',
    runtime: 112,
  }),
  entry('18-glasswing', 1, {
    day: 18,
    time: '19:40',
    kind: 'episode',
    runtime: 48,
    season: 2,
    episode: 4,
    episodeTitle: 'The Clear Room',
  }),
  entry('17-orchard', 3, {
    day: 17,
    time: '22:03',
    kind: 'movie',
    runtime: 104,
    rewatch: true,
    note: true,
  }),
  entry('17-kites', 4, {
    day: 17,
    time: '20:18',
    kind: 'episode',
    runtime: 41,
    season: 1,
    episode: 7,
    episodeTitle: 'The Red Current',
  }),
  // 10 разных тайтлов за день: фильмы, серии и отметки только с датой.
  ...TITLES.slice(0, 10).map((title, index) =>
    entry(`16-title-${index}`, index, {
      day: 16,
      kind: title.kind === 'movie' ? 'movie' : 'episode',
      runtime: title.runtime,
      ...(title.kind === 'series'
        ? { season: 1, episode: 1, episodeTitle: title.title }
        : {}),
      ...(index % 3 ? { time: `${22 - index}:00` } : { imported: true }),
      note: index === 0,
    }),
  ),
  entry('15-saltwater', 2, {
    day: 15,
    time: '21:08',
    kind: 'episode',
    runtime: 52,
    season: 1,
    episode: 6,
    episodeTitle: 'Low Tide',
  }),
  entry('15-comets', 6, { day: 15, time: '18:20', kind: 'movie', runtime: 96 }),
  // 12 просмотров одного тайтла, а не 12 уникальных тайтлов.
  ...Array.from({ length: 12 }, (_, index) =>
    entry(`14-episode-${index}`, 1, {
      day: 14,
      time: `${21 - index}:00`,
      kind: 'episode',
      runtime: 48,
      season: index < 4 ? 2 : 1,
      episode: index < 4 ? 4 - index : 12 - index,
      episodeTitle: 'Glasswing',
      rewatch: true,
    })),
  entry('12-glasswing', 1, {
    day: 12,
    time: '20:31',
    kind: 'episode',
    runtime: 48,
    season: 2,
    episode: 3,
    episodeTitle: 'Annealed',
  }),
  entry('12-lanterns', 0, {
    day: 12,
    time: '17:02',
    kind: 'movie',
    runtime: 112,
    rewatch: true,
  }),
  ...[0, 3, 6, 7].map((titleIndex, index) =>
    entry(`10-movie-${index}`, titleIndex, {
      day: 10,
      time: `${22 - index * 3}:00`,
      kind: 'movie',
      runtime: TITLES[titleIndex]!.runtime,
    }),
  ),
  entry('9-harbor', 5, {
    day: 9,
    time: '21:55',
    kind: 'episode',
    runtime: 55,
    season: 2,
    episode: 8,
    episodeTitle: 'The Ninth Crane',
  }),
  entry('9-moth', 8, {
    day: 9,
    time: '19:12',
    kind: 'episode',
    runtime: 50,
    season: 1,
    episode: 5,
    episodeTitle: 'Periapsis',
  }),
  ...[0, 3, 6].map((titleIndex, index) =>
    entry(`8-movie-${index}`, titleIndex, {
      day: 8,
      kind: 'movie',
      runtime: TITLES[titleIndex]!.runtime,
      imported: true,
    }),
  ),
  entry('7-copper', 7, {
    day: 7,
    time: '22:17',
    kind: 'movie',
    runtime: 118,
    imported: true,
  }),
  entry('5-brightwater', 11, {
    day: 5,
    time: '20:44',
    kind: 'episode',
    runtime: 28,
    season: 1,
    episode: 6,
    episodeTitle: 'Dead Air',
  }),
  entry('5-kites', 4, {
    day: 5,
    time: '19:36',
    kind: 'episode',
    runtime: 41,
    season: 1,
    episode: 6,
    episodeTitle: 'Crosswind',
  }),
  entry('2-winter', 9, { day: 2, time: '21:20', kind: 'movie', runtime: 129 }),
  entry('2-saltwater', 2, {
    day: 2,
    time: '18:05',
    kind: 'episode',
    runtime: 52,
    season: 1,
    episode: 5,
    episodeTitle: 'The Crossing',
  }),
  entry('previous-month-orchard', 3, {
    day: -20,
    kind: 'movie',
    runtime: 104,
    imported: true,
  }),
  entry('previous-month-lanterns', 0, {
    day: -21,
    kind: 'movie',
    runtime: 112,
    note: true,
  }),
]

export const MINE_UNDATED_ENTRY = entry('undated-lamplighters', 12, {
  day: null,
  kind: 'movie',
  runtime: 101,
  imported: true,
})

export interface MineRecommendation {
  runtimeKnown?: boolean
  title: DemoTitle
  card: Card
  inWatchlist: boolean
  reason: 'rated' | 'watchlist' | 'genre'
  reasonTitle?: string
  rating?: number
  since?: string
  genre?: string
}

function recommendation(
  titleIndex: number,
  values: Omit<MineRecommendation, 'title' | 'card'>,
): MineRecommendation {
  const title = TITLES[titleIndex]!

  return { title, card: cardOf(title), ...values }
}

export const MINE_RECOMMENDATIONS: MineRecommendation[] = [
  recommendation(10, {
    inWatchlist: false,
    reason: 'rated',
    reasonTitle: 'Glasswing',
    rating: 9,
  }),
  recommendation(17, {
    inWatchlist: true,
    reason: 'watchlist',
    since: '2026-03-03',
  }),
  recommendation(12, {
    inWatchlist: false,
    reason: 'genre',
    genre: 'Fantasy',
  }),
  recommendation(6, {
    inWatchlist: true,
    reason: 'watchlist',
    since: '2026-05-12',
  }),
  recommendation(8, {
    inWatchlist: false,
    reason: 'rated',
    reasonTitle: 'Orbit of Small Things',
    rating: 8,
  }),
  recommendation(18, {
    inWatchlist: false,
    reason: 'genre',
    genre: 'Action',
  }),
  recommendation(13, {
    inWatchlist: true,
    reason: 'watchlist',
    since: '2026-08-28',
  }),
  recommendation(14, {
    inWatchlist: false,
    reason: 'rated',
    reasonTitle: 'The Copper Weather',
    rating: 8,
  }),
  recommendation(15, {
    inWatchlist: false,
    reason: 'genre',
    genre: 'Crime',
  }),
  recommendation(16, {
    runtimeKnown: false,
    inWatchlist: true,
    reason: 'watchlist',
    since: '2026-09-09',
  }),
  recommendation(19, {
    inWatchlist: false,
    reason: 'rated',
    reasonTitle: 'The Quiet Orchard',
    rating: 9,
  }),
  recommendation(20, {
    runtimeKnown: false,
    inWatchlist: false,
    reason: 'genre',
    genre: 'Comedy',
  }),
]
