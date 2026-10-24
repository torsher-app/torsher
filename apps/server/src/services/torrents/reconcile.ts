import type { Torrent } from '../../db/schema.ts'
import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { eq } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { torrents } from '../../db/schema.ts'
import { EngineError, forgetTorrent, pauseTorrent } from '../engine/index.ts'
import { deleteTorrent, liveTorrents } from './index.ts'

function isInside(base: string, path: string) {
  const rel = relative(base, path)

  return rel !== '' && !rel.startsWith('..') && !rel.startsWith(sep)
}

async function exists(path: string) {
  return Boolean(await stat(path).catch(() => undefined))
}

/**
 * Есть ли на диске хоть что-то от раздачи: движок кладёт её в каталог с
 * именем раздачи, прежние версии — файлы прямо в каталог загрузок. Прогресс
 * движка не годится: после восстановления он и база расходятся.
 */
async function hasData(torrent: Torrent) {
  const base = resolve(config.downloadsPath)
  const root = resolve(base, torrent.name)

  if (isInside(base, root) && (await exists(root)))
    return true

  for (const file of torrent.files ?? []) {
    if (file.padding)
      continue

    const path = resolve(base, ...file.path.split('/'))

    if (isInside(base, path) && (await exists(path)))
      return true
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

async function downloadsReadable(base: string) {
  try {
    await access(base, constants.R_OK | constants.X_OK)

    return (await stat(base)).isDirectory()
  }
  catch {
    return false
  }
}

/**
 * Сверка движка с восстановленной базой. Раздачи, добавленные после копии,
 * снимаются с движка без удаления файлов. Раздачи базы без данных на диске:
 * кэш удаляется из базы, закреплённые встают на паузу владельца — иначе
 * сервер молча начал бы перекачивать всё закреплённое. Пауза `storage` не
 * подходит: её сервер снимает сам, когда место есть. Каталог загрузок
 * недоступен (диск не смонтирован) — сверки нет: отсутствие файлов ничего
 * не значит, и удалять по нему нельзя.
 */
export async function reconcileTorrentsAfterRestore(): Promise<ReconcileResult> {
  if (!(await downloadsReadable(resolve(config.downloadsPath))))
    return { skipped: 'downloads_unavailable' }

  const counts: ReconcileCounts = {
    removedFromEngine: 0,
    deleted: 0,
    paused: 0,
  }
  const live = await liveTorrents()
  const rows = getDb().select().from(torrents).all()
  const known = new Set(rows.map(row => row.infoHash))

  const missing: Torrent[] = []
  let ready = 0

  for (const row of rows) {
    if (row.status !== 'ready')
      continue

    ready++

    if (!(await hasData(row)))
      missing.push(row)
  }

  // Ни у одной раздачи нет файлов — скорее всего, на месте диска пустая
  // точка монтирования: удалять и ставить на паузу по этому нельзя
  if (ready > 0 && missing.length === ready)
    return { skipped: 'downloads_unavailable' }

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
