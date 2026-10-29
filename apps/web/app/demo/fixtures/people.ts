import type {
  Device,
  HistoryEntry,
  PlayerSettings,
  Profile,
  UnmatchedImportRow,
} from '@torsher/api-client'
import { ago, DAY, HOUR, MINUTE } from '@torsher/demo/state'
import { cardOf, titleNamed } from '@torsher/demo/titles'

export const DEFAULT_PLAYER: PlayerSettings = {
  autoNext: true,
  subtitleSize: 'm',
  subtitleBackground: 'box',
}

export function demoProfile(
  values: Pick<Profile, 'id' | 'name' | 'color'> & Partial<Profile>,
): Profile {
  return {
    language: null,
    hasPin: false,
    ageLimit: null,
    posterRatings: ['tmdb'],
    player: { ...DEFAULT_PLAYER },
    ...values,
  }
}

export const LIVED_PROFILES: Profile[] = [
  demoProfile({ id: 'profile-alex', name: 'Alex', color: 'violet' }),
  demoProfile({
    id: 'profile-sam',
    name: 'Sam',
    color: 'green',
    language: 'en_US',
  }),
  demoProfile({
    id: 'profile-kids',
    name: 'Kids',
    color: 'amber',
    language: 'en_US',
    hasPin: true,
    ageLimit: 12,
    player: { ...DEFAULT_PLAYER, subtitleSize: 'l' },
  }),
]

interface EntryOptions {
  season?: number
  episode?: number
  /** Доля просмотренного; без неё серия или фильм досмотрены */
  progress?: number
  watchedAgo: number
}

function entry(name: string, options: EntryOptions): HistoryEntry {
  const title = titleNamed(name)
  const duration = title.runtime * MINUTE
  const progress = options.progress ?? 1

  return {
    title: cardOf(title),
    season: options.season ?? null,
    episode: options.episode ?? null,
    position: Math.round(duration * progress),
    duration,
    watched: options.progress === undefined,
    watchedAt: ago(options.watchedAgo),
  }
}

export function livedHistory(): Record<string, HistoryEntry[]> {
  return {
    'profile-alex': [
      entry('Glasswing', {
        season: 2,
        episode: 5,
        progress: 0.44,
        watchedAgo: 4 * MINUTE,
      }),
      entry('Ninefold Harbor', {
        season: 3,
        episode: 10,
        watchedAgo: DAY + 3 * HOUR,
      }),
      entry('The Copper Weather', { watchedAgo: 3 * DAY }),
      entry('Moth and Meridian', {
        season: 1,
        episode: 8,
        watchedAgo: 6 * DAY,
      }),
      entry('Signal from Halden Reach', {
        progress: 0.33,
        watchedAgo: 9 * DAY,
      }),
      entry('Winter in Tolvar', { watchedAgo: 15 * DAY }),
      entry('Saltwater Lullaby', {
        season: 1,
        episode: 6,
        watchedAgo: 22 * DAY,
      }),
      entry('Paper Comets', { watchedAgo: 31 * DAY }),
    ],
    'profile-sam': [
      entry('Brightwater Ninety', {
        season: 1,
        episode: 4,
        progress: 0.36,
        watchedAgo: 2 * DAY,
      }),
      entry('Lanterns of Vell', { watchedAgo: 4 * DAY }),
      entry('Glasswing', { season: 1, episode: 8, watchedAgo: 10 * DAY }),
      entry('The Quiet Orchard', { watchedAgo: 18 * DAY }),
    ],
    'profile-kids': [
      entry('Kites over Mareth', {
        season: 1,
        episode: 7,
        progress: 0.6,
        watchedAgo: 5 * HOUR,
      }),
      entry('The Lamplighters of Osk', { watchedAgo: 2 * DAY }),
    ],
  }
}

/** Устройство демо: профиль хранится ссылкой, чтобы переименование и удаление профиля сразу были видны */
export interface DemoDevice extends Omit<Device, 'profile' | 'lastSeenAt'> {
  profileId: string | null
  /** Секунды с последнего запроса; у смотрящего сейчас время всегда свежее */
  seenAgo: number | null
}

export function livedDevices(): DemoDevice[] {
  return [
    {
      id: 'device-living-room',
      name: 'Living room TV',
      type: 'tv',
      profileId: 'profile-alex',
      address: '192.168.1.40',
      userAgent:
        'Mozilla/5.0 (Linux; SmartTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36',
      createdAt: ago(140 * DAY),
      seenAgo: 6,
      watching: true,
    },
    {
      id: 'device-bedroom',
      name: 'Bedroom TV',
      type: 'tv',
      profileId: 'profile-sam',
      address: '192.168.1.41',
      userAgent:
        'Mozilla/5.0 (Linux; Android 12; Android TV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36',
      createdAt: ago(96 * DAY),
      seenAgo: 2 * DAY + 2 * HOUR,
      watching: false,
    },
    {
      id: 'device-kitchen',
      name: 'Kitchen tablet',
      type: 'browser',
      profileId: 'profile-kids',
      address: '192.168.1.57',
      userAgent:
        'Mozilla/5.0 (Linux; Android 14; Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      createdAt: ago(41 * DAY),
      seenAgo: 5 * HOUR,
      watching: false,
    },
  ]
}

/**
 * Строки прошлого импорта оценок, которые не сопоставились сами: названия —
 * как в чужом файле, с опечатками и без пары в каталоге
 */
export function livedUnmatched(): UnmatchedImportRow[] {
  const glasswing = titleNamed('Glasswing')
  const lanterns = titleNamed('Lanterns of Vell')

  return [
    {
      id: 'row-1',
      list: 'rating',
      status: 'unsure',
      title: 'Glass Wing',
      year: glasswing.year - 1,
      kind: 'series',
      rating: 9,
      suggestion: cardOf(glasswing),
    },
    {
      id: 'row-2',
      list: 'rating',
      status: 'unsure',
      title: 'Lanterns of Vel',
      year: lanterns.year,
      kind: 'movie',
      rating: 8,
      suggestion: cardOf(lanterns),
    },
    {
      id: 'row-3',
      list: 'rating',
      status: 'notFound',
      title: 'Ashfall Meridian',
      year: 2019,
      kind: 'movie',
      rating: 6,
      suggestion: null,
    },
    {
      id: 'row-4',
      list: 'rating',
      status: 'notFound',
      title: 'Seven Paper Bridges',
      year: 2021,
      kind: 'series',
      rating: 7,
      suggestion: null,
    },
    {
      id: 'row-5',
      list: 'watchlist',
      status: 'notFound',
      title: 'The Tinker\'s Lantern',
      year: null,
      kind: null,
      rating: null,
      suggestion: null,
    },
  ]
}
