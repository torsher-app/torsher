import { restoreHeld } from './restore.ts'
import type { EngineMaintenanceOperation } from '../engine/client.ts'
import { and, eq, inArray, ne, or } from 'drizzle-orm'
import { basename, dirname, join } from 'node:path'
import { statSync } from 'node:fs'
import { getDb } from '../../db/index.ts'
import {
  libraryFolders,
  maintenanceFiles,
  maintenanceGroups,
  maintenanceOperations,
  mediaFiles,
  torrents,
} from '../../db/schema.ts'
import { getSetting } from '../settings/index.ts'

export interface MaintenanceResource {
  titleId?: string | null
  torrentId?: string | null
  mediaFileId?: string | null
  infoHash?: string | null
  groupId?: string
  global?: boolean
  producer?: boolean
}
export class MaintenanceBusyError extends Error {
  readonly statusCode = 409
  readonly code = 'maintenance_resource_held'
  constructor() {
    super('maintenance_resource_held')
  }
}
const shared = new Map<symbol, Set<string>>()
const exclusive = new Map<symbol, Set<string>>()
// Имя в одном каталоге остаётся тем же ресурсом через разные bind mounts.
export function maintenancePathKeys(path: string) {
  const keys = [`path:${path}`]
  try {
    const parent = statSync(dirname(path), { bigint: true })
    keys.push(`entry:${parent.dev}:${parent.ino}:${basename(path)}`)
  }
  catch {
    /* Отсутствующий путь всё ещё защищён исходным именем. */
  }
  return keys
}
export function resourceKeys(ref: MaintenanceResource) {
  const db = getDb()
  const keys = new Set<string>()
  if (ref.global)
    keys.add('*')
  if (ref.titleId)
    keys.add(`title:${ref.titleId}`)
  if (ref.torrentId)
    keys.add(`torrent:${ref.torrentId}`)
  if (ref.infoHash)
    keys.add(`hash:${ref.infoHash}`)
  if (ref.mediaFileId) {
    keys.add(`file:${ref.mediaFileId}`)
    const file = db
      .select()
      .from(mediaFiles)
      .where(eq(mediaFiles.id, ref.mediaFileId))
      .get()
    if (file?.titleId)
      keys.add(`title:${file.titleId}`)
    if (file) {
      const folder = db
        .select()
        .from(libraryFolders)
        .where(eq(libraryFolders.id, file.folderId))
        .get()
      if (folder) {
        maintenancePathKeys(join(folder.path, file.relPath)).forEach(key =>
          keys.add(key),
        )
      }
    }
  }
  if (ref.torrentId || ref.infoHash) {
    const torrent = db
      .select()
      .from(torrents)
      .where(
        or(
          ref.torrentId ? eq(torrents.id, ref.torrentId) : undefined,
          ref.infoHash ? eq(torrents.infoHash, ref.infoHash) : undefined,
        ),
      )
      .get()
    if (torrent) {
      keys.add(`hash:${torrent.infoHash}`)
      if (torrent.titleId)
        keys.add(`title:${torrent.titleId}`)
    }
  }
  const owned = ref.mediaFileId
    ? db
        .select({ groupId: maintenanceFiles.groupId })
        .from(maintenanceFiles)
        .where(eq(maintenanceFiles.mediaFileId, ref.mediaFileId))
        .all()
        .map(file => file.groupId)
    : []
  const conditions = [
    ref.groupId ? eq(maintenanceGroups.id, ref.groupId) : undefined,
    ref.torrentId ? eq(maintenanceGroups.torrentId, ref.torrentId) : undefined,
    ref.infoHash
      ? eq(maintenanceGroups.initialInfoHash, ref.infoHash)
      : undefined,
    ref.titleId ? eq(maintenanceGroups.titleId, ref.titleId) : undefined,
    owned.length ? inArray(maintenanceGroups.id, owned) : undefined,
  ].filter(item => item !== undefined)
  if (conditions.length) {
    for (const group of db
      .select()
      .from(maintenanceGroups)
      .where(or(...conditions))
      .all()) {
      for (const file of db
        .select({ path: maintenanceFiles.path })
        .from(maintenanceFiles)
        .where(eq(maintenanceFiles.groupId, group.id))
        .all())
        maintenancePathKeys(file.path).forEach(key => keys.add(key))
      keys.add(`group:${group.id}`)
      keys.add(`hash:${group.initialInfoHash}`)
      keys.add(`title:${group.titleId}`)
    }
  }
  // Связываем пути по индексам title/torrent/file: другой bind mount может
  // принадлежать иной группе. Полные таблицы на playback hot path не читаем.
  {
    const titles = [...keys]
      .filter(key => key.startsWith('title:'))
      .map(key => key.slice(6))
    const conditions = [
      titles.length ? inArray(mediaFiles.titleId, titles) : undefined,
      ref.torrentId ? eq(mediaFiles.torrentId, ref.torrentId) : undefined,
      ref.mediaFileId ? eq(mediaFiles.id, ref.mediaFileId) : undefined,
    ].filter(item => item !== undefined)
    if (conditions.length) {
      for (const file of db
        .select({ root: libraryFolders.path, path: mediaFiles.relPath })
        .from(mediaFiles)
        .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
        .where(or(...conditions))
        .all()) {
        maintenancePathKeys(join(file.root, file.path)).forEach(key =>
          keys.add(key),
        )
      }
    }
  }
  return keys
}
function overlaps(a: Set<string>, b: Set<string>) {
  return a.has('*') || b.has('*') || [...a].some(key => b.has(key))
}
export function unresolvedOperations() {
  return getDb()
    .select()
    .from(maintenanceOperations)
    .where(
      or(
        and(
          ne(maintenanceOperations.state, 'cleaned'),
          ne(maintenanceOperations.state, 'cancelled'),
        ),
        and(
          eq(maintenanceOperations.state, 'cleaned'),
          ne(maintenanceOperations.engineStage, 'finalized'),
        ),
      ),
    )
    .all()
}
/** Вызывается синхронно до первого await: между проверкой и арендой нет окна. */
export function acquireMaintenanceLease(ref: MaintenanceResource) {
  const keys = resourceKeys(ref)
  if (ref.producer && restoreHeld())
    throw new MaintenanceBusyError()
  if (
    externalMaintenanceFences()
      .filter(fence => !['finalized', 'cancelled'].includes(fence.state))
      .some(fence =>
        overlaps(
          keys,
          new Set([
            `hash:${fence.manifest.infoHash}`,
            ...fence.manifest.paths.flatMap(path =>
              maintenancePathKeys(path.path),
            ),
          ]),
        ),
      )
      || [...exclusive.values()].some(other => overlaps(keys, other))
      || unresolvedOperations().some(op =>
        overlaps(
          keys,
          new Set([
            `group:${op.groupId}`,
            `title:${op.titleId}`,
            `hash:${op.manifest.infoHash}`,
            ...op.manifest.paths.flatMap(path =>
              maintenancePathKeys(path.path),
            ),
          ]),
        ),
      )
  ) {
    throw new MaintenanceBusyError()
  }
  const id = Symbol('maintenance-lease')
  shared.set(id, keys)
  return () => {
    shared.delete(id)
  }
}
export async function withMaintenanceLease<T>(
  ref: MaintenanceResource,
  run: () => Promise<T>,
): Promise<T> {
  const release = acquireMaintenanceLease(ref)
  try {
    return await run()
  }
  finally {
    release()
  }
}
/** Политика может меняться у остановленной операции, но не во время unlink. */
export function assertMaintenancePolicyChange(ref: MaintenanceResource) {
  const keys = resourceKeys(ref)
  if ([...exclusive.values()].some(other => overlaps(keys, other)))
    throw new MaintenanceBusyError()
}
export function acquireMaintenanceExclusive(groupId: string) {
  const keys = resourceKeys({ groupId })
  if (
    [...shared.values(), ...exclusive.values()].some(other =>
      overlaps(keys, other),
    )
  ) {
    throw new MaintenanceBusyError()
  }
  const id = Symbol('maintenance-lease')
  exclusive.set(id, keys)
  return () => {
    exclusive.delete(id)
  }
}
export function assertMaintenanceMutation(ref: MaintenanceResource) {
  acquireMaintenanceLease(ref)()
}

export function externalMaintenanceFences() {
  return (
    getSetting<EngineMaintenanceOperation[]>('maintenanceExternalFences') ?? []
  )
}
