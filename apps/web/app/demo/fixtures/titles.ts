import type { Card, TitleDetails } from '@torsher/api-client'

/**
 * Каталог демо: выдуманные фильмы и сериалы. Названия проверены поиском на
 * совпадение с известными работами, первые пять — те же, что в мокапе
 * витрины на лендинге. id — вне диапазона, который сейчас занят в TMDB.
 */
interface DemoTitle {
  id: string
  kind: 'movie' | 'series'
  title: string
  year: number
  genres: string[]
  overview: string
  /** Минуты фильма или серии */
  runtime: number
  /** Серий в сезонах, по порядку; у фильма — нет */
  seasons?: number[]
  ongoing?: boolean
  rating: number
  /** Три цвета рисованного постера сверху вниз */
  art: [string, string, string]
}

export const TITLES: DemoTitle[] = [
  {
    id: 'tmdb:movie:9900001',
    kind: 'movie',
    title: 'Lanterns of Vell',
    year: 2026,
    genres: ['Adventure', 'Fantasy'],
    overview:
      'A mapmaker crosses a frozen valley to relight the beacons that once guided travellers home.',
    runtime: 112,
    rating: 7.8,
    art: ['#1b3348', '#4d6c80', '#c9ad85'],
  },
  {
    id: 'tmdb:tv:9900002',
    kind: 'series',
    title: 'Glasswing',
    year: 2025,
    genres: ['Drama', 'Mystery'],
    overview:
      'In a coastal town of glassblowers, a missing apprentice leaves behind a window nobody can see through.',
    runtime: 48,
    seasons: [8, 8],
    ongoing: true,
    rating: 8.1,
    art: ['#1c2a3a', '#3f6b7c', '#a9d4c8'],
  },
  {
    id: 'tmdb:tv:9900003',
    kind: 'series',
    title: 'Saltwater Lullaby',
    year: 2024,
    genres: ['Drama'],
    overview:
      'Three sisters return to the island ferry their mother ran for forty years and find it sold.',
    runtime: 52,
    seasons: [6],
    rating: 7.4,
    art: ['#1a222c', '#3b4a57', '#d0753f'],
  },
  {
    id: 'tmdb:movie:9900004',
    kind: 'movie',
    title: 'The Quiet Orchard',
    year: 2023,
    genres: ['Drama'],
    overview:
      'A retired beekeeper teaches his grandson the year his orchard stopped blooming.',
    runtime: 104,
    rating: 7.2,
    art: ['#1f3d33', '#4f8f6a', '#cde8a8'],
  },
  {
    id: 'tmdb:tv:9900005',
    kind: 'series',
    title: 'Kites over Mareth',
    year: 2026,
    genres: ['Adventure', 'Family'],
    overview:
      'A desert courier service runs on kites, wind charts and a lot of luck.',
    runtime: 41,
    seasons: [10],
    ongoing: true,
    rating: 7.9,
    art: ['#2b1b14', '#7a4a2e', '#e2b07a'],
  },
  {
    id: 'tmdb:tv:9900006',
    kind: 'series',
    title: 'Ninefold Harbor',
    year: 2024,
    genres: ['Crime', 'Drama'],
    overview:
      'A harbour inspector untangles the nine families who own every crane, ship and secret in port.',
    runtime: 55,
    seasons: [10, 10, 10],
    ongoing: true,
    rating: 8.3,
    art: ['#141c2b', '#2f4466', '#8fa8c9'],
  },
  {
    id: 'tmdb:movie:9900007',
    kind: 'movie',
    title: 'Paper Comets',
    year: 2024,
    genres: ['Animation', 'Family'],
    overview:
      'Two kids build a comet out of newspaper to win back the night sky from the city lights.',
    runtime: 96,
    rating: 7.6,
    art: ['#221b3a', '#5a4a8a', '#f0c58a'],
  },
  {
    id: 'tmdb:movie:9900008',
    kind: 'movie',
    title: 'The Copper Weather',
    year: 2022,
    genres: ['Thriller'],
    overview:
      'A storm chaser records a sound inside a hailstorm that someone very much wants erased.',
    runtime: 118,
    rating: 6.9,
    art: ['#2a1a12', '#8a4b26', '#e8a35d'],
  },
  {
    id: 'tmdb:tv:9900009',
    kind: 'series',
    title: 'Moth and Meridian',
    year: 2023,
    genres: ['Sci-Fi', 'Drama'],
    overview:
      'Two navigators on a slow generation ship disagree about where, exactly, they are going.',
    runtime: 50,
    seasons: [8, 8],
    rating: 8.0,
    art: ['#10161f', '#33405a', '#c7b38a'],
  },
  {
    id: 'tmdb:movie:9900010',
    kind: 'movie',
    title: 'Winter in Tolvar',
    year: 2021,
    genres: ['Drama', 'Romance'],
    overview:
      'A piano tuner snowed in at a mountain hotel tunes every instrument but his own life.',
    runtime: 129,
    rating: 7.3,
    art: ['#1d2633', '#55687f', '#dfe7ef'],
  },
  {
    id: 'tmdb:movie:9900011',
    kind: 'movie',
    title: 'Signal from Halden Reach',
    year: 2025,
    genres: ['Sci-Fi', 'Mystery'],
    overview:
      'An abandoned radio station on the tundra starts answering questions nobody has asked yet.',
    runtime: 121,
    rating: 7.5,
    art: ['#0f1a1c', '#2c5458', '#9fd0c4'],
  },
  {
    id: 'tmdb:tv:9900012',
    kind: 'series',
    title: 'Brightwater Ninety',
    year: 2026,
    genres: ['Comedy'],
    overview:
      'The staff of a seaside radio station try to keep it on air for ninety more days.',
    runtime: 28,
    seasons: [8],
    ongoing: true,
    rating: 7.7,
    art: ['#1a2a36', '#3f7a8c', '#f2d27a'],
  },
  {
    id: 'tmdb:movie:9900013',
    kind: 'movie',
    title: 'The Lamplighters of Osk',
    year: 2020,
    genres: ['Fantasy', 'Family'],
    overview:
      'The last lamplighters of a northern town race the sunrise on the longest night of the year.',
    runtime: 101,
    rating: 7.1,
    art: ['#191420', '#4a3a5c', '#f1c27a'],
  },
]

const byId = new Map(TITLES.map(title => [title.id, title]))

export function findTitle(id: string) {
  return byId.get(id)
}

/** Нужный тайтл каталога по названию — для связей между фикстурами */
export function titleNamed(name: string) {
  const found = TITLES.find(title => title.title === name)
  if (!found)
    throw new Error(`Unknown demo title: ${name}`)

  return found
}

/**
 * Рисованный постер вместо картинки TMDB: градиент в цветах тайтла и
 * силуэт холмов, как фоны мокапов лендинга
 */
export function posterOf(title: DemoTitle) {
  const [top, middle, bottom] = title.art
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300">
<defs><linearGradient id="g" x1="0" y1="0" x2="0.35" y2="1">
<stop offset="0" stop-color="${top}"/><stop offset="0.55" stop-color="${middle}"/><stop offset="1" stop-color="${bottom}"/>
</linearGradient></defs>
<rect width="200" height="300" fill="url(#g)"/>
<circle cx="146" cy="92" r="22" fill="#fff" opacity="0.18"/>
<path d="M0 232 Q50 196 100 222 T200 210 V300 H0Z" fill="#000" opacity="0.22"/>
<path d="M0 262 Q60 236 120 256 T200 250 V300 H0Z" fill="#000" opacity="0.28"/>
</svg>`

  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

export function cardOf(title: DemoTitle): Card {
  return {
    id: title.id,
    kind: title.kind,
    title: title.title,
    originalTitle: title.title,
    year: title.year,
    poster: posterOf(title),
    ratings: [{ provider: 'tmdb', label: 'TMDB', value: title.rating }],
  }
}

export function detailsOf(title: DemoTitle): TitleDetails {
  const seasons = title.seasons?.map((episodeCount, index) => ({
    number: index + 1,
    name: `Season ${index + 1}`,
    episodeCount,
    // У идущего сериала последний сезон вышел не целиком
    airedEpisodeCount:
      title.ongoing && index === title.seasons!.length - 1
        ? Math.ceil(episodeCount / 2)
        : episodeCount,
    year: title.year + index,
  }))

  return {
    ...cardOf(title),
    ratings: cardOf(title).ratings ?? [],
    overview: title.overview,
    genres: title.genres,
    runtime: title.kind === 'movie' ? title.runtime : undefined,
    episodeRuntime: title.kind === 'series' ? title.runtime : undefined,
    episodeCount: title.seasons?.reduce((sum, count) => sum + count, 0),
    seasons,
    ongoing: title.ongoing,
    status:
      title.kind === 'movie'
        ? 'released'
        : title.ongoing
          ? 'returning'
          : 'ended',
    countries: [],
    studios: [],
    creators: [],
    originalLanguage: 'en',
  }
}

/** Поиск по каталогу демо: без учёта регистра, по подстроке */
export function searchTitles(query: string) {
  const needle = query.trim().toLowerCase()

  return TITLES.filter(title => title.title.toLowerCase().includes(needle))
}

/** Синтетическое имя раздачи по выдуманному тайтлу */
export function releaseName(
  title: DemoTitle,
  options: { season?: number, episode?: number, quality?: string } = {},
) {
  const name = title.title.replace(/[^a-z0-9]+/gi, '.').replace(/\.$/, '')
  const quality = options.quality ?? '1080p.WEB-DL.H.264'

  if (title.kind === 'movie')
    return `${name}.${title.year}.${quality}-DEMO`

  const season = String(options.season ?? 1).padStart(2, '0')
  const episode
    = options.episode === undefined
      ? ''
      : `E${String(options.episode).padStart(2, '0')}`

  return `${name}.S${season}${episode}.${quality}-DEMO`
}

/** Сгенерированный infohash: 40 hex-символов из id, не настоящая раздача */
export function fakeInfohash(seed: string) {
  let hash = 2166136261
  let out = ''

  while (out.length < 40) {
    for (const char of `${seed}:${out.length}`)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)

    out += (hash >>> 0).toString(16).padStart(8, '0')
  }

  return out.slice(0, 40)
}
