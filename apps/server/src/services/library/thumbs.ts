import type { Buffer } from 'node:buffer'
import type { MediaFile } from '../../db/schema.ts'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  mkdir,
  readdir,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { basename, join } from 'node:path'
import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { libraryFolders, mediaFiles } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { untrustedInputArgs } from '../media/inputSafety.ts'

export function thumbPathOf(name: string) {
  return join(config.dataDir, 'thumbs', basename(name))
}

const uuidPattern
  = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}'
const cacheName = new RegExp(
  `^${uuidPattern}(?:-${uuidPattern})?\\.jpg(?:\\.tmp\\.jpg)?$`,
  'i',
)

/** Only generated cache names; unlink never follows a file symlink. */
export async function removeThumbs(names: (string | null)[]) {
  for (const name of new Set(names)) {
    if (!name || !cacheName.test(name))
      continue
    try {
      await unlink(thumbPathOf(name))
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        logFor('storage').warn(
          { err, name },
          'Library thumbnail cleanup failed',
        )
      }
    }
  }
}

/** Startup only, before thumbnail workers: retain even missing media rows. */
export async function cleanupOrphanThumbs() {
  const referenced = new Set(
    getDb()
      .select({ thumb: mediaFiles.thumb })
      .from(mediaFiles)
      .where(isNotNull(mediaFiles.thumb))
      .all()
      .map(row => row.thumb),
  )
  try {
    const entries = await readdir(join(config.dataDir, 'thumbs'), {
      withFileTypes: true,
    })
    await removeThumbs(
      entries
        .filter(
          entry =>
            (entry.isFile() || entry.isSymbolicLink())
            && !referenced.has(entry.name),
        )
        .map(entry => entry.name),
    )
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      logFor('storage').warn({ err }, 'Library thumbnail cache cleanup failed')
  }
}

export function thumbUrl(file: Pick<MediaFile, 'id' | 'thumb'>) {
  return file.thumb
    ? `/api/library/files/${file.id}/thumb?v=${encodeURIComponent(file.thumb)}`
    : undefined
}

export async function cachedThumb(file: MediaFile) {
  if (!file.thumb)
    return undefined
  const path = thumbPathOf(file.thumb)
  return await stat(path).then(
    info => (info.isFile() ? path : undefined),
    () => undefined,
  )
}

export function thumbArgs(
  source: string,
  target: string,
  duration: number | null,
) {
  const at
    = duration && duration > 0
      ? Math.min(Math.max(1, duration * 0.1), duration * 0.5)
      : 0
  return [
    '-v',
    'error',
    '-ss',
    at.toFixed(2),
    ...untrustedInputArgs(source),
    '-threads',
    '1',
    '-i',
    source,
    '-threads',
    '1',
    '-frames:v',
    '1',
    '-vf',
    'scale=640:-2,thumbnail=30',
    '-q:v',
    '4',
    '-c:v',
    'mjpeg',
    '-f',
    'image2pipe',
    '-y',
    target,
  ]
}

function render(source: string, duration: number | null) {
  return new Promise<Buffer>((resolve, reject) => {
    execFile(
      config.ffmpegPath,
      thumbArgs(source, 'pipe:1', duration),
      { timeout: 60_000, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout)),
    )
  })
}

/** Called only by the serial library worker. An old frame survives a failed replacement. */
export async function ensureThumb(
  file: MediaFile,
  source: string,
  force = false,
) {
  const before = await stat(source).catch(() => undefined)
  if (!before?.isFile())
    return false
  const key = `${before.size}:${Math.trunc(before.mtimeMs)}`
  if (
    !force
    && (file.thumbAttemptKey === key
      || (file.thumbKey === key && (await cachedThumb(file))))
  ) {
    return false
  }
  const folder = getDb()
    .select({ path: libraryFolders.path })
    .from(libraryFolders)
    .where(eq(libraryFolders.id, file.folderId))
    .get()
  if (!folder || join(folder.path, file.relPath) !== source)
    return false
  const snapshot = and(
    eq(mediaFiles.id, file.id),
    eq(mediaFiles.state, 'present'),
    eq(mediaFiles.folderId, file.folderId),
    eq(mediaFiles.relPath, file.relPath),
    eq(mediaFiles.size, file.size),
    eq(mediaFiles.mtime, file.mtime),
    file.thumb === null
      ? isNull(mediaFiles.thumb)
      : eq(mediaFiles.thumb, file.thumb),
    sql`exists (
      select 1 from ${libraryFolders}
      where ${libraryFolders.id} = ${mediaFiles.folderId}
        and ${libraryFolders.path} = ${folder.path}
    )`,
  )
  const name = `${file.id}-${randomUUID()}.jpg`
  const target = thumbPathOf(name)
  const temporary = `${target}.tmp.jpg`
  const unchanged = async () => {
    const after = await stat(source).catch(() => undefined)
    const current = getDb()
      .select({ file: mediaFiles, folder: libraryFolders })
      .from(mediaFiles)
      .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
      .where(eq(mediaFiles.id, file.id))
      .get()
    return (
      !!after
      && after.size === before.size
      && after.mtimeMs === before.mtimeMs
      && !!current
      && current.file.state === 'present'
      && current.file.size === file.size
      && current.file.mtime.getTime() === file.mtime.getTime()
      && current.file.relPath === file.relPath
      && join(current.folder.path, current.file.relPath) === source
    )
  }
  try {
    await mkdir(join(config.dataDir, 'thumbs'), { recursive: true })
    await access(source, constants.R_OK)
    await access(join(config.dataDir, 'thumbs'), constants.W_OK)
    // Keep output storage errors separate from decoder exit codes. The buffer is bounded.
    const jpeg = await render(source, file.duration)
    if (!jpeg.length)
      throw new Error('FFmpeg produced no frame')
    await writeFile(temporary, jpeg)
    if (!(await unchanged()))
      return false
    await rename(temporary, target)
    // No await between rechecking the DB snapshot and publishing its new pointer.
    if (!(await unchanged())) {
      await unlink(target).catch(() => {})
      return false
    }
    const published = getDb()
      .update(mediaFiles)
      .set({ thumb: name, thumbKey: key, thumbAttemptKey: null })
      .where(snapshot)
      .returning({ id: mediaFiles.id })
      .get()
    if (!published) {
      await unlink(target).catch(() => {})
      return false
    }
    if (file.thumb)
      await removeThumbs([file.thumb])
    return true
  }
  catch (err) {
    // Missing executable, inaccessible storage and disappeared inputs are retryable.
    if (
      typeof (err as NodeJS.ErrnoException).code === 'number'
      && (await unchanged())
    ) {
      getDb()
        .update(mediaFiles)
        .set({ thumbAttemptKey: key })
        .where(snapshot)
        .run()
    }
    logFor('storage').debug(
      { err, mediaFileId: file.id },
      'Library thumbnail failed',
    )
    return false
  }
  finally {
    await unlink(temporary).catch(() => {})
  }
}
