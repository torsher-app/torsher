import type { MaintenanceManifestPath } from '../../db/schema.ts'
import { stat } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  torrents,
} from '../../db/schema.ts'
import { torrentDir } from '../storage/paths.ts'
import { metadataPaths } from '../torrents/refresh.ts'
import { CleanupError, under } from './files.ts'

function externalRoots() {
  return getDb()
    .select({ path: libraryFolders.path })
    .from(libraryFolders)
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(libraries.managed, false))
    .all()
    .map(item => resolve(item.path))
}

export async function assertCleanupPaths(
  files: Pick<MaintenanceManifestPath, 'path' | 'mediaFileId'>[],
  downloadIds: string[],
) {
  if (!files.length)
    return
  const roots = externalRoots()
  const directoryKeys = new Map<string, Promise<string | null>>()
  function directoryKey(path: string) {
    let key = directoryKeys.get(path)
    if (!key) {
      key = stat(path, { bigint: true }).then(
        info => (info.isDirectory() ? `${info.dev}:${info.ino}` : null),
        () => null,
      )
      directoryKeys.set(path, key)
    }
    return key
  }
  const connected = new Set(
    (await Promise.all(roots.map(directoryKey))).filter(key => key !== null),
  )
  const entries = new Set<string>()
  const paths = new Set<string>()
  const names = new Set<string>()
  const mediaIds = new Set(
    files.flatMap(file => (file.mediaFileId ? [file.mediaFileId] : [])),
  )
  const fold = (value: string) => value.normalize('NFC').toLowerCase()
  for (const file of files) {
    const key = await directoryKey(dirname(file.path))
    const name = fold(basename(file.path))
    const entry = key ? `${key}:${name}` : null
    const path = fold(file.path)
    if (
      paths.has(path)
      || (entry && entries.has(entry))
      || roots.some(root => under(root, file.path))
    ) {
      throw new CleanupError('conflict')
    }
    if (entry)
      entries.add(entry)
    paths.add(path)
    names.add(name)
    if (connected.size) {
      for (let parent = dirname(file.path); ; parent = dirname(parent)) {
        const key = await directoryKey(parent)
        if (key && connected.has(key))
          throw new CleanupError('conflict')
        if (parent === dirname(parent))
          break
      }
    }
  }
  async function assertEntry(candidate: string) {
    const name = fold(basename(candidate))
    if (!names.has(name))
      return
    const key = await directoryKey(dirname(candidate))
    if (paths.has(fold(candidate)) || (key && entries.has(`${key}:${name}`)))
      throw new CleanupError('conflict')
  }
  const indexed = getDb()
    .select({
      id: mediaFiles.id,
      relPath: mediaFiles.relPath,
      root: libraryFolders.path,
    })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(mediaFiles.folderId, libraryFolders.id))
    .all()
  for (const file of indexed) {
    if (!mediaIds.has(file.id))
      await assertEntry(resolve(file.root, file.relPath))
  }
  const ids = new Set(downloadIds)
  const others = getDb()
    .select({
      id: torrents.id,
      name: torrents.name,
      files: torrents.files,
      downloadDir: torrents.downloadDir,
    })
    .from(torrents)
    .all()
  for (const other of others) {
    if (ids.has(other.id))
      continue
    for (const path of metadataPaths(other, torrentDir(other))) {
      await assertEntry(path)
      await assertEntry(`${path}.part`)
    }
  }
}
