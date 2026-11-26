import type {
  LibraryFolder,
  MaintenanceManifest,
  MediaFile,
  Torrent,
} from '../../db/schema.ts'
import type {
  TitleCleanupConfirmation,
  TitleCleanupPreview,
  TitleCleanupResult,
  TitleCleanupTitles,
} from '../../dto/titleCleanup.ts'
import type { EngineTorrentState } from '../engine/client.ts'
import type { CleanupFailure, CleanupFile } from './files.ts'
import { createHash } from 'node:crypto'
import { basename, dirname, relative } from 'node:path'
import { and, eq, inArray, isNotNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  followEpisodes,
  follows,
  maintenanceFiles,
  mediaFiles,
  torrents,
} from '../../db/schema.ts'
import {
  EngineError,
  getMaintenanceTorrentFiles,
  getStoredMaintenanceTorrentFiles,
  isEngineReady,
  listEngineTorrents,
} from '../engine/client.ts'
import { absolutePathOf, managedFolders } from '../library/files.ts'
import { sameStoredMtime } from '../library/playedSource.ts'
import {
  acquireMaintenanceExclusive,
  assertMaintenanceMutation,
  MaintenanceBusyError,
} from '../libraryMaintenance/admission.ts'
import { removeConfirmedFiles } from '../libraryMaintenance/executor.ts'
import { verifyOwnedFile } from '../libraryMaintenance/identity.ts'
import {
  episodesOf,
  groupForTorrent,
} from '../libraryMaintenance/provenance.ts'
import { restoreHeld } from '../libraryMaintenance/restore.ts'
import { logFor } from '../logs/index.ts'
import { verifiedManagedSubtitlePaths } from '../media/downloadedSubtitles.ts'
import { playbackResources } from '../media/sessions.ts'
import { hasPendingTorrentSpace } from '../storage/index.ts'
import { storageMoveState } from '../storage/move.ts'
import { torrentDir } from '../storage/paths.ts'
import { cachedTitleDetails } from '../tmdb/index.ts'
import { lastLiveTorrents } from '../torrents/index.ts'
import { isSeedObligationMet } from '../torrents/seeding.ts'
import {
  CleanupError,
  cleanupFile,
  estimatedReclaim,
  manifestFile,
} from './files.ts'
import { assertCleanupPaths } from './ownership.ts'

const catalogId = /^tmdb:(?:movie|tv):[1-9]\d{0,14}$/

type PreviewItem = TitleCleanupPreview['items'][number]
type ResultItem = TitleCleanupResult['items'][number]
type DownloadRow = Pick<
  Torrent,
  'id' | 'name' | 'titleId' | 'infoHash' | 'inEngine'
>
interface LocalFile {
  row: MediaFile
  folder: LibraryFolder
}
interface PlannedTorrent {
  row: Torrent
  sourceRoot: string
  pieceCount: number
  files: CleanupFile[]
}
interface Plan {
  item: PreviewItem
  files: CleanupFile[]
  downloads: PlannedTorrent[]
  detached: LocalFile[]
}

function libraryFiles(titleId?: string): LocalFile[] {
  const folders = new Map(
    managedFolders().map(folder => [folder.id, folder]),
  )
  if (!folders.size)
    return []
  return getDb()
    .select()
    .from(mediaFiles)
    .where(
      and(
        inArray(mediaFiles.folderId, [...folders.keys()]),
        eq(mediaFiles.state, 'present'),
        titleId
          ? eq(mediaFiles.titleId, titleId)
          : isNotNull(mediaFiles.titleId),
      ),
    )
    .all()
    .map(row => ({ row, folder: folders.get(row.folderId)! }))
}

function titleName(id: string, file?: LocalFile, download?: DownloadRow) {
  const metadata
    = cachedTitleDetails(id, 'ru-RU') ?? cachedTitleDetails(id, 'en-US')
  const folderPath = file?.row.relPath.split('/')
  return metadata?.title || folderPath?.[1] || download?.name || id
}

function latestDownloads() {
  return getDb()
    .select({
      id: torrents.id,
      titleId: torrents.titleId,
      name: torrents.name,
      infoHash: torrents.infoHash,
      inEngine: torrents.inEngine,
    })
    .from(torrents)
    .where(isNotNull(torrents.titleId))
    .all()
}

export async function cleanupTitles(): Promise<TitleCleanupTitles> {
  const grouped = new Map<
    string,
    { files: LocalFile[], downloads: DownloadRow[] }
  >()
  function group(id: string) {
    let value = grouped.get(id)
    if (!value) {
      value = { files: [], downloads: [] }
      grouped.set(id, value)
    }
    return value
  }
  for (const file of libraryFiles()) {
    if (file.row.titleId && catalogId.test(file.row.titleId))
      group(file.row.titleId).files.push(file)
  }
  const downloads = latestDownloads()
  for (const download of downloads) {
    if (download.titleId && catalogId.test(download.titleId))
      group(download.titleId).downloads.push(download)
  }
  const snapshot = downloads.length
    ? await listEngineTorrents().catch(() => null)
    : []
  const live = snapshot
    ? new Map(snapshot.map(row => [row.infoHash, row]))
    : lastLiveTorrents()
  return {
    items: [...grouped]
      .map(([id, { files, downloads }]) => ({
        id,
        name: titleName(id, files[0], downloads[0]),
        libraryBytes: files.reduce((total, file) => total + file.row.size, 0),
        downloadBytes: downloads.some(row => !live.has(row.infoHash))
          ? null
          : downloads.reduce(
              (total, row) =>
                total + (live.get(row.infoHash)?.bytesCompleted ?? 0),
              0,
            ),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
  }
}

function result(
  id: string,
  status: ResultItem['status'],
  operationIds: string[] = [],
): ResultItem {
  return { id, status, operationIds }
}

function reasonOf(error: unknown): CleanupFailure {
  if (error instanceof CleanupError)
    return error.reason
  if (error instanceof MaintenanceBusyError)
    return 'busy'
  if (
    error instanceof EngineError
    && error.engineCode === 'torrent_obligation_unmet'
  ) {
    return 'private'
  }
  return 'unavailable'
}

async function planLibraryFile({ row, folder }: LocalFile) {
  const path = absolutePathOf(folder, row)
  const main = await cleanupFile(
    folder.path,
    path,
    'library',
    row.id,
    row.linkMode === 'reflink',
  )
  if (
    !main
    || (row.inode !== null && row.inode !== main.inode)
    || row.size !== main.size
    || !sameStoredMtime(row.mtime, main.mtime)
  ) {
    throw new CleanupError('conflict')
  }
  const sidecars = new Map<
    string,
    typeof maintenanceFiles.$inferSelect | undefined
  >()
  for (const sidecar of getDb()
    .select()
    .from(maintenanceFiles)
    .where(
      and(
        eq(maintenanceFiles.mediaFileId, row.id),
        eq(maintenanceFiles.kind, 'sidecar'),
      ),
    )
    .all()) {
    if (
      sidecar.root === folder.path
      && dirname(sidecar.path) === dirname(path)
      && sidecar.path !== path
    ) {
      sidecars.set(sidecar.path, sidecar)
    }
  }
  for (const sidecar of verifiedManagedSubtitlePaths(row.id)) {
    if (dirname(sidecar) === dirname(path) && sidecar !== path)
      sidecars.set(sidecar, undefined)
  }
  const files: CleanupFile[] = []
  for (const [sidecar, stored] of sidecars) {
    const file = await cleanupFile(
      folder.path,
      sidecar,
      'sidecar',
      row.id,
      stored?.linkMode === 'reflink',
    )
    if (!file)
      continue
    if (stored && (await verifyOwnedFile(stored)) !== 'present')
      throw new CleanupError('conflict')
    files.push(file)
  }
  return [...files.sort((a, b) => a.path.localeCompare(b.path)), main]
}

async function planTorrent(
  row: Torrent,
  current: EngineTorrentState | undefined,
) {
  if (!current && hasPendingTorrentSpace(row.id))
    throw new CleanupError('busy')
  const source = current
    ? await getMaintenanceTorrentFiles(row.infoHash)
    : row.torrentFile && !row.inEngine
      ? await getStoredMaintenanceTorrentFiles(
          row.infoHash,
          torrentDir(row),
          row.torrentFile,
        )
      : undefined
  if (!source)
    throw new CleanupError('unavailable')
  if (
    source.root !== torrentDir(row)
    || (current?.dir && source.root !== current.dir)
  ) {
    throw new CleanupError('conflict')
  }
  if ((source.private && !row.isPrivate) || !isSeedObligationMet(row, current))
    throw new CleanupError('private')
  const prior = current ? undefined : groupForTorrent(row.id)
  const inventory
    = prior && !prior.sourceEvictedAt
      ? getDb()
          .select()
          .from(maintenanceFiles)
          .where(
            and(
              eq(maintenanceFiles.groupId, prior.id),
              eq(maintenanceFiles.kind, 'source'),
            ),
          )
          .all()
      : []
  const knownPaths = new Map(inventory.map(file => [file.path, file]))
  const files: CleanupFile[] = []
  for (const path of source.paths) {
    const item = await cleanupFile(source.root, path, 'source', null)
    if (!item)
      continue
    if (!current) {
      // A dormant torrent's metadata still names paths after cache eviction.
      // Only earlier ownership of this exact file authorizes its deletion.
      const known = knownPaths.get(path)
      if (
        !known
        || known.root !== item.root
        || known.rootDevice !== item.rootDevice
        || known.rootInode !== item.rootInode
        || known.device !== item.device
        || known.inode !== item.inode
        || known.size !== item.size
        || known.mtime !== item.mtime
      ) {
        throw new CleanupError('conflict')
      }
    }
    files.push(item)
  }
  return { row, sourceRoot: source.root, pieceCount: source.pieceCount, files }
}

function assertOwnership(
  titleId: string,
  downloads: Torrent[],
  files: LocalFile[],
) {
  const ids = new Set(downloads.map(row => row.id))
  if (files.some(({ row }) => row.torrentId && !ids.has(row.torrentId)))
    throw new CleanupError('conflict')
  if (!ids.size)
    return
  const otherFiles = getDb()
    .select({
      titleId: mediaFiles.titleId,
      torrentId: mediaFiles.torrentId,
      replacementTorrentId: mediaFiles.replacementTorrentId,
      replaced: mediaFiles.replaced,
    })
    .from(mediaFiles)
    .all()
  if (
    otherFiles.some(
      row =>
        row.titleId !== titleId
        && ((row.torrentId && ids.has(row.torrentId))
          || (row.replacementTorrentId && ids.has(row.replacementTorrentId))
          || row.replaced?.some(ref => ids.has(ref.torrentId))),
    )
  ) {
    throw new CleanupError('conflict')
  }
}

let running = false

async function makePlan(id: string, held = false): Promise<Plan> {
  const local = libraryFiles(id).sort((a, b) =>
    a.row.id.localeCompare(b.row.id),
  )
  const downloads = getDb()
    .select()
    .from(torrents)
    .where(eq(torrents.titleId, id))
    .all()
    .sort((a, b) => a.id.localeCompare(b.id))
  const item: PreviewItem = {
    id,
    name: titleName(id, local[0], downloads[0]),
    downloads: downloads.map(({ id, name }) => ({ id, name })),
    files: [],
    fingerprint: null,
    reason: null,
  }
  const files: CleanupFile[] = []
  const plans: PlannedTorrent[] = []
  const detached: LocalFile[] = []
  try {
    if (!local.length && !downloads.length)
      throw new CleanupError('missing')
    if (restoreHeld() || storageMoveState()?.status === 'running')
      throw new CleanupError('busy')
    if (!isEngineReady())
      throw new CleanupError('unavailable')
    if (!held)
      assertMaintenanceMutation({ titleId: id })
    const downloadIds = new Set(downloads.map(row => row.id))
    const mediaIds = new Set(local.map(({ row }) => row.id))
    if (
      playbackResources().some(
        row =>
          (row.torrentId && downloadIds.has(row.torrentId))
          || (row.mediaFileId && mediaIds.has(row.mediaFileId)),
      )
    ) {
      throw new CleanupError('busy')
    }
    assertOwnership(id, downloads, local)
    const live = downloads.length ? await listEngineTorrents() : []
    const liveByHash = new Map(live.map(state => [state.infoHash, state]))
    const byId = new Map<string, PlannedTorrent>()
    for (const row of downloads) {
      const plan = await planTorrent(row, liveByHash.get(row.infoHash))
      plans.push(plan)
      byId.set(row.id, plan)
      files.push(...plan.files)
    }
    for (const file of local) {
      const planned = await planLibraryFile(file)
      files.push(...planned)
      const torrent = file.row.torrentId
        ? byId.get(file.row.torrentId)
        : undefined
      if (torrent)
        torrent.files.push(...planned)
      else detached.push(file)
    }
    await assertCleanupPaths(
      files,
      downloads.map(row => row.id),
    )
    item.files = files.map(file => ({
      path: relative(file.root, file.path) || basename(file.path),
      size: file.size,
      kind: file.kind === 'source' ? 'download' : 'library',
    }))
    item.fingerprint = createHash('sha256')
      .update(
        JSON.stringify({
          id,
          downloads: plans.map(plan => [
            plan.row.id,
            plan.row.infoHash,
            plan.sourceRoot,
            plan.pieceCount,
          ]),
          detached: detached.map(({ row }) => row.id),
          files: files.map(manifestFile),
        }),
      )
      .digest('hex')
  }
  catch (error) {
    item.reason = reasonOf(error)
  }
  return { item, files, downloads: plans, detached }
}

export async function previewTitleCleanup(
  ids: string[],
): Promise<TitleCleanupPreview> {
  const result: Plan[] = []
  for (const id of new Set(ids)) result.push(await makePlan(id))
  const eligible = result.filter(plan => plan.item.fingerprint)
  return {
    items: result.map(plan => plan.item),
    reclaimableBytes: eligible.length
      ? estimatedReclaim(eligible.flatMap(plan => plan.files))
      : null,
  }
}

function removedEpisodes(id: string, files: MediaFile[], torrent?: Torrent) {
  if (id.startsWith('tmdb:movie:'))
    return [{ season: 0, episode: 0 }]
  const group = torrent && groupForTorrent(torrent.id)
  const recorded = group
    ? getDb()
        .select({ episodes: maintenanceFiles.episodes })
        .from(maintenanceFiles)
        .where(eq(maintenanceFiles.groupId, group.id))
        .all()
    : []
  const following = torrent
    ? getDb()
        .select({
          season: followEpisodes.season,
          episode: followEpisodes.episode,
        })
        .from(followEpisodes)
        .innerJoin(follows, eq(follows.id, followEpisodes.followId))
        .where(
          and(
            eq(follows.titleId, id),
            eq(followEpisodes.torrentId, torrent.id),
          ),
        )
        .all()
    : []
  const episodes = [
    ...files.flatMap(episodesOf),
    ...recorded.flatMap(row => row.episodes),
    ...following,
  ]
  return [
    ...new Map(
      episodes.map(episode => [
        `${episode.season}:${episode.episode}`,
        episode,
      ]),
    ).values(),
  ]
}

async function executeTitle({
  id,
  fingerprint,
}: TitleCleanupConfirmation['items'][number]): Promise<ResultItem> {
  const operationIds: string[] = []
  let removed = false
  let release: (() => void) | undefined
  try {
    const approved = await makePlan(id)
    if (!approved.item.fingerprint) {
      return result(
        id,
        approved.item.reason === 'missing' ? 'stale' : 'blocked',
      )
    }
    if (approved.item.fingerprint !== fingerprint)
      return result(id, 'stale')
    assertMaintenanceMutation({ titleId: id })
    release = acquireMaintenanceExclusive(
      { titleId: id, libraryTopology: true },
      approved.files.map(file => file.path),
    )
    const current = await makePlan(id, true)
    if (current.item.fingerprint !== fingerprint)
      return result(id, current.item.reason ? 'blocked' : 'stale')
    const rows = new Map(libraryFiles(id).map(({ row }) => [row.id, row]))
    for (const download of current.downloads) {
      const manifest: MaintenanceManifest = {
        infoHash: download.row.infoHash,
        pieceCount: download.pieceCount,
        sourceRoot: download.sourceRoot,
        paths: download.files.map(manifestFile),
      }
      const local = download.files.flatMap(file =>
        file.kind === 'library'
        && file.mediaFileId
        && rows.has(file.mediaFileId)
          ? [rows.get(file.mediaFileId)!]
          : [],
      )
      const outcome = await removeConfirmedFiles({
        titleId: id,
        torrentId: download.row.id,
        manifest,
        episodes: removedEpisodes(id, local, download.row),
      })
      if (!outcome.deleted) {
        if (!outcome.cancelled)
          operationIds.push(outcome.id)
        return result(
          id,
          removed || operationIds.length ? 'partial' : 'stale',
          operationIds,
        )
      }
      removed = true
    }
    if (current.detached.length) {
      const ids = new Set(current.detached.map(file => file.row.id))
      const paths = current.files
        .filter(file => file.mediaFileId && ids.has(file.mediaFileId))
        .map(manifestFile)
      const outcome = await removeConfirmedFiles({
        titleId: id,
        manifest: { infoHash: '', pieceCount: 0, libraryOnly: true, paths },
        episodes: removedEpisodes(
          id,
          current.detached.map(file => file.row),
        ),
      })
      if (!outcome.deleted) {
        if (!outcome.cancelled)
          operationIds.push(outcome.id)
        return result(
          id,
          removed || operationIds.length ? 'partial' : 'stale',
          operationIds,
        )
      }
    }
    return result(id, 'deleted')
  }
  catch (error) {
    logFor('storage').warn(
      { titleId: id, reason: reasonOf(error) },
      'Manual disk cleanup stopped',
    )
    return result(
      id,
      removed || operationIds.length ? 'partial' : 'blocked',
      operationIds,
    )
  }
  finally {
    release?.()
  }
}

export async function executeTitleCleanup(
  items: TitleCleanupConfirmation['items'],
): Promise<TitleCleanupResult> {
  const unique = new Map(items.map(item => [item.id, item]))
  if (running)
    return { items: [...unique.keys()].map(id => result(id, 'blocked')) }
  running = true
  try {
    const results: ResultItem[] = []
    for (const item of unique.values()) results.push(await executeTitle(item))
    return { items: results }
  }
  finally {
    running = false
  }
}
