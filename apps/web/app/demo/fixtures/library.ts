import type {
  Collection,
  Library,
  LibraryFileItem,
  LibraryFolder,
  UnmatchedGroup,
} from '@torsher/api-client'
import { ago, DAY, GB, HOUR, isFresh, MB, MINUTE } from '../state'
import { ENV_PATHS } from './storage'
import { releaseName, titleNamed } from './titles'

export function folderOf(
  id: string,
  path: string,
  values: Partial<LibraryFolder> = {},
): LibraryFolder {
  return {
    id,
    path,
    hint: 'auto',
    status: 'ok',
    watcher: 'on',
    error: null,
    scannedAt: ago(20 * MINUTE),
    files: 0,
    size: 0,
    missing: 0,
    unsure: 0,
    unmatched: 0,
    pending: 0,
    ...values,
  }
}

export function libraryOf(
  id: string,
  name: string,
  folders: LibraryFolder[],
  values: Partial<Library> = {},
): Library {
  return {
    id,
    kind: 'video',
    name,
    managed: false,
    exclude: [],
    watch: true,
    hiddenProfiles: [],
    folders,
    ...values,
  }
}

/**
 * Своя раскладка Torsher есть у сервера с первого запуска: в неё ложится
 * то, что «Оставить» из загрузок. Наблюдателя у неё нет — файлы кладёт сам
 * сервер.
 */
const managed = libraryOf(
  'lib-torsher',
  'Torsher',
  [
    folderOf('folder-torsher', ENV_PATHS.library, {
      watcher: null,
      scannedAt: isFresh ? null : ago(10 * MINUTE),
      files: isFresh ? 0 : 46,
      size: isFresh ? 0 : 265 * GB,
    }),
  ],
  { managed: true },
)

const kites = titleNamed('Kites over Mareth')
const winter = titleNamed('Winter in Tolvar')
const kitesGroup = releaseName(kites, { season: 1, quality: '720p.HDTV' })
const winterGroup = releaseName(winter, { quality: '1080p.BluRay.x264' })

export const KITES_EPISODES = 5
export const KITES_EPISODE_SIZE = 1.1 * GB
export const WINTER_SIZE = 10.4 * GB

export function initialLibraries(): Library[] {
  if (isFresh)
    return [managed]

  return [
    managed,
    libraryOf(
      'lib-movies',
      'Movies',
      [
        folderOf('folder-movies', '/mnt/media/Movies', {
          hint: 'movies',
          scannedAt: ago(2 * HOUR),
          files: 38,
          size: 412 * GB,
          unmatched: 1,
        }),
      ],
      { exclude: ['Extras', '*.sample.*'] },
    ),
    libraryOf('lib-series', 'Series', [
      folderOf('folder-series', '/mnt/media/Series', {
        hint: 'shows',
        scannedAt: ago(2 * HOUR),
        files: 214,
        size: 980 * GB,
        unsure: KITES_EPISODES,
      }),
    ]),
    libraryOf(
      'lib-home',
      'Home videos',
      [
        folderOf('folder-home', '/mnt/media/Home Videos', {
          scannedAt: ago(DAY),
          files: 8,
          size: 14 * GB,
        }),
      ],
      { kind: 'home' },
    ),
  ]
}

/** Релизы без уверенного тайтла: один с подсказкой, один без */
export function initialUnmatched(): UnmatchedGroup[] {
  if (isFresh)
    return []

  return [
    {
      folderId: 'folder-series',
      libraryName: 'Series',
      group: kitesGroup,
      name: kitesGroup,
      status: 'unsure',
      suggestion: kites.id,
      files: KITES_EPISODES,
      size: KITES_EPISODES * KITES_EPISODE_SIZE,
    },
    {
      folderId: 'folder-movies',
      libraryName: 'Movies',
      group: winterGroup,
      name: winterGroup,
      status: 'unmatched',
      suggestion: null,
      files: 1,
      size: WINTER_SIZE,
    },
  ]
}

/** Файлы группы для «Исправить совпадение»: серии сезона или один фильм */
export function groupFiles(group: string) {
  if (group === kitesGroup) {
    return Array.from({ length: KITES_EPISODES }, (_, index) => ({
      relPath: `${group}/${releaseName(kites, { season: 1, episode: index + 1, quality: '720p.HDTV' })}.mkv`,
      season: 1,
      episode: index + 1,
    }))
  }

  return [{ relPath: `${group}/${group}.mkv`, season: null, episode: null }]
}

function homeFile(
  index: number,
  relPath: string,
  size: number,
  duration: number,
  capturedAt: string | null,
  capturedAtSource: LibraryFileItem['capturedAtSource'],
): LibraryFileItem {
  return {
    id: `home-file-${index}`,
    folderId: 'folder-home',
    relPath,
    size,
    duration,
    state: 'present',
    titleId: null,
    matchStatus: null,
    capturedAt,
    capturedAtSource,
  }
}

export function initialHomeFiles(): LibraryFileItem[] {
  if (isFresh)
    return []

  return [
    homeFile(
      1,
      '2026/Lake weekend/VID_20260614_101522.mp4',
      1.9 * GB,
      412,
      '2026-06-14T10:15:22.000Z',
      'tags',
    ),
    homeFile(
      2,
      '2026/Lake weekend/VID_20260614_183040.mp4',
      2.4 * GB,
      655,
      '2026-06-14T18:30:40.000Z',
      'tags',
    ),
    homeFile(
      3,
      '2026/Birthday/2026-03-02 Cake.mov',
      840 * MB,
      188,
      '2026-03-02T16:04:00.000Z',
      'name',
    ),
    homeFile(
      4,
      '2026/Birthday/2026-03-02 Candles.mov',
      610 * MB,
      97,
      '2026-03-02T16:11:00.000Z',
      'name',
    ),
    homeFile(
      5,
      '2025/First snow.mp4',
      1.2 * GB,
      301,
      '2025-12-03T09:12:00.000Z',
      'user',
    ),
    homeFile(
      6,
      '2025/Garden timelapse.mp4',
      3.1 * GB,
      920,
      '2025-08-21T05:40:00.000Z',
      'file',
    ),
    homeFile(
      7,
      '2025/School play.mp4',
      2.6 * GB,
      1740,
      '2025-05-16T17:00:00.000Z',
      'tags',
    ),
    homeFile(8, 'Old tapes/tape_07.avi', 1.4 * GB, 2650, null, null),
  ]
}

export function initialCollections(): Array<Collection & { titles: string[] }> {
  if (isFresh)
    return []

  const ids = (...names: string[]) => names.map(name => titleNamed(name).id)

  return [
    {
      id: 'col-family',
      name: 'Family night',
      count: 0,
      showOnHome: true,
      hiddenFrom: [],
      titles: ids(
        'Paper Comets',
        'The Lamplighters of Osk',
        'Kites over Mareth',
      ),
    },
    {
      id: 'col-later',
      name: 'Watch later',
      count: 0,
      showOnHome: false,
      hiddenFrom: [],
      titles: ids('Ninefold Harbor', 'Moth and Meridian'),
    },
    {
      id: 'col-weekend',
      name: 'Weekend movies',
      count: 0,
      showOnHome: true,
      hiddenFrom: [],
      titles: ids(
        'Lanterns of Vell',
        'Signal from Halden Reach',
        'The Copper Weather',
        'Winter in Tolvar',
      ),
    },
  ]
}
