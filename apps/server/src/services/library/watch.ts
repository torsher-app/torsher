import type { FSWatcher } from 'node:fs'
import type { Library, LibraryFolder } from '../../db/schema.ts'
import { watch } from 'node:fs'
import { statfs } from 'node:fs/promises'
import { logFor } from '../logs/index.ts'
import { scanFolder } from './scan.ts'

// Пауза после последнего события: копирование файла — не одно событие, а поток
const SETTLE_MS = 60_000

// Сетевые и FUSE-тома: события изменений туда не приходят, хватит периодического скана
const NETWORK_FS = new Set([
  0x6969, // nfs
  0x517B, // smb
  0xFE534D42, // smb2
  0xFF534D42, // cifs
  0x65735546, // fuse
])

/**
 * Наблюдатель папки: `on` — следит, `network` — сетевой том, `failed` — не
 * поставился (лимит inotify, нет пути), `off` — выключен в настройках
 */
export type WatcherState = 'on' | 'network' | 'failed' | 'off'

const watchers = new Map<string, FSWatcher>()
const timers = new Map<string, NodeJS.Timeout>()
const states = new Map<string, WatcherState>()

export function watcherState(folderId: string): WatcherState | undefined {
  return states.get(folderId)
}

export function unwatchFolder(folderId: string, state: WatcherState = 'off') {
  watchers.get(folderId)?.close()
  watchers.delete(folderId)
  clearTimeout(timers.get(folderId))
  timers.delete(folderId)
  states.set(folderId, state)
}

function schedule(folderId: string) {
  clearTimeout(timers.get(folderId))
  timers.set(
    folderId,
    setTimeout(() => {
      timers.delete(folderId)
      void scanFolder(folderId)
    }, SETTLE_MS).unref(),
  )
}

/**
 * Ставит наблюдатель на папку после скана: на пустую и на недоступную тоже —
 * следующий скан попробует ещё раз, как только путь появится
 */
export async function watchFolder(folder: LibraryFolder, library: Library) {
  if (!library.watch) {
    unwatchFolder(folder.id)
    return
  }

  if (watchers.has(folder.id))
    return

  const fs = await statfs(folder.path).catch(() => undefined)

  if (!fs) {
    states.set(folder.id, 'failed')
    return
  }

  if (NETWORK_FS.has(fs.type)) {
    states.set(folder.id, 'network')
    return
  }

  try {
    const watcher = watch(folder.path, { recursive: true }, (_event, name) => {
      // Служебные файлы систем и NAS не меняют библиотеку
      if (name && /(?:^|\/)\.|@eaDir|#recycle/.test(String(name)))
        return

      schedule(folder.id)
    })

    watcher.on('error', (err) => {
      logFor('storage').warn(
        { err, folderId: folder.id },
        'Library watcher stopped',
      )
      unwatchFolder(folder.id, 'failed')
    })
    watchers.set(folder.id, watcher)
    states.set(folder.id, 'on')
  }
  catch (err) {
    // ENOSPC — кончились наблюдатели inotify: остаётся периодический скан
    logFor('storage').warn(
      { err, folderId: folder.id },
      'Library watcher was not started',
    )
    states.set(folder.id, 'failed')
  }
}
