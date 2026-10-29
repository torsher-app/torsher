import type {
  Card,
  SeasonDetails,
  TitleDetails,
  TitleExtras,
} from '@torsher/api-client'
import { backdropUrl, logoUrl, posterUrl, stillUrl } from './art'

export type DemoFont = 'serif' | 'sans' | 'slab' | 'round'

export type DemoMotif
  = | 'mountains'
    | 'sea'
    | 'city'
    | 'orchard'
    | 'kites'
    | 'orbit'
    | 'lighthouse'
    | 'storm'
    | 'forest'

/**
 * Каталог демо: выдуманные фильмы и сериалы. Названия проверены поиском на
 * совпадение с известными работами, первые пять — те же, что в мокапе
 * витрины на лендинге. id — вне диапазона, который сейчас занят в TMDB.
 */
export interface DemoTitle {
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
  /** 0 у открытых фильмов: оценок TMDB для них не выдумываем */
  rating: number
  /** Три цвета рисованного арта сверху вниз */
  art: [string, string, string]
  /** Сюжет рисованного постера и фона */
  motif: DemoMotif
  font: DemoFont
  /** Строка на постере капсом; в карточке тайтла — обычным регистром */
  tagline?: string
  /** Настоящий открытый фильм: настоящие год, режиссёр и хронометраж */
  real?: { slug: string, director: string }
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
    motif: 'mountains',
    font: 'serif',
    tagline: 'FOLLOW THE LIGHT',
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
    motif: 'sea',
    font: 'sans',
    tagline: 'A NEW SEASON',
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
    motif: 'sea',
    font: 'serif',
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
    motif: 'orchard',
    font: 'serif',
  },
  {
    id: 'tmdb:tv:9900005',
    kind: 'series',
    title: 'Kites over Mareth',
    year: 2026,
    genres: ['Adventure', 'Family'],
    overview:
      'A desert courier service runs on kites, wind charts and a lot of luck. When the trade winds fail, the youngest pilot bets the whole company on a route nobody has flown.',
    runtime: 41,
    seasons: [10, 10],
    ongoing: true,
    rating: 7.9,
    art: ['#2b1b14', '#7a4a2e', '#e2b07a'],
    motif: 'kites',
    font: 'slab',
    tagline: 'RIDE THE WIND',
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
    motif: 'city',
    font: 'sans',
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
    motif: 'orbit',
    font: 'round',
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
    motif: 'storm',
    font: 'sans',
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
    rating: 8,
    art: ['#10161f', '#33405a', '#c7b38a'],
    motif: 'orbit',
    font: 'serif',
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
    motif: 'mountains',
    font: 'serif',
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
    motif: 'lighthouse',
    font: 'sans',
    tagline: 'IT IS LISTENING',
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
    motif: 'sea',
    font: 'round',
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
    motif: 'forest',
    font: 'serif',
  },
  {
    id: 'tmdb:movie:9900014',
    kind: 'movie',
    title: 'Ember Cartography',
    year: 2025,
    genres: ['Adventure'],
    overview:
      'A volcanologist and a forger chart a path across an island that redraws itself every night.',
    runtime: 109,
    rating: 7,
    art: ['#200f0d', '#7c2f1f', '#f08a4b'],
    motif: 'mountains',
    font: 'slab',
  },
  {
    id: 'tmdb:movie:9900015',
    kind: 'movie',
    title: 'Northbound Static',
    year: 2024,
    genres: ['Thriller'],
    overview:
      'A night-train dispatcher hears a passenger on the radio who boarded thirty years ago.',
    runtime: 99,
    rating: 6.8,
    art: ['#0e141c', '#2b3b52', '#7ea3c4'],
    motif: 'city',
    font: 'sans',
    tagline: 'LAST CALL',
  },
  {
    id: 'tmdb:movie:9900016',
    kind: 'movie',
    title: 'Velvet Atlas',
    year: 2023,
    genres: ['Crime'],
    overview:
      'A retired map thief takes one last commission: a map of a city that was never built.',
    runtime: 115,
    rating: 7.1,
    art: ['#1b1020', '#55305e', '#e09bb2'],
    motif: 'city',
    font: 'serif',
  },
  {
    id: 'tmdb:movie:9900017',
    kind: 'movie',
    title: 'Hollowtide',
    year: 2025,
    genres: ['Horror'],
    overview:
      'Every spring tide the village bell rings once more than it should.',
    runtime: 94,
    rating: 6.6,
    art: ['#0b1414', '#1f3b3a', '#7fb3a6'],
    motif: 'sea',
    font: 'slab',
    tagline: 'DO NOT COUNT',
  },
  {
    id: 'tmdb:movie:9900018',
    kind: 'movie',
    title: 'Orbit of Small Things',
    year: 2026,
    genres: ['Sci-Fi', 'Drama'],
    overview:
      'A space-station janitor keeps a museum of everything the crew threw away.',
    runtime: 107,
    rating: 7.9,
    art: ['#0d0f1e', '#2b2f5c', '#b3a4e6'],
    motif: 'orbit',
    font: 'round',
  },
  {
    id: 'tmdb:movie:9900019',
    kind: 'movie',
    title: 'Starling Protocol',
    year: 2024,
    genres: ['Action'],
    overview:
      'A flock of rescue drones goes rogue the night a dam begins to crack.',
    runtime: 126,
    rating: 6.7,
    art: ['#111824', '#3a4f6a', '#e6c26a'],
    motif: 'storm',
    font: 'sans',
  },
  {
    id: 'tmdb:movie:9900020',
    kind: 'movie',
    title: 'Ashfall Summer',
    year: 2022,
    genres: ['Drama'],
    overview: 'A town under a grey sky stages its summer festival anyway.',
    runtime: 103,
    rating: 7.2,
    art: ['#241c19', '#6b5a50', '#d9b99b'],
    motif: 'forest',
    font: 'serif',
  },
  {
    id: 'tmdb:tv:9900021',
    kind: 'series',
    title: 'Low Orbit Diner',
    year: 2025,
    genres: ['Comedy'],
    overview:
      'The only diner on a commuter space station, open twenty-four hours, closed to drama.',
    runtime: 24,
    seasons: [10, 10],
    ongoing: true,
    rating: 7.6,
    art: ['#1b1530', '#4b3d7a', '#f5a3a3'],
    motif: 'orbit',
    font: 'round',
  },
  {
    id: 'tmdb:tv:9900022',
    kind: 'series',
    title: 'The Vantmoor Files',
    year: 2024,
    genres: ['Mystery', 'Crime'],
    overview:
      'A moorland archivist reopens cases the police filed under weather.',
    runtime: 58,
    seasons: [6, 6],
    rating: 8.2,
    art: ['#141a17', '#3c4f45', '#b9c7a6'],
    motif: 'storm',
    font: 'slab',
  },
  {
    id: 'tmdb:tv:9900023',
    kind: 'series',
    title: 'Saints of Small Hours',
    year: 2026,
    genres: ['Drama'],
    overview:
      'Night-shift nurses at a river hospital and the city that never lets them rest.',
    runtime: 50,
    seasons: [8],
    ongoing: true,
    rating: 7.8,
    art: ['#14121c', '#3d3550', '#e7b98a'],
    motif: 'city',
    font: 'serif',
  },
  {
    id: 'tmdb:movie:9900024',
    kind: 'movie',
    title: 'The Lighthouse at Corvane',
    year: 2021,
    genres: ['Mystery'],
    overview:
      'A keeper inherits a lighthouse that guides ships no one else can see.',
    runtime: 111,
    rating: 7.4,
    art: ['#0c1520', '#25425a', '#e8d5a0'],
    motif: 'lighthouse',
    font: 'serif',
  },
  // Открытые фильмы Blender Foundation (CC BY 3.0): настоящие названия и
  // режиссёры, арт — из их собственных кадров (media/)
  {
    id: 'tmdb:movie:9900100',
    kind: 'movie',
    title: 'Sintel',
    year: 2010,
    genres: ['Animation', 'Fantasy'],
    overview:
      'A young woman searches a frozen, dangerous world for the baby dragon she once rescued and lost.',
    runtime: 15,
    rating: 0,
    art: ['#1a2430', '#5a6f84', '#d8dde3'],
    motif: 'mountains',
    font: 'serif',
    real: { slug: 'sintel', director: 'Colin Levy' },
  },
  {
    id: 'tmdb:movie:9900101',
    kind: 'movie',
    title: 'Big Buck Bunny',
    year: 2008,
    genres: ['Animation', 'Comedy'],
    overview:
      'A big, gentle rabbit has had enough of three rodents who bully the forest, and plans a very elaborate revenge.',
    runtime: 10,
    rating: 0,
    art: ['#2c4a1e', '#7fb04a', '#f3e0b0'],
    motif: 'forest',
    font: 'round',
    real: { slug: 'bbb', director: 'Sacha Goedegebure' },
  },
  {
    id: 'tmdb:movie:9900102',
    kind: 'movie',
    title: 'Tears of Steel',
    year: 2012,
    genres: ['Sci-Fi'],
    overview:
      'In a future Amsterdam, a group of scientists tries to stop a robot uprising by revisiting one painful breakup.',
    runtime: 12,
    rating: 0,
    art: ['#14202a', '#3d5566', '#c9d3d8'],
    motif: 'city',
    font: 'sans',
    real: { slug: 'tos', director: 'Ian Hubert' },
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

/** Рисованный постер вместо картинки TMDB */
export function posterOf(title: DemoTitle) {
  return posterUrl(title)
}

/**
 * Сколько серий сезона уже вышло: у идущего сериала последний сезон вышел
 * наполовину
 */
export function airedEpisodes(title: DemoTitle, season: number) {
  const seasons = title.seasons ?? []
  const count = seasons[season - 1] ?? 0

  return title.ongoing && season === seasons.length
    ? Math.ceil(count / 2)
    : count
}

const CAST = [
  'Mara Ellison',
  'Teodor Vash',
  'Inez Calloway',
  'Rafe Okonkwo',
  'Lise Varenne',
  'Joss Amberley',
  'Petra Halvik',
  'Dorian Sall',
  'Noor Feyling',
  'Cass Morrow',
  'Elio Brandt',
  'Yara Penhallow',
]

const ROLES = [
  'Wren',
  'Captain Ilse',
  'Tobiah',
  'Marguerite',
  'Odo',
  'The Keeper',
  'Sela',
  'Hollis',
  'Fenn',
  'Aunt Rosa',
]

const CREATOR = 'Ilka Sorensen'
const STUDIO = 'Hearthlight Pictures'
const BLENDER = 'Blender Foundation'

const EPISODE_NAMES = [
  'First Light',
  'Paper Maps',
  'The Long Way Round',
  'Tailwind',
  'Open Doors',
  'Dust Season',
  'Small Hours',
  'Crosswind',
  'Night Shift',
  'Homecoming',
  'Still Air',
  'The Promise',
  'Red Thread',
  'Low Pressure',
  'Signal Fires',
  'The Updraft',
  'Lost Lines',
  'Sandglass',
  'Homeward',
  'Eye of the Storm',
]

/** Кто в центре серий сериала: подставляется в описания серий */
const EPISODE_SUBJECTS: Record<string, string> = {
  'tmdb:tv:9900002': 'the glassblowers',
  'tmdb:tv:9900003': 'the sisters',
  'tmdb:tv:9900005': 'the couriers',
  'tmdb:tv:9900006': 'the dock inspectors',
  'tmdb:tv:9900009': 'the navigators',
  'tmdb:tv:9900012': 'the presenters',
  'tmdb:tv:9900021': 'the diner regulars',
  'tmdb:tv:9900022': 'the archivists',
  'tmdb:tv:9900023': 'the night nurses',
}

const EPISODE_PLOTS = [
  '{S} get an offer that sounds too good to be true.',
  'An old promise catches up with {s}.',
  '{S} split up to cover more ground, and regret it by nightfall.',
  'A stranger arrives with a question nobody wants to answer.',
  '{S} lose something small that turns out to matter a lot.',
  'A long night tests what {s} owe each other.',
  'Plans change when the weather does, and {s} have to improvise.',
  '{S} finally get a straight answer, and it raises three more questions.',
  'A quiet day turns out to be anything but.',
  'Everything {s} built this season is put on the line.',
]

function episodeOverview(title: DemoTitle, season: number, episode: number) {
  const subject = EPISODE_SUBJECTS[title.id] ?? 'everyone'
  const seed = Number(title.id.split(':')[2]) + season * 7 + episode * 3
  const plot = EPISODE_PLOTS[seed % EPISODE_PLOTS.length]!

  return plot
    .replace('{S}', subject[0]!.toUpperCase() + subject.slice(1))
    .replace('{s}', subject)
}

const DAY_MS = 24 * 60 * 60 * 1000
const WEEK_MS = 7 * DAY_MS
// Последняя вышедшая серия идущего сезона вышла два дня назад, следующая
// выйдет через пять
const LAST_AIRED_DAYS_AGO = 2
// Прошлые сезоны идущего сериала не ближе полугода друг к другу
const SEASON_GAP_MS = 182 * DAY_MS

function startOfToday() {
  const now = new Date()

  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/**
 * Начало сезона, мс. Завершённый сериал выходил по сезону в год с премьеры.
 * У идущего последний сезон выходит сейчас, раз в неделю, а прошлые сезоны
 * лежат равными шагами между премьерой и ним.
 */
function seasonStart(title: DemoTitle, season: number) {
  if (!title.ongoing)
    return Date.UTC(title.year + season - 1, 2, 14)

  const last = title.seasons?.length ?? 1
  const current
    = startOfToday()
      - LAST_AIRED_DAYS_AGO * DAY_MS
      - (airedEpisodes(title, last) - 1) * WEEK_MS

  if (season >= last)
    return current

  const premiere = Math.min(
    Date.UTC(title.year, 2, 14),
    current - (last - 1) * SEASON_GAP_MS,
  )
  const step = (current - premiere) / (last - 1)

  return premiere + Math.round(((season - 1) * step) / DAY_MS) * DAY_MS
}

function airDateOf(title: DemoTitle, season: number, episode: number) {
  return new Date(seasonStart(title, season) + (episode - 1) * WEEK_MS)
    .toISOString()
    .slice(0, 10)
}

export function cardOf(title: DemoTitle): Card {
  return {
    id: title.id,
    kind: title.kind,
    title: title.title,
    originalTitle: title.title,
    year: title.year,
    poster: posterOf(title),
    ratings: title.real
      ? []
      : [
          {
            provider: 'tmdb',
            label: 'TMDB',
            value: title.rating,
            votes: 1200 + Math.round(title.rating * 311),
          },
        ],
    posterRatings: title.real ? [] : [{ source: 'tmdb', value: title.rating }],
  }
}

export function detailsOf(title: DemoTitle): TitleDetails {
  const card = cardOf(title)
  const details: TitleDetails = {
    ...card,
    ratings: card.ratings ?? [],
    overview: title.overview,
    genres: title.genres,
    runtime: title.kind === 'movie' ? title.runtime : undefined,
    backdrop: backdropUrl(title),
    logo: logoUrl(title),
    countries: title.real ? ['Netherlands'] : ['Norway', 'United Kingdom'],
    studios: [title.real ? BLENDER : STUDIO],
    creators: title.kind === 'series' ? [CREATOR] : [],
    tagline: title.tagline
      ? title.tagline[0] + title.tagline.slice(1).toLowerCase()
      : undefined,
    status:
      title.kind === 'movie'
        ? 'released'
        : title.ongoing
          ? 'returning'
          : 'ended',
    originalLanguage: 'en',
    certification: title.real ? undefined : '12',
    hasSources: true,
  }

  const seasons = title.seasons
  if (title.kind !== 'series' || !seasons)
    return details

  const lastSeason = seasons.length
  return {
    ...details,
    seasons: seasons.map((episodeCount, index) => ({
      number: index + 1,
      name: `Season ${index + 1}`,
      episodeCount,
      airedEpisodeCount: airedEpisodes(title, index + 1),
      year: new Date(seasonStart(title, index + 1)).getUTCFullYear(),
    })),
    ongoing: !!title.ongoing,
    episodeRuntime: title.runtime,
    episodeCount: seasons.reduce((sum, count) => sum + count, 0),
    firstAirDate: airDateOf(title, 1, 1),
    nextEpisode: title.ongoing
      ? {
          season: lastSeason,
          episode: airedEpisodes(title, lastSeason) + 1,
          airDate: airDateOf(
            title,
            lastSeason,
            airedEpisodes(title, lastSeason) + 1,
          ),
        }
      : undefined,
    follow: null,
  }
}

/** Сезон сериала с сериями; у вышедших серий есть рисованный кадр */
export function seasonOf(
  title: DemoTitle,
  number: number,
): SeasonDetails | undefined {
  const count = title.seasons?.[number - 1]
  if (count === undefined)
    return undefined

  const aired = airedEpisodes(title, number)
  return {
    number,
    name: `Season ${number}`,
    episodes: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      title: EPISODE_NAMES[((number - 1) * 10 + index) % EPISODE_NAMES.length]!,
      overview: episodeOverview(title, number, index + 1),
      airDate: airDateOf(title, number, index + 1),
      runtime: title.runtime,
      still: index < aired ? stillUrl(title, number, index + 1) : undefined,
    })),
  }
}

function tagsOf(genres: string[], studio: { id: string, name: string }) {
  return {
    genres: genres.map(genre => ({ id: genre.toLowerCase(), name: genre })),
    studios: [studio],
    keywords: [],
  }
}

/** Каст, съёмочная группа и похожие тайтлы по общим жанрам */
export function extrasOf(title: DemoTitle): TitleExtras {
  const similar = TITLES.filter(
    other =>
      other.id !== title.id
      && other.genres.some(genre => title.genres.includes(genre)),
  )
    .slice(0, 10)
    .map(cardOf)

  if (title.real) {
    return {
      cast: [],
      crew: [
        {
          id: `person:${title.real.slug}`,
          name: title.real.director,
          jobs: ['director'],
        },
      ],
      similar,
      franchise: [],
      aka: [],
      directors: [title.real.director],
      tags: tagsOf(title.genres, { id: 'studio:blender', name: BLENDER }),
    }
  }

  const seed = Number(title.id.split(':')[2]) % CAST.length
  return {
    cast: Array.from({ length: 8 }, (_, index) => ({
      id: `person:${seed + index}`,
      name: CAST[(seed + index) % CAST.length]!,
      role: ROLES[(seed + index) % ROLES.length],
    })),
    crew: [
      {
        id: 'person:crew1',
        name: CREATOR,
        jobs: [title.kind === 'series' ? 'creator' : 'director'],
      },
    ],
    similar,
    franchise: [],
    aka: [],
    directors: [CREATOR],
    tags: tagsOf(title.genres, { id: 'studio:1', name: STUDIO }),
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
