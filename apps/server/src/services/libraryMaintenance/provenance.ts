import { isVideoFile } from '../torrents/media.ts'
import { ownedIdentity, verifyOwnedFile } from './identity.ts'
import { torrentDir } from '../storage/paths.ts'
import type {
  MaintenanceEpisode,
  MediaFile,
  MediaLinkMode,
  Torrent,
} from '../../db/schema.ts'
import type { EngineTorrentState } from '../engine/index.ts'
import { lstatSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { maintenanceFiles, maintenanceGroups } from '../../db/schema.ts'
import { getTorrentSettings } from '../torrents/settings.ts'

export { ownedIdentity } from './identity.ts'

export function groupForTorrent(torrentId: string) {
  return getDb()
    .select()
    .from(maintenanceGroups)
    .where(eq(maintenanceGroups.torrentId, torrentId))
    .get()
}

/** Фиксируется только реальная новая загрузка; старые origin=follow не усыновляются. */
export function recordDownload(torrent: Torrent, origin: 'follow' | 'manual') {
  if (!torrent.titleId && origin === 'follow')
    return
  const db = getDb()
  const existing = groupForTorrent(torrent.id)
  if (existing) {
    db.update(maintenanceGroups)
      .set({
        selectedFiles: [
          ...new Set([
            ...existing.selectedFiles,
            ...(torrent.selectedFiles ?? []),
          ]),
        ],
        manualProtection: existing.manualProtection || origin === 'manual',
        completedAt: null,
        sourceEvictedAt: null,
        denominator: null,
        uploaded: null,
        revision: existing.revision + 1,
        eligibleSince: null,
        eligibilityFingerprint: null,
      })
      .where(eq(maintenanceGroups.id, existing.id))
      .run()
    return
  }
  // Старый keep может содержать ручной выбор: он не становится автоматическим.
  let root: { sourceRootDevice: string, sourceRootInode: number } | undefined
  try {
    const path = resolve(torrentDir(torrent))
    const info = lstatSync(path)
    if (
      info.isDirectory()
      && Number.isSafeInteger(info.ino)
      && Number.isSafeInteger(info.dev)
      && realpathSync(path) === path
    ) {
      root = { sourceRootDevice: String(info.dev), sourceRootInode: info.ino }
    }
  }
  catch {}
  db.insert(maintenanceGroups)
    .values({
      titleId: torrent.titleId ?? '',
      initialInfoHash: torrent.infoHash,
      torrentFiles: torrent.files ?? [],
      pieceCount: torrent.pieceLength
        ? Math.ceil(
            (torrent.files ?? []).reduce((sum, file) => sum + file.size, 0)
            / torrent.pieceLength,
          )
        : null,
      sourceRoot: resolve(torrentDir(torrent)),
      ...root,
      torrentId: torrent.id,
      origin,
      manualProtection: origin === 'manual',
      selectedFiles: torrent.selectedFiles ?? [],
      seedRule: torrent.seedRule ?? getTorrentSettings().seedRule,
      completedAt: null,
    })
    .run()
}

export function protectTorrent(torrentId: string) {
  getDb()
    .update(maintenanceGroups)
    .set({
      manualProtection: true,
      revision: sql`${maintenanceGroups.revision} + 1`,
      eligibleSince: null,
      eligibilityFingerprint: null,
    })
    .where(eq(maintenanceGroups.torrentId, torrentId))
    .run()
}

export function recordActivity(torrentId: string) {
  getDb()
    .update(maintenanceGroups)
    .set({
      lastActivityAt: new Date(),
      eligibleSince: null,
      eligibilityFingerprint: null,
    })
    .where(eq(maintenanceGroups.torrentId, torrentId))
    .run()
}

/** Цель раздачи сохраняется при переходе копий в кэш и потере live torrent. */
export function recordSeeding(torrent: Torrent, state: EngineTorrentState) {
  const group = groupForTorrent(torrent.id)
  if (!group)
    return
  getDb()
    .update(maintenanceGroups)
    .set({
      ...(torrent.retention === 'keep' && {
        seedRule: torrent.seedRule ?? getTorrentSettings().seedRule,
      }),
      completedAt:
        torrent.retention === 'keep'
          ? state.bytesWanted > 0 && state.wantedCompleted >= state.bytesWanted
            ? (group.completedAt ?? new Date())
            : null
          : group.completedAt,
      uploaded: state.uploaded,
      denominator:
        torrent.retention === 'keep'
          ? state.bytesWanted || state.bytesCompleted
          : group.denominator,
    })
    .where(eq(maintenanceGroups.id, group.id))
    .run()
}

export function episodesOf(
  file: Pick<MediaFile, 'season' | 'episode' | 'episodeTo'>,
): MaintenanceEpisode[] {
  if (file.season === null || file.episode === null)
    return []
  const end = file.episodeTo ?? file.episode
  if (end < file.episode || end - file.episode > 1000)
    return []
  return Array.from({ length: end - file.episode + 1 }, (_, i) => ({
    season: file.season!,
    episode: file.episode! + i,
  }))
}

/** Записываются только только что размещённые файлы, не существовавшие соседи. */
export async function recordPlaced(input: {
  torrent: Torrent
  source: string
  sourceRoot: string
  path: string
  root: string
  fileIndex: number
  mediaFileId: string
  episodes: MaintenanceEpisode[]
  linkMode: MediaLinkMode
  sidecar?: boolean
}) {
  const group = groupForTorrent(input.torrent.id)
  if (!group)
    return
  const source = await ownedIdentity(input.sourceRoot, input.source)
  const target = await ownedIdentity(input.root, input.path)
  if (
    !source
    || !target
    || source.rootDevice !== group.sourceRootDevice
    || source.rootInode !== group.sourceRootInode
  ) {
    return
  }
  const db = getDb()
  db.transaction(() => {
    for (const [kind, identity] of [
      ['source', source],
      [input.sidecar ? 'sidecar' : 'library', target],
    ] as const) {
      db.insert(maintenanceFiles)
        .values({
          groupId: group.id,
          kind,
          ...identity,
          fileIndex: input.fileIndex,
          mediaFileId: input.mediaFileId,
          episodes: input.episodes,
          linkMode: input.linkMode,
        })
        .onConflictDoNothing()
        .run()
    }
    db.update(maintenanceGroups)
      .set({
        revision: sql`${maintenanceGroups.revision} + 1`,
        eligibleSince: null,
        eligibilityFingerprint: null,
      })
      .where(eq(maintenanceGroups.id, group.id))
      .run()
  })
}

/** Обновление меняет состав: неопределённость отмечается отдельно от ручной защиты. */
export function protectReplacement(
  oldTorrentId: string | null,
  newTorrentId: string,
) {
  const old = oldTorrentId ? groupForTorrent(oldTorrentId) : undefined
  const next = groupForTorrent(newTorrentId)
  for (const group of [old, next]) {
    if (!group)
      continue
    getDb()
      .update(maintenanceGroups)
      .set({
        identityUncertain: true,
        manualProtection: group.manualProtection || !!old?.manualProtection,
        revision: group.revision + 1,
        eligibleSince: null,
        eligibilityFingerprint: null,
      })
      .where(eq(maintenanceGroups.id, group.id))
      .run()
  }
}

export function recordMediaActivity(mediaFileId: string) {
  const ids = getDb()
    .select({ groupId: maintenanceFiles.groupId })
    .from(maintenanceFiles)
    .where(eq(maintenanceFiles.mediaFileId, mediaFileId))
    .all()
    .map(row => row.groupId)
  if (ids.length) {
    getDb()
      .update(maintenanceGroups)
      .set({
        lastActivityAt: new Date(),
        eligibleSince: null,
        eligibilityFingerprint: null,
      })
      .where(inArray(maintenanceGroups.id, ids))
      .run()
  }
}

/** Ручная загрузка без каталожного ID сохраняет защиту после распознавания. */
export function recordTitleLink(torrentId: string, titleId: string) {
  const group = groupForTorrent(torrentId)
  if (!group || group.titleId === titleId)
    return
  getDb()
    .update(maintenanceGroups)
    .set({
      titleId,
      identityUncertain: group.identityUncertain || !!group.titleId,
      revision: group.revision + 1,
      eligibleSince: null,
      eligibilityFingerprint: null,
    })
    .where(eq(maintenanceGroups.id, group.id))
    .run()
}

/**
 * Полностью скачанные metadata-owned extras из управляемого каталога; видео
 * без доказанного размещения не принимаются автоматически.
 */
export async function recordSourceInventory(
  torrent: Torrent,
  state: EngineTorrentState,
) {
  const group = groupForTorrent(torrent.id)
  if (!group)
    return
  const db = getDb()
  const recorded = db
    .select()
    .from(maintenanceFiles)
    .where(eq(maintenanceFiles.groupId, group.id))
    .all()
  for (const [fileIndex, file] of (torrent.files ?? []).entries()) {
    if (
      file.padding
      || recorded.some(
        item => item.kind === 'source' && item.fileIndex === fileIndex,
      )
    ) {
      continue
    }
    if (isVideoFile(file.path) || /\.vob$/i.test(file.path))
      continue
    if ((state.fileProgress[fileIndex] ?? 0) < file.size)
      continue
    for (const path of [
      join(group.sourceRoot, torrent.name, file.path),
      join(group.sourceRoot, file.path),
    ]) {
      const identity = await ownedIdentity(group.sourceRoot, path)
      if (
        !identity
        || identity.size !== file.size
        || identity.rootDevice !== group.sourceRootDevice
        || identity.rootInode !== group.sourceRootInode
      ) {
        continue
      }
      db.insert(maintenanceFiles)
        .values({
          ...identity,
          groupId: group.id,
          kind: 'source',
          fileIndex,
          episodes: [],
          linkMode: null,
        })
        .onConflictDoNothing()
        .run()
      db.update(maintenanceGroups)
        .set({
          revision: sql`${maintenanceGroups.revision} + 1`,
          eligibleSince: null,
          eligibilityFingerprint: null,
        })
        .where(eq(maintenanceGroups.id, group.id))
        .run()
      break
    }
  }
}

/** Только после подтверждённого удаления кэша. Потеря FK сама по себе не доказательство. */
export async function reconcileSourceEviction(torrentId: string) {
  const group = groupForTorrent(torrentId)
  if (!group)
    return
  const files = getDb()
    .select()
    .from(maintenanceFiles)
    .where(eq(maintenanceFiles.groupId, group.id))
    .all()
    .filter(file => file.kind === 'source')
  if (
    !files.length
    || !(await Promise.all(files.map(verifyOwnedFile))).every(
      state => state === 'missing',
    )
  ) {
    return
  }
  getDb()
    .update(maintenanceGroups)
    .set({
      sourceEvictedAt: new Date(),
      eligibleSince: null,
      eligibilityFingerprint: null,
    })
    .where(eq(maintenanceGroups.id, group.id))
    .run()
}
