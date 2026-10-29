import type {
  CatalogRow,
  ContinueCard,
  ContinueRow,
  EpisodeCard,
  HomeResponse,
  HomeRow,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { get } from '@torsher/demo/router'
import { DAY } from '@torsher/demo/state'
import {
  airedEpisodes,
  seasonOf,
  titleNamed,
  TITLES,
} from '@torsher/demo/titles'
import { backdropFor } from '../art.ts'
import { cardFor, cardsOf } from '../cards.ts'
import { isInLibrary, libraryTitleIds } from '../library.ts'
import {
  collections,
  isFollowed,
  lastProgress,
  mineEntry,
  mineTitleIds,
  nextAired,
  resumeOf,
  statusOf,
} from '../viewer.ts'

type Mode = 'all' | 'movies' | 'series' | 'library'

// Как у сервера: ряд «Продолжить» помнит 16 недель, «Новые серии» — 30 дней
const CONTINUE_MAX_AGE_MS = 112 * DAY * 1000
const NEW_EPISODE_MS = 30 * DAY * 1000

function modeOf(value: string | null): Mode {
  return value === 'movies' || value === 'series' || value === 'library'
    ? value
    : 'all'
}

function fits(title: DemoTitle, mode: Mode) {
  if (mode === 'movies')
    return title.kind === 'movie'
  if (mode === 'series')
    return title.kind === 'series'
  if (mode === 'library')
    return isInLibrary(title.id)

  return true
}

function episodeOf(title: DemoTitle, season: number, episode: number) {
  return seasonOf(title, season)?.episodes.find(
    item => item.number === episode,
  )
}

function continueCard(title: DemoTitle): ContinueCard | undefined {
  const target = resumeOf(title)

  if (!target)
    return undefined

  const episode = target.season
    ? episodeOf(title, target.season, target.episode!)
    : undefined
  const runtime = (episode?.runtime ?? title.runtime) * 60

  return {
    ...cardFor(title),
    image: episode?.still ?? backdropFor(title),
    season: target.season,
    episode: target.episode,
    episodeTitle: episode?.title,
    position: target.position,
    duration: target.duration ?? runtime,
    next: target.next,
    file: target.file,
  }
}

/** Начатое за 16 недель, недавнее первым; брошенное не продолжаем */
export function continueRow(mode: Mode = 'all'): ContinueRow {
  const since = Date.now() - CONTINUE_MAX_AGE_MS
  const items = TITLES.filter(title => fits(title, mode))
    .map(title => ({ title, at: lastProgress(title.id)?.updatedAt ?? 0 }))
    .filter(({ title, at }) => at > since && statusOf(title) !== 'dropped')
    .sort((a, b) => b.at - a.at)
    .flatMap(({ title }) => continueCard(title) ?? [])

  return {
    id: 'continue',
    kind: 'continue',
    title: 'home.rows.continue',
    items,
  }
}

/**
 * Новые серии того, что смотрят: последняя вышла за 30 дней и позже
 * последнего просмотра. Сериалы «Следить» и так стоят в «Продолжить»
 */
function newEpisodes(): EpisodeCard[] {
  const today = new Date().toISOString().slice(0, 10)
  const since = new Date(Date.now() - NEW_EPISODE_MS)
    .toISOString()
    .slice(0, 10)

  return TITLES.flatMap((title) => {
    const status = statusOf(title)
    const lastAt = lastProgress(title.id)?.updatedAt
    const next = nextAired(title)

    if (
      title.kind !== 'series'
      || isFollowed(title.id)
      || (status !== 'watching' && status !== 'waiting')
      || !next
      || !lastAt
    ) {
      return []
    }

    const lastSeason = title.seasons?.length ?? 1
    const latest = episodeOf(
      title,
      lastSeason,
      airedEpisodes(title, lastSeason),
    )
    const airDate = latest?.airDate ?? ''

    if (
      airDate < since
      || airDate > today
      || airDate <= new Date(lastAt).toISOString().slice(0, 10)
    ) {
      return []
    }

    const episode = episodeOf(title, next.season, next.episode)

    return [
      {
        titleId: title.id,
        title: title.title,
        season: next.season,
        episode: next.episode,
        episodeTitle: episode?.title,
        image: episode?.still,
        airDate,
        newCount: next.newCount,
      },
    ]
  })
}

function row(
  id: CatalogRow['id'],
  titles: DemoTitle[],
  kind: CatalogRow['kind'] = 'posters',
): CatalogRow {
  return { id, kind, title: `home.rows.${id}`, items: cardsOf(titles) }
}

const named = (...names: string[]) => names.map(titleNamed)

const POPULAR_MOVIES = named(
  'Velvet Atlas',
  'Northbound Static',
  'The Copper Weather',
  'Paper Comets',
  'Starling Protocol',
  'The Lighthouse at Corvane',
  'Winter in Tolvar',
  'Ashfall Summer',
  'The Lamplighters of Osk',
  'The Quiet Orchard',
  'Sintel',
  'Big Buck Bunny',
  'Tears of Steel',
)

const POPULAR_SERIES = named(
  'The Vantmoor Files',
  'Moth and Meridian',
  'Brightwater Ninety',
  'Saltwater Lullaby',
  'Low Orbit Diner',
  'Ninefold Harbor',
  'Glasswing',
  'Saints of Small Hours',
  'Kites over Mareth',
)

/** Тренды недели: тот же порядок, что у топ-10 главной и поиска */
export const TRENDING = named(
  'Lanterns of Vell',
  'Kites over Mareth',
  'Orbit of Small Things',
  'Glasswing',
  'Signal from Halden Reach',
  'Ninefold Harbor',
  'Hollowtide',
  'Saints of Small Hours',
  'Ember Cartography',
  'Low Orbit Diner',
)

const SPACE = named(
  'Orbit of Small Things',
  'Moth and Meridian',
  'Paper Comets',
  'Low Orbit Diner',
  'Signal from Halden Reach',
  'Tears of Steel',
)

function byRating(titles: DemoTitle[]) {
  return titles
    .filter(title => title.rating > 0)
    .sort((a, b) => b.rating - a.rating)
}

const movies = TITLES.filter(title => title.kind === 'movie')
const series = TITLES.filter(title => title.kind === 'series')

function catalogRows(mode: Mode): CatalogRow[] {
  switch (mode) {
    case 'movies':
      return [
        row(
          'trendingMovies',
          TRENDING.filter(t => t.kind === 'movie'),
          'top10',
        ),
        row('popularMovies', POPULAR_MOVIES),
        row('topRatedMovies', byRating(movies)),
      ]
    case 'series':
      return [
        row(
          'trendingSeries',
          TRENDING.filter(t => t.kind === 'series'),
          'top10',
        ),
        row('popularSeries', POPULAR_SERIES),
        row(
          'onTheAir',
          series.filter(title => title.ongoing),
        ),
        row('topRatedSeries', byRating(series)),
      ]
    case 'library':
      return []
    default:
      return [
        row('trending', TRENDING, 'top10'),
        row('popularMovies', POPULAR_MOVIES),
        row('popularSeries', POPULAR_SERIES),
        row('themeSpace', SPACE),
        row('topRatedMovies', byRating(movies)),
      ]
  }
}

function libraryRows(mode: Mode): CatalogRow[] {
  const own = libraryTitleIds().map(id =>
    TITLES.find(title => title.id === id)!,
  )

  if (mode === 'all')
    return [row('library', own)]

  if (mode !== 'library')
    return []

  return [
    row('libraryRecent', own.slice().reverse()),
    row(
      'libraryMovies',
      own.filter(title => title.kind === 'movie'),
    ),
    row(
      'librarySeries',
      own.filter(title => title.kind === 'series'),
    ),
  ].filter(item => item.items.length > 0)
}

function watchlist() {
  return mineTitleIds()
    .map(id => ({ id, at: mineEntry(id).watchlistAt }))
    .filter((item): item is { id: string, at: number } => !!item.at)
    .sort((a, b) => b.at - a.at)
    .map(item => TITLES.find(title => title.id === item.id)!)
}

/** «Новые серии», «Позже» и подборки «На главной»; пустые не отдаются */
function personalRows(): CatalogRow[] {
  const later = watchlist()
  const rows: CatalogRow[] = [
    {
      id: 'newEpisodes',
      kind: 'episodes',
      title: 'home.rows.newEpisodes',
      items: [],
      episodes: newEpisodes(),
    },
    { ...row('watchlist', later), total: later.length },
    ...collections
      .filter(item => item.showOnHome)
      .map(item => ({
        id: 'collection' as const,
        kind: 'posters' as const,
        title: '',
        ref: item.id,
        name: item.name,
        items: cardsOf(
          item.titles.map(id => TITLES.find(t => t.id === id)!),
        ),
        total: item.titles.length,
      })),
  ]

  return rows.filter(item => item.items.length || item.episodes?.length)
}

get<HomeResponse>('/api/home', ({ query }) => {
  const mode = modeOf(query.get('mode'))
  const resume = continueRow(mode)
  const rows: HomeRow[] = [
    ...(resume.items.length ? [resume] : []),
    ...libraryRows(mode),
    ...(mode === 'all' ? personalRows() : []),
    ...catalogRows(mode),
  ]

  return { rows, hasSources: true }
})

get<ContinueRow>('/api/home/continue', ({ query }) =>
  continueRow(modeOf(query.get('mode'))))
