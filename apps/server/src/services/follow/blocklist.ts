import type { BlocklistReason } from '../../db/schema.ts'
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { releaseBlocklist } from '../../db/schema.ts'

const DAY_MS = 24 * 60 * 60 * 1000
// Зависшая раздача может ожить: пиры приходят и уходят. Ручной запрет и
// раздача без нужных серий в файлах — навсегда: список файлов не меняется
const EXPIRES_DAYS: Record<BlocklistReason, number | null> = {
  stalled: 7,
  user: null,
  failed_check: null,
}

export interface BlocklistEntry {
  titleId: string
  infoHash: string
  releaseTitle: string
  reason: BlocklistReason
  detailsUrl?: string
}

export function blockRelease(entry: BlocklistEntry, now = new Date()) {
  const days = EXPIRES_DAYS[entry.reason]

  return getDb()
    .insert(releaseBlocklist)
    .values({
      titleId: entry.titleId,
      infoHash: entry.infoHash.toLowerCase(),
      detailsUrl: entry.detailsUrl ?? null,
      releaseTitle: entry.releaseTitle,
      reason: entry.reason,
      createdAt: now,
      expiresAt: days === null ? null : new Date(now.getTime() + days * DAY_MS),
    })
    .returning()
    .get()
}

function active(now: Date) {
  return or(
    isNull(releaseBlocklist.expiresAt),
    gt(releaseBlocklist.expiresAt, now),
  )
}

/** Infohash раздач, которые автоматика сейчас не берёт; нижний регистр */
export function blockedHashes(now = new Date()) {
  return new Set(
    getDb()
      .select({ infoHash: releaseBlocklist.infoHash })
      .from(releaseBlocklist)
      .where(active(now))
      .all()
      .map(row => row.infoHash),
  )
}

export function isBlocked(infoHash: string, now = new Date()) {
  return !!getDb()
    .select({ id: releaseBlocklist.id })
    .from(releaseBlocklist)
    .where(
      and(eq(releaseBlocklist.infoHash, infoHash.toLowerCase()), active(now)),
    )
    .get()
}

/** Действующие записи, свежие сверху */
export function listBlocklist(now = new Date()) {
  return getDb()
    .select()
    .from(releaseBlocklist)
    .where(active(now))
    .orderBy(desc(releaseBlocklist.createdAt))
    .all()
}

/** «Убрать из списка» */
export function unblockRelease(id: string) {
  return (
    getDb().delete(releaseBlocklist).where(eq(releaseBlocklist.id, id)).run().changes > 0
  )
}

/** Истёкшие записи больше не нужны */
export function purgeBlocklist(now = new Date()) {
  getDb()
    .delete(releaseBlocklist)
    .where(lte(releaseBlocklist.expiresAt, now))
    .run()
}
