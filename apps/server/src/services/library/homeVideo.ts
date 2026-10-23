import type { MediaFile } from '../../db/schema.ts'
import { eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles } from '../../db/schema.ts'

// Заведомо ложные даты: ноль QuickTime (1904), ноль Unix, сброшенные часы камеры
const EARLIEST = Date.UTC(1971, 0, 1)
const RESET_DATES = new Set([Date.UTC(2000, 0, 1)])
const FUTURE_SLACK_MS = 24 * 60 * 60 * 1000

/**
 * Дата съёмки хранится «как на часах камеры»: компоненты даты и времени в UTC
 * без пересчёта зоны (как `keepLocalTime` у Immich). Витрина показывает её в UTC
 */
function wallClock(y: number, mo: number, d: number, h = 0, mi = 0, s = 0) {
  const at = Date.UTC(y, mo - 1, d, h, mi, s)
  const check = new Date(at)

  // 2023-02-31 и подобное — не дата
  return check.getUTCFullYear() === y
    && check.getUTCMonth() === mo - 1
    && check.getUTCDate() === d
    ? at
    : undefined
}

function plausible(at: number | undefined) {
  return (
    at !== undefined
    && at >= EARLIEST
    && !RESET_DATES.has(at)
    && at <= Date.now() + FUTURE_SLACK_MS
  )
}

/**
 * Тег ffprobe: `2023-07-14T15:30:12+0300` (QuickTime с зоной),
 * `2023-07-14T12:30:12.000000Z` (`creation_time`), `2023:07:14 15:30:12`
 */
export function parseTagDate(value: string | null | undefined) {
  const match
    = /^(\d{4})[-:](\d{2})[-:](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(
      value?.trim() ?? '',
    )

  if (!match)
    return undefined

  const [, y, mo, d, h, mi, s] = match.map(Number) as number[]
  const at = wallClock(y!, mo!, d!, h, mi, s || 0)

  return plausible(at) ? at : undefined
}

// Имена камер, телефонов и мессенджеров: дата и время съёмки в имени файла
const NAME_PATTERNS: RegExp[] = [
  // VID_20230714_153012, PXL_20230714_153012345, IMG_20230714_153012, 20230714_153012
  /(?:^|\D)(\d{4})(\d{2})(\d{2})[_-](\d{2})(\d{2})(\d{2})/,
  // DJI_20230714153012_0001
  /(?:^|\D)(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\D|$)/,
  // WhatsApp Video 2023-07-14 at 15.30.12, Screen Recording 2023-07-14 at 15.30.12, 2023-07-14 15.30.12
  /(\d{4})-(\d{2})-(\d{2})(?: at |[ _])(\d{2})[.:-](\d{2})[.:-](\d{2})/,
  // VID-20230714-WA0001 (WhatsApp на Android): только дата
  /(?:VID|IMG)-(\d{4})(\d{2})(\d{2})-WA\d+/i,
]

export function parseNameDate(name: string) {
  for (const pattern of NAME_PATTERNS) {
    const match = pattern.exec(name)

    if (!match)
      continue

    const [, y, mo, d, h, mi, s] = match.map(Number) as number[]
    const at = wallClock(y!, mo!, d!, h || 0, mi || 0, s || 0)

    if (plausible(at))
      return at
  }

  return undefined
}

/** Дата съёмки: теги файла → имя → время изменения файла */
export function capturedOf(
  created: string | null | undefined,
  name: string,
  mtime: Date,
): { at: Date, source: NonNullable<MediaFile['capturedAtSource']> } {
  const tagged = parseTagDate(created)

  if (tagged !== undefined)
    return { at: new Date(tagged), source: 'tags' }

  const named = parseNameDate(name)

  if (named !== undefined)
    return { at: new Date(named), source: 'name' }

  // Время изменения — в зоне сервера; переводим в «часы камеры» тем же способом
  const local = mtime
  const at = Date.UTC(
    local.getFullYear(),
    local.getMonth(),
    local.getDate(),
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
  )

  return { at: new Date(at), source: 'file' }
}

/** Альбом — ближайшая папка с видео, путь от корня; файл в корне — без альбома */
export function albumOf(relPath: string) {
  const slash = relPath.lastIndexOf('/')

  return slash > 0 ? relPath.slice(0, slash) : ''
}

/**
 * Дата и альбом файла домашнего видео: при скане (по имени и `mtime`) и после
 * пробы (по тегам). Дату, исправленную владельцем, не трогаем
 */
export function applyHomeFields(file: MediaFile) {
  const values: Partial<MediaFile> = { album: albumOf(file.relPath) }

  if (file.capturedAtSource !== 'user') {
    const name = file.relPath.slice(file.relPath.lastIndexOf('/') + 1)
    const captured = capturedOf(file.probe?.created, name, file.mtime)

    values.capturedAt = captured.at
    values.capturedAtSource = captured.source
  }

  getDb()
    .update(mediaFiles)
    .set(values)
    .where(eq(mediaFiles.id, file.id))
    .run()
}

/** Новые и изменённые файлы домашнего видео после скана: дата по имени и времени файла */
export function applyHomeVideoFields(ids: string[]) {
  if (!ids.length)
    return

  for (const file of getDb()
    .select()
    .from(mediaFiles)
    .where(inArray(mediaFiles.id, ids))
    .all())
    applyHomeFields(file)
}

/** Дата, исправленная владельцем в панели; `null` — вернуть автоматическую */
export function setCapturedAt(file: MediaFile, at: Date | null) {
  if (at) {
    getDb()
      .update(mediaFiles)
      .set({ capturedAt: at, capturedAtSource: 'user' })
      .where(eq(mediaFiles.id, file.id))
      .run()
    return
  }

  applyHomeFields({ ...file, capturedAtSource: null })
}
