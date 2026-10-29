import type {
  PlayerSettings,
  Profile,
  ResumeTarget,
  TitleMine,
} from '@torsher/api-client'
import type { DemoTitle } from '@torsher/demo/titles'
import { DAY, HOUR, MINUTE } from '@torsher/demo/state'
import { airedEpisodes, titleNamed } from '@torsher/demo/titles'
import { episodeFile, knownTorrent } from './library.ts'

/**
 * Зритель демо: профили, просмотры, «Моё», подборки и «Следить». Одно
 * состояние на все профили: демо показывает экраны, а не разделение
 * профилей.
 */

const PLAYER: PlayerSettings = {
  autoNext: true,
  subtitleSize: 'm',
  subtitleBackground: 'box',
}

function profile(
  values: Pick<Profile, 'id' | 'name' | 'color'> & Partial<Profile>,
): Profile {
  return {
    language: null,
    hasPin: false,
    ageLimit: null,
    posterRatings: ['tmdb'],
    player: { ...PLAYER },
    ...values,
  }
}

// Те же профили, что в демо панели
export const PROFILES: Profile[] = [
  profile({ id: 'profile-alex', name: 'Alex', color: 'violet' }),
  profile({
    id: 'profile-sam',
    name: 'Sam',
    color: 'green',
    language: 'en_US',
  }),
  profile({
    id: 'profile-kids',
    name: 'Kids',
    color: 'amber',
    language: 'en_US',
    hasPin: true,
    ageLimit: 12,
    player: { ...PLAYER, subtitleSize: 'l' },
  }),
]

/** Устройство подключено, но профиль ещё не выбран: открывается «Кто смотрит?» */
export const device = { currentId: PROFILES[0]!.id, selected: false }

export function currentProfile() {
  return PROFILES.find(item => item.id === device.currentId) ?? PROFILES[0]!
}

// Просмотры: позиция фильма (сезон и серия 0) или серии

export interface Progress {
  titleId: string
  season: number
  episode: number
  position: number
  duration: number | null
  watched: boolean
  updatedAt: number
  torrentId?: string
  fileIndex?: number
  mediaFileId?: string
}

const progress = new Map<string, Progress>()

function keyOf(titleId: string, season: number, episode: number) {
  return `${titleId}:${season}:${episode}`
}

export function progressAt(titleId: string, season = 0, episode = 0) {
  return progress.get(keyOf(titleId, season, episode))
}

export function progressOf(titleId: string) {
  return [...progress.values()].filter(item => item.titleId === titleId)
}

export function lastProgress(titleId: string) {
  return progressOf(titleId).reduce<Progress | undefined>(
    (last, item) => (!last || item.updatedAt > last.updatedAt ? item : last),
    undefined,
  )
}

// Как у сервера: досмотрено после 90 % или в последней секунде, короткий
// ролик — как только начат
const RESUME_MIN_SHARE = 0.05
const WATCHED_SHARE = 0.9
const RESUME_MIN_DURATION = 300

export function isWatchedAt(position: number, duration: number | null) {
  if (!duration || duration <= 0)
    return false

  const share = position / duration

  if (share < RESUME_MIN_SHARE)
    return false

  return (
    share > WATCHED_SHARE
    || position >= duration - 1
    || duration < RESUME_MIN_DURATION
  )
}

/** Позиция, с которой продолжать: в первых 5 % и после досмотра — с начала */
export function resumePosition(item: Progress) {
  if (!item.duration || item.position <= 0)
    return null

  const share = item.position / item.duration

  return share < RESUME_MIN_SHARE || isWatchedAt(item.position, item.duration)
    ? null
    : item.position
}

/** Позиция из плеера; пересмотр не снимает отметку «просмотрено» */
export function savePosition(values: Omit<Progress, 'watched' | 'updatedAt'>) {
  const key = keyOf(values.titleId, values.season, values.episode)
  const before = progress.get(key)
  const item: Progress = {
    ...values,
    watched:
      (before?.watched ?? false)
      || isWatchedAt(values.position, values.duration),
    updatedAt: Date.now(),
  }

  progress.set(key, item)
  return item
}

/** Отметка «просмотрено» руками: позиция сбрасывается, снятие стирает просмотр */
export function setWatched(
  titleId: string,
  season: number,
  episode: number,
  watched: boolean,
) {
  const key = keyOf(titleId, season, episode)

  if (!watched) {
    progress.delete(key)
    return
  }

  const before = progress.get(key)

  progress.set(key, {
    ...before,
    titleId,
    season,
    episode,
    position: 0,
    duration: before?.duration ?? null,
    watched: true,
    updatedAt: Date.now(),
  })
}

/** Вышедшие серии сериала по порядку */
export function airedList(title: DemoTitle) {
  return (title.seasons ?? []).flatMap((_, index) =>
    Array.from({ length: airedEpisodes(title, index + 1) }, (__, n) => ({
      season: index + 1,
      episode: n + 1,
    })),
  )
}

/** Первая вышедшая серия после самой дальней просмотренной и сколько их ещё */
export function nextAired(title: DemoTitle) {
  const aired = airedList(title)
  let furthest = -1

  aired.forEach((item, index) => {
    if (progressAt(title.id, item.season, item.episode)?.watched)
      furthest = index
  })

  const rest = aired.slice(furthest + 1)

  return rest.length ? { ...rest[0]!, newCount: rest.length } : undefined
}

/**
 * Что продолжать: начатое — с места, досмотренную серию — следующей вышедшей.
 * Файл — раздача, из которой смотрели; у следующей серии — та же раздача,
 * если серия в ней есть
 */
export function resumeOf(title: DemoTitle): ResumeTarget | null {
  const last = lastProgress(title.id)

  if (!last)
    return null

  const position = resumePosition(last)
  const fileOfLast
    = last.torrentId !== undefined && last.fileIndex !== undefined
      ? { torrentId: last.torrentId, fileIndex: last.fileIndex }
      : null

  if (!last.watched || position !== null) {
    if (position === null && last.season === 0)
      return null

    return {
      season: last.season || null,
      episode: last.episode || null,
      position: position ?? 0,
      duration: last.duration,
      next: false,
      file: fileOfLast,
    }
  }

  if (last.season === 0)
    return null

  const next = nextAired(title)

  if (!next)
    return null

  return {
    season: next.season,
    episode: next.episode,
    position: 0,
    duration: null,
    next: true,
    file: episodeFile(title.id, next.season, next.episode),
  }
}

// «Моё»: списки, оценка и «Брошено»; время — для сортировки «по добавлению»

interface MineEntry {
  watchlistAt?: number
  favoriteAt?: number
  rating?: number
  ratedAt?: number
  droppedAt?: number
}

const mine = new Map<string, MineEntry>()

export function mineEntry(titleId: string) {
  let entry = mine.get(titleId)

  if (!entry) {
    entry = {}
    mine.set(titleId, entry)
  }

  return entry
}

export function mineTitleIds() {
  return [...mine.keys()]
}

export interface DemoCollection {
  id: string
  name: string
  showOnHome: boolean
  /** Новые первыми */
  titles: string[]
}

// Те же подборки, что в демо панели
export const collections: DemoCollection[] = [
  {
    id: 'col-family',
    name: 'Family night',
    showOnHome: true,
    titles: ['Paper Comets', 'The Lamplighters of Osk', 'Kites over Mareth'],
  },
  {
    id: 'col-later',
    name: 'Watch later',
    showOnHome: false,
    titles: ['Ninefold Harbor', 'Moth and Meridian'],
  },
  {
    id: 'col-weekend',
    name: 'Weekend movies',
    showOnHome: true,
    titles: [
      'Lanterns of Vell',
      'Signal from Halden Reach',
      'The Copper Weather',
      'Winter in Tolvar',
    ],
  },
].map(item => ({
  ...item,
  titles: item.titles.map(name => titleNamed(name).id),
}))

export const follows = new Set<string>()

export function isFollowed(titleId: string) {
  return follows.has(titleId)
}

/**
 * Статус тайтла по просмотрам, как у сервера: руками ставится только
 * «Брошено». Сериал с досмотренным вышедшим: идущий — «Смотрю» (сезон
 * выходит), завершённый — «Просмотрено»
 */
export function statusOf(title: DemoTitle): TitleMine['status'] {
  const entry = mine.get(title.id)
  const last = lastProgress(title.id)

  if (entry?.droppedAt && (!last || entry.droppedAt >= last.updatedAt))
    return 'dropped'

  if (title.kind === 'movie') {
    const point = progressAt(title.id)

    if (entry?.rating || point?.watched)
      return 'watched'

    return point && point.position > 0 ? 'watching' : null
  }

  const started = progressOf(title.id).some(
    item => item.season > 0 && (item.position > 0 || item.watched),
  )

  if (!started)
    return null

  if (nextAired(title))
    return 'watching'

  return title.ongoing ? 'waiting' : 'watched'
}

/** Время последнего просмотра или отметки: по нему сортируются разделы */
export function touchedAt(titleId: string) {
  const entry = mine.get(titleId)

  return Math.max(
    lastProgress(titleId)?.updatedAt ?? 0,
    entry?.ratedAt ?? 0,
    entry?.droppedAt ?? 0,
  )
}

// Начальная история: что смотрели до открытия демо

function ago(seconds: number) {
  return Date.now() - seconds * 1000
}

function seed(
  name: string,
  values: {
    season?: number
    episode?: number
    share?: number
    position?: number
    secondsAgo: number
    torrent?: boolean
  },
) {
  const title = titleNamed(name)
  const season = values.season ?? 0
  const episode = values.episode ?? 0
  const duration = title.runtime * MINUTE
  const torrent = values.torrent
    ? knownTorrent(title, season || undefined)
    : undefined
  const file = torrent?.files.find(
    item => (item.season ?? 0) === season && (item.episode ?? 0) === episode,
  )
  const watched = values.share === undefined && values.position === undefined

  progress.set(keyOf(title.id, season, episode), {
    titleId: title.id,
    season,
    episode,
    position: values.position ?? Math.round(duration * (values.share ?? 0)),
    duration,
    watched,
    updatedAt: ago(values.secondsAgo),
    ...(torrent
      && file && { torrentId: torrent.id, fileIndex: file.fileIndex }),
  })
}

function seedSeasons(name: string, seasons: number[], secondsAgo: number) {
  const title = titleNamed(name)

  for (const season of seasons) {
    for (let episode = 1; episode <= airedEpisodes(title, season); episode++) {
      seed(name, {
        season,
        episode,
        secondsAgo: secondsAgo - season * DAY - episode * HOUR,
      })
    }
  }
}

seedSeasons('Glasswing', [1], 300 * DAY)
seed('Glasswing', {
  season: 2,
  episode: 1,
  secondsAgo: 14 * DAY,
  torrent: true,
})
seed('Glasswing', {
  season: 2,
  episode: 2,
  secondsAgo: 7 * DAY,
  torrent: true,
})
seed('Glasswing', {
  season: 2,
  episode: 3,
  share: 0.6,
  secondsAgo: 4 * MINUTE,
  torrent: true,
})

seedSeasons('Ninefold Harbor', [1, 2], 330 * DAY)
for (const [episode, days] of [
  [1, 20],
  [2, 13],
  [3, 8],
  [4, 3],
] as const) {
  seed('Ninefold Harbor', {
    season: 3,
    episode,
    secondsAgo: days * DAY,
    torrent: true,
  })
}

// Sintel начат на 5:12 из 14:48
seed('Sintel', { position: 312, secondsAgo: DAY, torrent: true })
seed('Signal from Halden Reach', {
  share: 0.33,
  secondsAgo: 9 * DAY,
  torrent: true,
})
seed('Starling Protocol', { share: 0.2, secondsAgo: 20 * DAY })
seed('The Copper Weather', { secondsAgo: 3 * DAY })
seed('Winter in Tolvar', { secondsAgo: 15 * DAY })
seed('Paper Comets', { secondsAgo: 31 * DAY })
seedSeasons('Moth and Meridian', [1, 2], 60 * DAY)
seedSeasons('Saltwater Lullaby', [1], 25 * DAY)
// Досмотрены до перерыва между сезонами: вышедшие с тех пор серии — «Новые серии»
seedSeasons('Low Orbit Diner', [1], 150 * DAY)
seedSeasons('Kites over Mareth', [1], 130 * DAY)

// Плеер демо играет Sintel целиком: 14:48, а не круглые 15 минут каталога
progressAt(titleNamed('Sintel').id)!.duration = 888

for (const [name, days] of [
  ['Hollowtide', 1],
  ['The Vantmoor Files', 4],
  ['Ember Cartography', 6],
  ['Northbound Static', 11],
  ['Velvet Atlas', 17],
] as const) {
  mineEntry(titleNamed(name).id).watchlistAt = ago(days * DAY)
}

for (const [name, days] of [
  ['Winter in Tolvar', 14],
  ['Moth and Meridian', 40],
  ['Lanterns of Vell', 70],
] as const) {
  mineEntry(titleNamed(name).id).favoriteAt = ago(days * DAY)
}

for (const [name, rating, days] of [
  ['The Copper Weather', 8, 3],
  ['Winter in Tolvar', 9, 15],
  ['Moth and Meridian', 8, 45],
  ['Paper Comets', 7, 31],
] as const) {
  Object.assign(mineEntry(titleNamed(name).id), {
    rating,
    ratedAt: ago(days * DAY),
  })
}

mineEntry(titleNamed('Starling Protocol').id).droppedAt = ago(18 * DAY)

follows.add(titleNamed('Glasswing').id)
follows.add(titleNamed('Ninefold Harbor').id)
