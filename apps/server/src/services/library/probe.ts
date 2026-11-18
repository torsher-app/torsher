import { queueAnalysis } from '../segments/index.ts'
import { stat } from 'node:fs/promises'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { libraries, libraryFolders, mediaFiles } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { probeMedia } from '../media/probe.ts'
import { mediaTools } from '../media/tools.ts'
import { absolutePathOf, getMediaFile } from './files.ts'
import { applyHomeFields } from './homeVideo.ts'
import {
  freezeLibraryProgress,
  libraryProbeKey,
  libraryRevisionMatches,
  persistedProbeKey,
  sameStoredMtime,
  storedProbeMatches,
} from './playedSource.ts'
import { ensureThumb } from './thumbs.ts'
import { automaticThumbnails } from './thumbnailSettings.ts'

const queue = new Map<string, boolean>()
let currentId: string | undefined
let currentForce = false
let thumbnailStarted = false
let regeneration = { running: false, total: 0, completed: 0, generated: 0 }
const forced = new Set<string>()

export function thumbnailStatus() {
  return { automatic: automaticThumbnails(), ...regeneration }
}

export function regenerateThumbnails() {
  if (regeneration.running)
    return thumbnailStatus()
  const rows = getDb()
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(eq(mediaFiles.state, 'present'))
    .all()
  regeneration = {
    running: rows.length > 0,
    total: rows.length,
    completed: 0,
    generated: 0,
  }
  for (const { id } of rows) forced.add(id)
  for (const { id } of rows) void queueProbe(id, { forceThumb: true })
  return thumbnailStatus()
}
let draining: Promise<void> | undefined

async function probeOne(id: string) {
  const found = getDb()
    .select({ file: mediaFiles, folder: libraryFolders, kind: libraries.kind })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(mediaFiles.id, id))
    .get()

  if (found?.file.state !== 'present')
    return

  const { file } = found
  const path = absolutePathOf(found.folder, file)
  const info = await stat(path)
  if (
    !info.isFile()
    || (file.inode !== null && file.inode !== info.ino)
    || file.size !== info.size
    || !sameStoredMtime(file.mtime, info.mtimeMs)
    || storedProbeMatches(file, info)
  ) {
    return
  }

  const cacheKey = libraryProbeKey(id, info)
  const confirmRevision = () => libraryRevisionMatches(path, id, cacheKey)
  const media = await probeMedia(cacheKey, path, path, confirmRevision)
  if (!(await confirmRevision()))
    return

  const updated = getDb().transaction((tx) => {
    const latest = getMediaFile(id)
    if (
      latest?.path !== path
      || latest.file.inode !== file.inode
      || latest.file.size !== file.size
      || latest.file.mtime.getTime() !== file.mtime.getTime()
      || latest.file.probeKey !== file.probeKey
    ) {
      return
    }
    if (file.inode === null || file.probeKey)
      freezeLibraryProgress(id, file)
    return tx
      .update(mediaFiles)
      .set({
        inode: info.ino,
        probe: media,
        duration: media.duration,
        probedAt: new Date(),
        probeKey: persistedProbeKey(info),
      })
      .where(eq(mediaFiles.id, id))
      .returning()
      .get()
  })

  // Домашнее видео: дата съёмки из тегов точнее имени и времени файла
  if (found.kind === 'home' && updated)
    applyHomeFields(updated)
}

async function drain() {
  const available = (await mediaTools()).status === 'ok'
  while (queue.size) {
    const [id, force] = queue.entries().next().value!
    queue.delete(id)
    currentId = id
    currentForce = force
    thumbnailStarted = false
    let generated = false
    try {
      if (available) {
        try {
          await probeOne(id)
        }
        catch (err) {
          logFor('storage').warn(
            { err, mediaFileId: id },
            'Library probe failed',
          )
        }
        const found = getMediaFile(id)
        if (
          found
          && found.folder.status === 'ok'
          && (currentForce || automaticThumbnails())
        ) {
          thumbnailStarted = true
          generated = await ensureThumb(found.file, found.path, currentForce)
        }
      }
    }
    catch (err) {
      logFor('storage').warn(
        { err, mediaFileId: id },
        'Library thumbnail failed',
      )
    }
    finally {
      if (!queue.get(id) && forced.delete(id)) {
        regeneration.completed++
        if (generated)
          regeneration.generated++
        regeneration.running = forced.size > 0
      }
      queueAnalysis(id)
      currentId = undefined
    }
  }
}

/** Probe and thumbnail work share one serial worker. Force is never downgraded. */
export function queueProbe(
  id: string,
  options: { forceThumb?: boolean, revisionChanged?: boolean } = {},
) {
  if (currentId === id) {
    if (options.revisionChanged) {
      queue.set(id, !!options.forceThumb || !!queue.get(id))
    }
    else if (thumbnailStarted) {
      if (!options.forceThumb || !currentForce)
        queue.set(id, !!options.forceThumb || !!queue.get(id))
    }
    else {
      currentForce ||= !!options.forceThumb
    }
  }
  else {
    queue.set(id, !!options.forceThumb || !!queue.get(id))
  }
  return startDrain()
}

function startDrain(): Promise<void> {
  draining ??= drain().finally(() => {
    draining = undefined

    // Файл встал в очередь, пока проход заканчивался
    if (queue.size)
      void startDrain()
  })

  return draining
}

/** Проверить пробы и кадры, включая восстановленную базу без JPEG-кэша. */
export function queueUnprobed() {
  const rows = getDb()
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(eq(mediaFiles.state, 'present'))
    .all()

  for (const row of rows) void queueProbe(row.id)
}
