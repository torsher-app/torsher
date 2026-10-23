import type { Dirent, Stats } from 'node:fs'
import type { Library, LibraryFolder, MediaFile } from '../../db/schema.ts'
import { readdir, stat } from 'node:fs/promises'
import { dirname, join, matchesGlob, relative, sep } from 'node:path'
import { extensionKind } from '@torsher/release-parser'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { libraries, libraryFolders, mediaFiles } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { queueProbe } from './probe.ts'

// Служебные папки NAS и систем: в них видео пользователя не бывает
const SKIP_DIRS = new Set([
  '@eaDir',
  '#recycle',
  '#snapshot',
  'lost+found',
  '$RECYCLE.BIN',
])

export interface ScannedFile {
  relPath: string
  size: number
  mtime: number
  inode: number
}

export interface ScanResult {
  status: LibraryFolder['status']
  added: string[]
  changed: string[]
  missing: number
}

let onScanned:
  | ((folder: LibraryFolder, library: Library, result: ScanResult) => void)
  | undefined

/** Что делать с новыми и изменёнными файлами после скана: сопоставление, кадры */
export function onFolderScanned(
  listener: (
    folder: LibraryFolder,
    library: Library,
    result: ScanResult,
  ) => void,
) {
  onScanned = listener
}

function relPathOf(root: string, path: string) {
  return relative(root, path).split(sep).join('/').normalize('NFC')
}

function isExcluded(relPath: string, exclude: string[]) {
  return exclude.some((glob) => {
    try {
      return matchesGlob(relPath, glob) || matchesGlob(relPath, `**/${glob}`)
    }
    catch {
      return false
    }
  })
}

function isHidden(name: string) {
  return name.startsWith('.') || SKIP_DIRS.has(name)
}

/** Видео папки: обход со `stat`, без скрытых и служебных папок и исключений */
export async function listVideos(root: string, exclude: string[]) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true })
  const files: ScannedFile[] = []

  for (const entry of entries as Dirent[]) {
    if (!entry.isFile())
      continue

    const path = join(entry.parentPath, entry.name)
    const relPath = relPathOf(root, path)

    if (relPath.split('/').some(isHidden))
      continue

    if (extensionKind(relPath) !== 'video' || isExcluded(relPath, exclude))
      continue

    const info = await stat(path).catch(() => undefined)

    if (info) {
      files.push({
        relPath,
        size: info.size,
        mtime: Math.trunc(info.mtimeMs),
        inode: info.ino,
      })
    }
  }

  return files
}

function setFolder(id: string, values: Partial<LibraryFolder>) {
  return getDb()
    .update(libraryFolders)
    .set(values)
    .where(eq(libraryFolders.id, id))
    .returning()
    .get()
}

/** Все файлы папки уходят в `missing`: ничего не удаляется, вернутся — восстановятся */
function markAllMissing(folderId: string) {
  return getDb()
    .update(mediaFiles)
    .set({ state: 'missing', missingSince: new Date() })
    .where(
      and(eq(mediaFiles.folderId, folderId), eq(mediaFiles.state, 'present')),
    )
    .returning({ id: mediaFiles.id })
    .all()
    .length
}

function errorStatus(err: unknown): 'offline' | 'denied' {
  const code = (err as NodeJS.ErrnoException).code

  return code === 'EACCES' || code === 'EPERM' ? 'denied' : 'offline'
}

/**
 * Папка была на своём диске, а теперь её `st_dev` совпал с родительским:
 * диск отмонтирован, осталась пустая точка монтирования
 */
async function isUnmounted(folder: LibraryFolder, root: Stats) {
  if (folder.device === null || folder.device === root.dev)
    return false

  const parent = await stat(dirname(folder.path)).catch(() => undefined)

  return !!parent && parent.dev === root.dev
}

/** Сверка с базой: новые, изменённые, переименованные (по `inode`) и пропавшие */
export function applyScan(
  folderId: string,
  scanned: ScannedFile[],
  existing: MediaFile[],
) {
  const db = getDb()
  const byPath = new Map(existing.map(row => [row.relPath, row]))
  const seen = new Set<string>()
  const added: string[] = []
  const changed: string[] = []
  const now = new Date()
  const unseen = () => existing.filter(row => !seen.has(row.id))

  for (const file of scanned) {
    const known = byPath.get(file.relPath)

    if (known) {
      seen.add(known.id)

      const modified
        = known.size !== file.size || known.mtime.getTime() !== file.mtime

      if (modified || known.state === 'missing' || known.inode !== file.inode) {
        db.update(mediaFiles)
          .set({
            size: file.size,
            mtime: new Date(file.mtime),
            inode: file.inode,
            state: 'present',
            missingSince: null,
            probeKey: modified ? null : known.probeKey,
          })
          .where(eq(mediaFiles.id, known.id))
          .run()

        if (modified)
          changed.push(known.id)
      }

      continue
    }

    // Переименование или перенос внутри папки: тот же inode и размер —
    // сопоставление, прогресс и кадр остаются
    const moved = unseen().find(
      row =>
        row.inode === file.inode
        && row.size === file.size
        && !scanned.some(other => other.relPath === row.relPath),
    )

    if (moved) {
      seen.add(moved.id)
      db.update(mediaFiles)
        .set({
          relPath: file.relPath,
          mtime: new Date(file.mtime),
          state: 'present',
          missingSince: null,
        })
        .where(eq(mediaFiles.id, moved.id))
        .run()
      continue
    }

    const row = db
      .insert(mediaFiles)
      .values({
        folderId,
        relPath: file.relPath,
        size: file.size,
        mtime: new Date(file.mtime),
        inode: file.inode,
        addedAt: now,
      })
      .returning({ id: mediaFiles.id })
      .get()

    added.push(row.id)
  }

  let missing = 0

  for (const row of unseen()) {
    if (row.state === 'present') {
      missing++
      db.update(mediaFiles)
        .set({ state: 'missing', missingSince: now })
        .where(eq(mediaFiles.id, row.id))
        .run()
    }
  }

  return { added, changed, missing }
}

const running = new Map<string, Promise<ScanResult | undefined>>()
// Скан запросили, пока шёл прошлый: настройки могли поменяться — ещё один проход
const queued = new Map<string, Promise<ScanResult | undefined>>()

async function scan(
  folder: LibraryFolder,
  library: Library,
): Promise<ScanResult> {
  // Папка недоступна: файлы прячутся, но не удаляются
  const fail = (status: 'offline' | 'denied', error: string): ScanResult => {
    const missing = markAllMissing(folder.id)

    setFolder(folder.id, { status, error, scannedAt: new Date() })

    return { status, added: [], changed: [], missing }
  }

  let root: Stats

  try {
    root = await stat(folder.path)
  }
  catch (err) {
    return fail(errorStatus(err), (err as Error).message)
  }

  if (!root.isDirectory())
    return fail('offline', 'Not a directory')

  if (await isUnmounted(folder, root))
    return fail('offline', 'Disk is not mounted')

  let scanned: ScannedFile[]

  try {
    scanned = await listVideos(folder.path, library.exclude)
  }
  catch (err) {
    return fail(errorStatus(err), (err as Error).message)
  }

  // Медиа нет: пустая папка — норма, а опустевшая после скана с файлами —
  // похоже на отвалившийся диск, элементы не трогаем, только прячем
  if (!scanned.length && folder.fileCount > 0)
    return fail('offline', 'Folder became empty')

  const existing = getDb()
    .select()
    .from(mediaFiles)
    .where(eq(mediaFiles.folderId, folder.id))
    .all()
  const result = applyScan(folder.id, scanned, existing)
  const status = scanned.length ? 'ok' : 'empty'

  setFolder(folder.id, {
    status,
    device: root.dev,
    fileCount: scanned.length,
    scannedAt: new Date(),
    error: null,
  })

  for (const id of [...result.added, ...result.changed]) void queueProbe(id)

  return { status, ...result }
}

/**
 * Скан подключённой папки: один на папку за раз; запрос во время скана
 * ставит ещё один проход после него (не больше одного). Своя раскладка
 * сверяется отдельно (`checkManagedFiles`).
 */
export function scanFolder(folderId: string): Promise<ScanResult | undefined> {
  const current = running.get(folderId)

  if (current) {
    const next
      = queued.get(folderId)
        ?? current.then(() => {
          queued.delete(folderId)

          return scanFolder(folderId)
        })

    queued.set(folderId, next)

    return next
  }

  const found = getDb()
    .select({ folder: libraryFolders, library: libraries })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(libraryFolders.id, folderId))
    .get()

  if (!found || found.library.managed)
    return Promise.resolve(undefined)

  const task = scan(found.folder, found.library)
    .then((result) => {
      logFor('storage').info(
        {
          folderId,
          status: result.status,
          added: result.added.length,
          changed: result.changed.length,
          missing: result.missing,
        },
        'Library folder scanned',
      )
      onScanned?.(found.folder, found.library, result)

      return result
    })
    .finally(() => running.delete(folderId))

  running.set(folderId, task)

  return task
}

/** Скан идёт: панель показывает «Сканируется» */
export function isScanning(folderId: string) {
  return running.has(folderId)
}

/** Все подключённые папки: при старте и по расписанию */
export async function scanAllFolders() {
  const rows = getDb()
    .select({ id: libraryFolders.id })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(libraries.managed, false))
    .all()

  for (const row of rows) {
    try {
      await scanFolder(row.id)
    }
    catch (err) {
      logFor('storage').warn(
        { err, folderId: row.id },
        'Library folder scan failed',
      )
    }
  }
}
