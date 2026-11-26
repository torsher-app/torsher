import { Buffer } from 'node:buffer'
import type { BigIntStats } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'
import type { LibraryFolder } from '../../db/schema.ts'
import type { UsenetClient } from './config.ts'
import { constants } from 'node:fs'
import { link, lstat, open, opendir, unlink } from 'node:fs/promises'
import { posix } from 'node:path'
import { matchFiles, parseRelease } from '@torsher/release-parser'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb } from '../../db/index.ts'
import {
  libraryFolders,
  mediaFiles,
  profiles,
  usenetJobs,
} from '../../db/schema.ts'
import { existingTitleFolder, managedFolder } from '../library/files.ts'
import { extensionOf, videoPath } from '../library/layout.ts'
import { layoutTitleOf, libraryPath } from '../library/linker.ts'
import { queueProbe } from '../library/probe.ts'
import { withMaintenanceLease } from '../libraryMaintenance/admission.ts'
import { durableMaintenance } from '../libraryMaintenance/durable.ts'
import { diskUsage } from '../storage/disk.ts'
import { isMoveRunning } from '../storage/move.ts'
import { storagePath } from '../storage/paths.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { checkUsenetInbox } from './config.ts'
import { UsenetError } from './errors.ts'
import { recordUsenetFollow } from './follow.ts'
import {
  assertPinnedPath,
  fdPath,
  openDirectoryChild,
  storageParts,
  withPinnedDirectory,
} from './paths.ts'
import { sabAttemptName } from './sab.ts'

const MAX_ENTRIES = 2048
const MAX_DEPTH = 8
const READ_FILE_FLAGS
  = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK

const identitySchema = z.object({
  device: z.string().regex(/^-?\d+$/),
  inode: z.string().regex(/^\d+$/),
  size: z.number().int().positive(),
  modified: z.string().regex(/^-?\d+$/),
})
const receiptSchema = z.object({
  folderId: z.string(),
  folderPath: z.string(),
  relPath: z.string(),
  identity: identitySchema.optional(),
})

type Receipt = z.infer<typeof receiptSchema>
type FileIdentity = z.infer<typeof identitySchema>
type Job = typeof usenetJobs.$inferSelect
interface SourceFile {
  path: string
  size: number
}
type ObservedFile = SourceFile & { identity: FileIdentity, changed: bigint }

function fileIdentity(stats: BigIntStats): FileIdentity {
  if (
    !stats.isFile()
    || stats.size <= 0n
    || stats.size > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new UsenetError('output_invalid')
  }
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    size: Number(stats.size),
    modified: stats.mtimeNs.toString(),
  }
}

function sameFile(stats: BigIntStats, identity: FileIdentity) {
  return (
    stats.isFile()
    && stats.dev.toString() === identity.device
    && stats.ino.toString() === identity.inode
    && stats.size === BigInt(identity.size)
    && stats.mtimeNs.toString() === identity.modified
  )
}

async function entryStats(path: string) {
  try {
    return await lstat(path, { bigint: true })
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw error
  }
}

export function chooseUsenetVideo(
  job: Pick<Job, 'season' | 'episode' | 'releaseTitle'>,
  files: SourceFile[],
) {
  const parsed = parseRelease(job.releaseTitle)
  const matches = matchFiles(files, parsed).filter(
    file => file.kind === 'video',
  )
  const video = matches[0]
  if (matches.length !== 1 || !video)
    throw new UsenetError('output_invalid')

  if (job.episode === 0) {
    if (
      video.episode !== undefined
      || video.season !== undefined
      || video.absolute !== undefined
    ) {
      throw new UsenetError('output_invalid')
    }
  }
  else if (
    video.episode !== job.episode
    || (video.season
      ?? (parsed.seasons.length === 1 ? parsed.seasons[0] : undefined))
    !== job.season
    || video.absolute !== undefined
    || (video.episodeTo !== undefined && video.episodeTo !== job.episode)
  ) {
    throw new UsenetError('output_invalid')
  }

  return video
}

async function outputFiles(localRoot: string, parts: string[]) {
  const absolute = posix.join(localRoot, ...parts)
  const files: ObservedFile[] = []
  let total = 0

  function verifyEntry(
    stats: BigIntStats | undefined,
    name: string,
  ): asserts stats is BigIntStats {
    if (
      ++total > MAX_ENTRIES
      || name.includes('\\')
      || !stats
      || (!stats.isFile() && !stats.isDirectory())
    ) {
      throw new UsenetError('output_invalid')
    }
  }

  function appendFile(stats: BigIntStats, path: string[]) {
    if (stats.size <= 0n || stats.size > BigInt(Number.MAX_SAFE_INTEGER))
      return
    files.push({
      path: path.join('/'),
      size: Number(stats.size),
      identity: fileIdentity(stats),
      changed: stats.ctimeNs,
    })
  }

  async function list(
    directory: FileHandle,
    path: string,
    relative: string[],
    depth: number,
  ) {
    if (depth > MAX_DEPTH)
      throw new UsenetError('output_invalid')
    await assertPinnedPath(directory, path)
    const stream = await opendir(fdPath(directory))
    for await (const entry of stream) {
      const relativePath = [...relative, entry.name]
      const stats = await entryStats(`${fdPath(directory)}/${entry.name}`)
      verifyEntry(stats, entry.name)
      if (stats.isDirectory()) {
        const child = await openDirectoryChild(directory, entry.name)
        try {
          await list(
            child,
            posix.join(path, entry.name),
            relativePath,
            depth + 1,
          )
        }
        finally {
          await child.close()
        }
      }
      else {
        appendFile(stats, relativePath)
      }
    }
  }

  await withPinnedDirectory(
    posix.dirname(absolute),
    false,
    async (directory) => {
      const name = posix.basename(absolute)
      const stats = await entryStats(`${fdPath(directory)}/${name}`)
      verifyEntry(stats, name)
      if (stats.isDirectory()) {
        const child = await openDirectoryChild(directory, name)
        try {
          await list(child, absolute, parts, 1)
        }
        finally {
          await child.close()
        }
      }
      else {
        appendFile(stats, parts)
      }
    },
  )
  return files
}

async function selectedOutput(job: Job, client: UsenetClient) {
  if (!job.storage || !(await checkUsenetInbox(client.localRoot)))
    throw new UsenetError('path_unreadable')
  const parts = storageParts(
    client.remoteRoot,
    job.storage,
    sabAttemptName(job.id),
  )
  const entries = await outputFiles(client.localRoot, parts)
  const video = chooseUsenetVideo(job, entries)
  const selected = entries.find(entry => entry.path === video.path)
  if (!selected)
    throw new UsenetError('output_invalid')
  return selected
}

async function planDestination(job: Job, source: SourceFile): Promise<Receipt> {
  const identity = await getTitleIdentity(job.titleId)
  if (!identity || (identity.kind === 'movie') !== (job.episode === 0))
    throw new UsenetError('output_invalid')

  const language
    = getDb()
      .select({ language: profiles.language })
      .from(profiles)
      .orderBy(asc(profiles.position))
      .get()
      ?.language ?? null
  const folder = managedFolder()
  const relPath = videoPath(
    layoutTitleOf(identity, language),
    extensionOf(source.path),
    job.episode ? { season: job.season, episode: job.episode } : undefined,
  )
  const existing = existingTitleFolder(folder.id, job.titleId)
  return {
    folderId: folder.id,
    folderPath: folder.path,
    relPath: existing
      ? [existing, ...relPath.split('/').slice(2)].join('/')
      : relPath,
  }
}

function recordedFolder(receipt: Receipt) {
  const folder = getDb()
    .select()
    .from(libraryFolders)
    .where(eq(libraryFolders.id, receipt.folderId))
    .get()
  if (!folder || folder.path !== receipt.folderPath || isMoveRunning())
    throw new UsenetError('import_conflict')
  return folder
}

function importFolder(receipt: Receipt) {
  const folder = recordedFolder(receipt)
  if (folder.path !== storagePath('library'))
    throw new UsenetError('import_conflict')
  return folder
}

function parseReceipt(raw: string) {
  const parsed = receiptSchema.safeParse(JSON.parse(raw))
  if (!parsed.success)
    throw new UsenetError('import_conflict')
  return parsed.data
}

function stagePath(directory: FileHandle, jobId: string) {
  return `${fdPath(directory)}/.torsher-usenet-${jobId}.torsher-tmp`
}

/**
 * A receipt without an identity cannot have published anything. With an
 * identity, the only proof safe for release is the exact staged inode still
 * owning only its staging name and not the final name.
 */
export async function releaseUnpublishedImport<T>(job: Job, release: () => T) {
  const receipt = job.receipt && parseReceipt(job.receipt)
  if (!receipt || !receipt.identity)
    return release()

  const identity = receipt.identity
  return await withMaintenanceLease(
    { titleId: job.titleId, producer: true },
    async () => {
      const folder = recordedFolder(receipt)
      const path = libraryPath(folder, receipt.relPath)
      return await withPinnedDirectory(
        posix.dirname(path),
        false,
        async (directory) => {
          const final = await entryStats(
            `${fdPath(directory)}/${posix.basename(path)}`,
          )
          const temporary = stagePath(directory, job.id)
          const stage = await entryStats(temporary)
          if (
            (final?.ino.toString() === identity.inode
              && final.dev.toString() === identity.device)
            || !stage
            || !sameFile(stage, identity)
            || stage.nlink !== 1n
          ) {
            throw new UsenetError('review_required')
          }
          await assertPinnedPath(directory, posix.dirname(path))
          recordedFolder(receipt)
          const result = release()
          const current = await entryStats(temporary).catch(() => undefined)
          if (current && sameFile(current, identity) && current.nlink === 1n) {
            await unlink(temporary).catch(() => {})
            await directory.sync().catch(() => {})
          }
          return result
        },
      )
    },
  )
}

function recordReceipt(jobId: string, receipt: Receipt) {
  durableMaintenance(() => {
    const { changes } = getDb()
      .update(usenetJobs)
      .set({ receipt: JSON.stringify(receipt), updatedAt: new Date() })
      .where(and(eq(usenetJobs.id, jobId), eq(usenetJobs.state, 'importing')))
      .run()
    if (changes !== 1)
      throw new UsenetError('import_conflict')
  })
}

function existingImport(job: Job, folder: LibraryFolder, relPath: string) {
  const file = getDb()
    .select()
    .from(mediaFiles)
    .where(
      and(eq(mediaFiles.folderId, folder.id), eq(mediaFiles.relPath, relPath)),
    )
    .get()
  if (!file)
    return undefined
  if (
    file.state !== 'missing'
    || file.titleId !== job.titleId
    || file.season !== job.season
    || file.episode !== job.episode
    || file.episodeTo !== null
    || file.torrentId !== null
    || file.fileIndex !== null
    || file.replacementTorrentId !== null
    || file.replacementFileIndex !== null
  ) {
    throw new UsenetError('import_conflict')
  }

  const prior = getDb()
    .select({ id: usenetJobs.id })
    .from(usenetJobs)
    .where(
      and(
        eq(usenetJobs.mediaFileId, file.id),
        eq(usenetJobs.state, 'imported'),
        eq(usenetJobs.titleId, job.titleId),
        eq(usenetJobs.season, job.season),
        eq(usenetJobs.episode, job.episode),
      ),
    )
    .get()
  if (!prior)
    throw new UsenetError('import_conflict')

  return file
}

function register(
  job: Job,
  folder: LibraryFolder,
  receipt: Receipt,
  stats: BigIntStats,
) {
  const inode = Number(stats.ino)
  return durableMaintenance(() =>
    getDb().transaction((tx) => {
      const existing = existingImport(job, folder, receipt.relPath)
      const values = {
        folderId: folder.id,
        relPath: receipt.relPath,
        size: Number(stats.size),
        mtime: new Date(Number(stats.mtimeMs)),
        inode: Number.isSafeInteger(inode) ? inode : null,
        titleId: job.titleId,
        season: job.season,
        episode: job.episode,
        linkMode: 'copy' as const,
        matchStatus: 'matched' as const,
        matchSource: 'name_id' as const,
      }
      const file = existing
        ? tx
            .update(mediaFiles)
            .set({
              ...values,
              state: 'present',
              missingSince: null,
              stale: false,
              probe: null,
              duration: null,
              probedAt: null,
              probeKey: null,
              thumb: null,
              thumbKey: null,
              thumbAttemptKey: null,
            })
            .where(eq(mediaFiles.id, existing.id))
            .returning({ id: mediaFiles.id })
            .get()
        : tx
            .insert(mediaFiles)
            .values(values)
            .returning({ id: mediaFiles.id })
            .get()
      const { id } = file
      const result = tx
        .update(usenetJobs)
        .set({
          state: 'imported',
          active: false,
          mediaFileId: id,
          storage: null,
          problem: null,
          progress: 1,
          updatedAt: new Date(),
        })
        .where(
          and(eq(usenetJobs.id, job.id), eq(usenetJobs.state, 'importing')),
        )
        .run()
      if (result.changes !== 1)
        throw new UsenetError('import_conflict')
      recordUsenetFollow(job, 'downloaded')
      return id
    }),
  )
}

async function copyOutput(
  client: UsenetClient,
  source: ObservedFile,
  temporary: string,
  signal?: AbortSignal,
) {
  const path = posix.join(client.localRoot, source.path)
  await withPinnedDirectory(posix.dirname(path), false, async (parent) => {
    const from = `${fdPath(parent)}/${posix.basename(path)}`
    const listed = await entryStats(from)
    if (!listed?.isFile() || listed.nlink !== 1n)
      throw new UsenetError('output_invalid')

    const input = await open(from, READ_FILE_FLAGS)
    try {
      const prior = await input.stat({ bigint: true })
      await assertPinnedPath(input, path)
      if (
        !sameFile(prior, source.identity)
        || prior.nlink !== 1n
        || prior.ctimeNs !== source.changed
      ) {
        throw new UsenetError('output_invalid')
      }
      const target = await open(
        temporary,
        constants.O_CREAT
        | constants.O_EXCL
        | constants.O_WRONLY
        | constants.O_NOFOLLOW,
        0o644,
      )
      try {
        const buffer = Buffer.allocUnsafe(1024 * 1024)
        const expectedSize = Number(prior.size)
        if (!Number.isSafeInteger(expectedSize))
          throw new UsenetError('output_invalid')
        let position = 0
        while (position < expectedSize) {
          signal?.throwIfAborted()
          const count = Math.min(buffer.length, expectedSize - position)
          const { bytesRead } = await input.read(buffer, 0, count, position)
          if (!bytesRead)
            throw new UsenetError('output_invalid')
          let written = 0
          while (written < bytesRead) {
            const { bytesWritten } = await target.write(
              buffer,
              written,
              bytesRead - written,
              position + written,
            )
            if (!bytesWritten)
              throw new UsenetError('import_failed')
            written += bytesWritten
          }
          position += bytesRead
        }
        const after = await input.stat({ bigint: true })
        if (
          !sameFile(after, fileIdentity(prior))
          || after.ctimeNs !== prior.ctimeNs
          || (await target.stat({ bigint: true })).size !== prior.size
        ) {
          throw new UsenetError('output_invalid')
        }
        await assertPinnedPath(input, path)
        await target.sync()
      }
      finally {
        await target.close()
      }
    }
    finally {
      await input.close()
    }
  })
}

async function ownedTemp(path: string, identity?: FileIdentity) {
  const current = await entryStats(path)
  if (!current)
    return false
  if (
    !current.isFile()
    || (identity && !sameFile(current, identity))
    || (!identity && current.nlink !== 1n)
  ) {
    throw new UsenetError('import_conflict')
  }
  return true
}

export const importDeps = { queueProbe, diskUsage }

export async function importUsenet(
  job: Job,
  client: UsenetClient,
  assertCurrent: () => void,
  signal?: AbortSignal,
) {
  return await withMaintenanceLease(
    { titleId: job.titleId, producer: true },
    async () => {
      assertCurrent()
      if (isMoveRunning())
        throw new UsenetError('not_ready')

      let source: ObservedFile | undefined
      let receipt: Receipt
      if (!job.receipt) {
        source = await selectedOutput(job, client)
        receipt = await planDestination(job, source)
      }
      else {
        receipt = parseReceipt(job.receipt)
      }

      const folder = importFolder(receipt)
      const path = libraryPath(folder, receipt.relPath)
      const parent = posix.dirname(path)
      const id = await withPinnedDirectory(parent, true, async (directory) => {
        const final = `${fdPath(directory)}/${posix.basename(path)}`
        const temporary = stagePath(directory, job.id)
        const prior = await entryStats(final)
        existingImport(job, folder, receipt.relPath)

        if (prior && (!receipt.identity || !sameFile(prior, receipt.identity)))
          throw new UsenetError('import_conflict')

        if (!job.receipt) {
          importFolder(receipt)
          assertCurrent()
          recordReceipt(job.id, receipt)
        }

        if (!prior) {
          if (!receipt.identity) {
            if (await ownedTemp(temporary))
              await unlink(temporary)
            source ??= await selectedOutput(job, client)
            const usage = await importDeps.diskUsage(fdPath(directory))
            if (usage.free < source.size)
              throw new UsenetError('insufficient_space')

            try {
              await copyOutput(client, source, temporary, signal)
              receipt.identity = fileIdentity((await entryStats(temporary))!)
            }
            catch (error) {
              if (
                (error as NodeJS.ErrnoException).code !== 'EEXIST'
                && (await ownedTemp(temporary))
              ) {
                await unlink(temporary)
              }
              throw error
            }
            await directory.sync()
            assertCurrent()
            recordReceipt(job.id, receipt)
          }

          if (!(await ownedTemp(temporary, receipt.identity)))
            throw new UsenetError('import_conflict')
          await assertPinnedPath(directory, parent)
          importFolder(receipt)
          assertCurrent()
          // Atomic and fails if a different writer has claimed the name.
          await link(temporary, final)
          await directory.sync()
        }

        const identity = receipt.identity
        const published = await entryStats(final)
        if (!published || !identity || !sameFile(published, identity))
          throw new UsenetError('import_conflict')

        if (await ownedTemp(temporary, identity))
          await unlink(temporary)
        await directory.sync()
        const placed = await entryStats(final)
        if (!placed || !sameFile(placed, identity))
          throw new UsenetError('import_conflict')
        await assertPinnedPath(directory, parent)
        importFolder(receipt)
        assertCurrent()
        return register(job, folder, receipt, placed)
      })
      void importDeps.queueProbe(id, { revisionChanged: true })
    },
  )
}
