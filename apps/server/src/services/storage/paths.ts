import type { Torrent } from '../../db/schema.ts'
import { resolve } from 'node:path'
import { config } from '../../config.ts'
import { deleteSetting, getSetting, setSetting } from '../settings/index.ts'

export type StorageKind = 'downloads' | 'library'
export type StoragePathSource = 'env' | 'panel'

const SETTING_KEY = 'storage.paths'

type SavedPaths = Partial<Record<StorageKind, string>>

const listeners = new Set<() => void>()

/** Путь из окружения: значение по умолчанию, пока в панели не выбрали своё */
export function envStoragePath(kind: StorageKind) {
  return resolve(
    kind === 'downloads' ? config.downloadsPath : config.libraryPath,
  )
}

function savedPaths() {
  return getSetting<SavedPaths>(SETTING_KEY) ?? {}
}

/** Действующий путь: выбранный в панели, иначе из окружения */
export function storagePath(kind: StorageKind) {
  return savedPaths()[kind] ?? envStoragePath(kind)
}

export function storagePathSource(kind: StorageKind): StoragePathSource {
  return savedPaths()[kind] ? 'panel' : 'env'
}

/**
 * Сохраняет путь; путь окружения и `null` — «Вернуть по умолчанию»: дальше
 * действует окружение и идёт за его сменой в compose.
 */
export function setStoragePath(kind: StorageKind, path: string | null) {
  const next = { ...savedPaths() }
  const value = path && resolve(path)

  if (!value || value === envStoragePath(kind))
    delete next[kind]
  else next[kind] = value

  if (Object.keys(next).length)
    setSetting(SETTING_KEY, next)
  else deleteSetting(SETTING_KEY)

  for (const listener of listeners) listener()
}

/** Подписка на смену путей: кэши, которые держат пути (очистка журнала) */
export function onStoragePathsChanged(listener: () => void) {
  listeners.add(listener)

  return () => listeners.delete(listener)
}

/** Каталог файлов раздачи; без своего — каталог загрузок из окружения */
export function torrentDir(torrent: Pick<Torrent, 'downloadDir'>) {
  return torrent.downloadDir ?? envStoragePath('downloads')
}

/** Значение `download_dir` для каталога: каталог окружения — `null` */
export function downloadDirValue(dir: string) {
  const value = resolve(dir)

  return value === envStoragePath('downloads') ? null : value
}
