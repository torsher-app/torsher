import { GB, isFresh } from '@torsher/demo/state'

const TB = 1024 * GB

/** Пути по умолчанию, как у сервера в Docker: всё внутри тома данных */
export const DATA_PATH = '/data'
export const ENV_PATHS = {
  downloads: '/data/downloads',
  library: '/data/library',
} as const

interface Volume {
  /** Точка монтирования: путь внутри неё лежит на этом томе */
  mount: string
  total: number
  /** Свободно без учёта загрузок Torsher — их место считает раздел */
  free: number
}

/**
 * Тома выдуманного сервера: системный диск с `/data` и `/srv`, медиадиск и
 * флешка. Свободное место системного диска считается от загрузок, у
 * остальных — постоянное.
 */
export const VOLUMES: Volume[] = [
  { mount: '/mnt/media', total: 8 * TB, free: 2.3 * TB },
  { mount: '/mnt/usb', total: 1 * TB, free: 610 * GB },
  { mount: '/', total: 2 * TB, free: 0 },
]

export const MAIN_DISK = {
  total: 2 * TB,
  /** Занято не загрузками Torsher: система, образы, чужие файлы */
  other: isFresh ? 24 * GB : 610 * GB,
}

export function volumeOf(path: string) {
  return VOLUMES.find(
    volume =>
      volume.mount === '/'
      || path === volume.mount
      || path.startsWith(`${volume.mount}/`),
  )!
}

/** Каталоги сервера для выбора папки: только то, что покажет обзор */
export const FOLDER_TREE: Record<string, string[]> = {
  '/': ['data', 'mnt', 'srv'],
  '/data': ['backups', 'downloads', 'library', 'transcodes'],
  '/data/backups': [],
  '/data/downloads': [],
  '/data/library': ['Movies', 'Series'],
  '/data/library/Movies': [],
  '/data/library/Series': [],
  '/data/transcodes': [],
  '/mnt': ['media', 'usb'],
  '/mnt/media': ['Anime', 'Home Videos', 'Movies', 'Series'],
  '/mnt/media/Anime': [],
  '/mnt/media/Home Videos': [],
  '/mnt/media/Movies': [],
  '/mnt/media/Series': [],
  '/mnt/usb': ['Movies', 'Torsher'],
  '/mnt/usb/Movies': [],
  '/mnt/usb/Torsher': [],
  '/srv': ['storage'],
  '/srv/storage': ['downloads', 'library'],
  '/srv/storage/downloads': [],
  '/srv/storage/library': [],
}

/** Что найдёт скан новой подключённой папки; остальные окажутся пустыми */
export const FOLDER_CONTENT: Record<string, { files: number, size: number }> = {
  '/mnt/media/Anime': { files: 26, size: 118 * GB },
  '/mnt/usb/Movies': { files: 9, size: 71 * GB },
}

/** Политика хранения: по умолчанию — как сервер считает по размеру тома */
export const policy = {
  cacheLimit: Math.min(200 * GB, Math.floor(MAIN_DISK.total * 0.5)),
  minFree: Math.min(20 * GB, Math.floor(MAIN_DISK.total * 0.1)),
  custom: false,
}
