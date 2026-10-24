import type { ExportLibrary } from './document.ts'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { libraryFolders, mediaFiles } from '../../db/schema.ts'
import { deleteSetting, getSetting, setSetting } from '../settings/index.ts'

// Решения владельца из импорта, чьих файлов на сервере ещё нет: ждут скана
const PENDING_KEY = 'transferPendingMatches'
// Дольше ждать незачем: папка, которой нет три месяца, уже не появится
const PENDING_TTL_MS = 90 * 24 * 60 * 60 * 1000
const MAX_PENDING = 50_000

type PendingFile = ExportLibrary['files'][number] & { addedAt: number }

function keyOf(item: { folder: string, path: string }) {
  return `${item.folder}\u0000${item.path.normalize('NFC')}`
}

function readPending(now = Date.now()) {
  return (getSetting<PendingFile[]>(PENDING_KEY) ?? []).filter(
    item => now - item.addedAt < PENDING_TTL_MS,
  )
}

function writePending(items: PendingFile[]) {
  if (items.length)
    setSetting(PENDING_KEY, items.slice(-MAX_PENDING))
  else deleteSetting(PENDING_KEY)
}

/** Записывает решение в файл так же, как его записала бы панель */
function applyTo(fileId: string, item: ExportLibrary['files'][number]) {
  getDb()
    .update(mediaFiles)
    .set({
      ...(item.match
        ? {
            matchStatus: item.match.status,
            matchSource: 'user' as const,
            matchSuggestion: null,
            titleId: item.match.title,
            season: item.match.season,
            episode: item.match.episode,
            episodeTo: item.match.episodeTo,
            version: item.match.version,
          }
        : {}),
      ...(item.capturedAt
        ? {
            capturedAt: new Date(item.capturedAt),
            capturedAtSource: 'user' as const,
          }
        : {}),
    })
    .where(eq(mediaFiles.id, fileId))
    .run()
}

/**
 * Решения о файлах из импорта: к файлам, которые уже на сервере, — сразу,
 * остальные ждут скана своей папки. Возвращает, сколько применено.
 */
export function addLibraryDecisions(
  items: ExportLibrary['files'],
  now = Date.now(),
) {
  if (!items.length)
    return 0

  const folders = new Map(
    getDb()
      .select({ id: libraryFolders.id, path: libraryFolders.path })
      .from(libraryFolders)
      .all()
      .map(row => [row.path, row.id]),
  )
  const pending = new Map(readPending(now).map(item => [keyOf(item), item]))
  let applied = 0

  for (const item of items) {
    const folderId = folders.get(item.folder)
    const file = folderId
      ? getDb()
          .select({ id: mediaFiles.id })
          .from(mediaFiles)
          .where(
            and(
              eq(mediaFiles.folderId, folderId),
              eq(mediaFiles.relPath, item.path.normalize('NFC')),
            ),
          )
          .get()
      : undefined

    if (file) {
      applyTo(file.id, item)
      applied++
    }
    else {
      pending.set(keyOf(item), { ...item, addedAt: now })
    }
  }

  writePending([...pending.values()])

  return applied
}

/**
 * После скана папки: новые файлы, о которых есть решение из импорта,
 * получают его. Возвращает ID файлов, которым решение не нашлось, — их
 * сопоставляет матчер.
 */
export function applyPendingDecisions(folderId: string, ids: string[]) {
  const pending = readPending()

  if (!pending.length || !ids.length)
    return ids

  const folder = getDb()
    .select({ path: libraryFolders.path })
    .from(libraryFolders)
    .where(eq(libraryFolders.id, folderId))
    .get()

  if (!folder)
    return ids

  const byKey = new Map(pending.map(item => [keyOf(item), item]))
  const rest: string[] = []
  let changed = false

  for (const file of getDb()
    .select({ id: mediaFiles.id, relPath: mediaFiles.relPath })
    .from(mediaFiles)
    .where(inArray(mediaFiles.id, ids))
    .all()) {
    const key = keyOf({ folder: folder.path, path: file.relPath })
    const item = byKey.get(key)

    if (!item) {
      rest.push(file.id)
      continue
    }

    applyTo(file.id, item)
    byKey.delete(key)
    changed = true

    // Дата — не сопоставление: файл без ручного тайтла матчер проверит сам
    if (!item.match)
      rest.push(file.id)
  }

  if (changed)
    writePending([...byKey.values()])

  return rest
}
