import type { Torrent } from '../../db/schema.ts'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { EngineError, forgetTorrent, pauseTorrent } from '../engine/index.ts'
import { storagePath, torrentDir } from '../storage/paths.ts'
import { deleteTorrent, liveTorrents } from './index.ts'

function isInside(base: string, path: string) {
  const rel = relative(base, path)

  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

async function hasBytes(path: string) {
  const info = await stat(path).catch(() => undefined)

  return Boolean(info?.isFile() && info.size > 0)
}

/**
 * Есть ли на диске хоть что-то от раздачи: непустой файл в каталоге с
 * именем раздачи (так кладёт движок) или прямо в каталоге загрузок (прежние
 * версии). Пустые каталоги не в счёт: движок создаёт их и на пустой точке
 * монтирования. Прогресс движка не годится: после восстановления он и база
 * расходятся.
 */
async function hasData(torrent: Torrent, base: string) {
  for (const file of torrent.files ?? []) {
    if (file.padding)
      continue

    const parts = file.path.split('/')

    for (const path of [
      resolve(base, torrent.name, ...parts),
      resolve(base, ...parts),
    ]) {
      if (isInside(base, path) && (await hasBytes(path)))
        return true
    }
  }

  return false
}

async function ignoreNotFound(action: Promise<unknown>) {
  try {
    await action
  }
  catch (err) {
    if (!(err instanceof EngineError) || err.kind !== 'not_found')
      throw err
  }
}

export interface ReconcileCounts {
  removedFromEngine: number
  deleted: number
  paused: number
}

export type ReconcileResult
  = | ({ skipped?: undefined } & ReconcileCounts)
    | { skipped: 'downloads_unavailable' }

async function dirReadable(base: string) {
  try {
    await access(base, constants.R_OK | constants.X_OK)

    return (await stat(base)).isDirectory()
  }
  catch {
    return false
  }
}

/**
 * Готовые раздачи без данных — только в каталогах, которым можно верить:
 * каталог читается и хоть у одной его раздачи данные на месте. Иначе на
 * месте диска пустая точка монтирования, и отсутствие файлов ничего не
 * значит. `null` — ни одному каталогу верить нельзя.
 */
async function missingData(rows: Torrent[]) {
  const byDir = new Map<string, Torrent[]>()

  for (const row of rows) {
    if (row.status !== 'ready')
      continue

    const dir = resolve(torrentDir(row))

    byDir.set(dir, [...(byDir.get(dir) ?? []), row])
  }

  const missing: Torrent[] = []
  let trusted = 0

  for (const [dir, group] of byDir) {
    if (!(await dirReadable(dir)))
      continue

    const gone: Torrent[] = []

    for (const row of group) {
      if (!(await hasData(row, dir)))
        gone.push(row)
    }

    if (gone.length === group.length)
      continue

    trusted++
    missing.push(...gone)
  }

  return byDir.size > 0 && trusted === 0 ? null : missing
}

/**
 * Сверка движка с восстановленной базой. Раздачи, добавленные после копии,
 * снимаются с движка без удаления файлов. Раздачи базы без данных на диске:
 * кэш удаляется из базы, закреплённые встают на паузу владельца — иначе
 * сервер молча начал бы перекачивать всё закреплённое. Пауза `storage` не
 * подходит: её сервер снимает сам, когда место есть. Раздачи в каталоге,
 * который недоступен (диск не смонтирован), не трогаются: удалять по
 * отсутствию файлов нельзя. Ни одного доступного каталога — сверки нет.
 */
export async function reconcileTorrentsAfterRestore(): Promise<ReconcileResult> {
  const rows = getDb().select().from(torrents).all()
  const missing = await missingData(rows)

  if (
    !missing
    || (!rows.some(row => row.status === 'ready')
      && !(await dirReadable(resolve(storagePath('downloads')))))
  ) {
    return { skipped: 'downloads_unavailable' }
  }

  const counts: ReconcileCounts = {
    removedFromEngine: 0,
    deleted: 0,
    paused: 0,
  }
  const live = await liveTorrents()
  const known = new Set(rows.map(row => row.infoHash))

  for (const hash of live.keys()) {
    if (known.has(hash))
      continue

    await ignoreNotFound(forgetTorrent(hash))
    counts.removedFromEngine++
  }

  for (const row of missing) {
    const inEngine = live.has(row.infoHash)

    if (row.retention === 'cache') {
      await deleteTorrent({ ...row, inEngine })
      counts.deleted++
      continue
    }

    if (!inEngine)
      continue

    await ignoreNotFound(pauseTorrent(row.infoHash))
    getDb()
      .update(torrents)
      .set({ pauseReason: 'user', inEngine: true })
      .where(eq(torrents.id, row.id))
      .run()
    counts.paused++
  }

  return counts
}
