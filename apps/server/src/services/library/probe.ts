import { stat } from 'node:fs/promises'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { libraries, libraryFolders, mediaFiles } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { probeMedia } from '../media/probe.ts'
import { mediaTools } from '../media/tools.ts'
import { absolutePathOf } from './files.ts'
import { applyHomeFields } from './homeVideo.ts'

const queue: string[] = []
let draining: Promise<void> | undefined

async function probeOne(id: string) {
  const found = getDb()
    .select({ file: mediaFiles, folder: libraryFolders, kind: libraries.kind })
    .from(mediaFiles)
    .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
    .innerJoin(libraries, eq(libraries.id, libraryFolders.libraryId))
    .where(eq(mediaFiles.id, id))
    .get()

  if (!found)
    return

  const path = absolutePathOf(found.folder, found.file)
  const info = await stat(path)
  const key = `${info.size}:${info.mtimeMs}`

  if (found.file.probeKey === key)
    return

  const media = await probeMedia(`library:${id}:${key}`, path, path)

  const updated = getDb()
    .update(mediaFiles)
    .set({
      probe: media,
      duration: media.duration,
      probedAt: new Date(),
      probeKey: key,
    })
    .where(eq(mediaFiles.id, id))
    .returning()
    .get()

  // Домашнее видео: дата съёмки из тегов точнее имени и времени файла
  if (found.kind === 'home' && updated)
    applyHomeFields(updated)
}

async function drain() {
  if ((await mediaTools()).status !== 'ok') {
    queue.length = 0
    return
  }

  // По одному файлу: проба целого файла с диска не должна мешать просмотру
  for (let id = queue.shift(); id; id = queue.shift()) {
    try {
      await probeOne(id)
    }
    catch (err) {
      logFor('storage').warn({ err, mediaFileId: id }, 'Library probe failed')
    }
  }
}

/** Ставит файл библиотеки в очередь ffprobe: дорожки и длительность — в базу */
export function queueProbe(id: string) {
  if (!queue.includes(id))
    queue.push(id)

  return startDrain()
}

function startDrain(): Promise<void> {
  draining ??= drain().finally(() => {
    draining = undefined

    // Файл встал в очередь, пока проход заканчивался
    if (queue.length)
      void startDrain()
  })

  return draining
}

/** Файлы, которые ещё не пробовали: после перезапуска очередь в памяти пуста */
export function queueUnprobed() {
  const rows = getDb()
    .select({ id: mediaFiles.id })
    .from(mediaFiles)
    .where(and(isNull(mediaFiles.probedAt), eq(mediaFiles.state, 'present')))
    .all()

  for (const row of rows) void queueProbe(row.id)
}
