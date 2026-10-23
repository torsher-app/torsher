import type { MediaFile } from '../../db/schema.ts'
import { execFile } from 'node:child_process'
import { mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { mediaFiles } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'

// Ширина кадра: карточка 16:9 на ТВ — 420 px макета, с запасом на 1080p
const THUMB_WIDTH = 640
const THUMB_TIMEOUT_MS = 60_000
// Кадры делает ffmpeg: не больше двух сразу, чтобы ряд не грузил слабый CPU
const PARALLEL = 2

let active = 0
const waiting: Array<() => void> = []
const inFlight = new Map<string, Promise<string | undefined>>()
// Кадр не получился: до изменения файла не пробуем снова на каждый показ ряда
const failed = new Map<string, number>()

function thumbsDir() {
  return join(config.dataDir, 'thumbs')
}

export function thumbPathOf(id: string) {
  return join(thumbsDir(), `${id}.jpg`)
}

async function slot<T>(work: () => Promise<T>) {
  if (active >= PARALLEL)
    await new Promise<void>(resolve => waiting.push(resolve))

  active++

  try {
    return await work()
  }
  finally {
    active--
    waiting.shift()?.()
  }
}

/**
 * Кадр около 10 % длительности (не раньше 1 с): фильтр `thumbnail` берёт самый
 * типичный кадр пачки, без чёрных; поворот видео с телефона ffmpeg учитывает сам
 */
function render(source: string, target: string, duration: number | null) {
  const at = Math.max(1, (duration ?? 0) * 0.1)

  return new Promise<void>((resolve, reject) => {
    execFile(
      config.ffmpegPath,
      [
        '-v',
        'error',
        '-ss',
        at.toFixed(2),
        '-i',
        source,
        '-frames:v',
        '1',
        '-vf',
        `thumbnail=30,scale=${THUMB_WIDTH}:-2`,
        '-q:v',
        '4',
        '-y',
        target,
      ],
      { timeout: THUMB_TIMEOUT_MS },
      err => (err ? reject(err) : resolve()),
    )
  })
}

/**
 * Кадр-превью файла библиотеки: из кэша в каталоге данных (не рядом с видео —
 * папка пользователя только для чтения), иначе делаем сейчас. `undefined` —
 * кадра нет (файл битый, нет ffmpeg): витрина рисует заглушку
 */
export function ensureThumb(file: MediaFile, source: string) {
  const target = thumbPathOf(file.id)
  const current = inFlight.get(file.id)

  if (current)
    return current

  const task = (async () => {
    const cached = await stat(target).catch(() => undefined)

    // Файл поменялся после кадра — кадр делаем заново
    if (cached && cached.mtimeMs >= file.mtime.getTime())
      return target

    if (failed.get(file.id) === file.mtime.getTime())
      return undefined

    try {
      await mkdir(thumbsDir(), { recursive: true })
      await slot(async () => {
        const temporary = `${target}.tmp.jpg`

        await render(source, temporary, file.duration)
        await rename(temporary, target)
      })
      getDb()
        .update(mediaFiles)
        .set({ thumb: `${file.id}.jpg` })
        .where(eq(mediaFiles.id, file.id))
        .run()

      return target
    }
    catch (err) {
      failed.set(file.id, file.mtime.getTime())
      logFor('storage').debug(
        { err, mediaFileId: file.id },
        'Library thumbnail failed',
      )
      return undefined
    }
  })().finally(() => inFlight.delete(file.id))

  inFlight.set(file.id, task)

  return task
}
