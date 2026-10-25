import type { BlocklistListing, BlocklistReason } from '../../db/schema.ts'
import { and, desc, eq, gt, isNull, lte, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { releaseBlocklist } from '../../db/schema.ts'

export type Listing = BlocklistListing

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
  /** Без него — раздачу без infohash запретили до скачивания `.torrent` */
  infoHash?: string
  releaseTitle: string
  reason: BlocklistReason
  detailsUrl?: string
  /** Только эти серии (`episodeKey`); без них — раздача целиком */
  episodes?: string[]
  /** Как индексаторы показали раздачу без infohash */
  listings?: Listing[]
}

function active(now: Date) {
  return or(
    isNull(releaseBlocklist.expiresAt),
    gt(releaseBlocklist.expiresAt, now),
  )
}

export function listedKey(listing: Listing) {
  return [
    listing.indexerId ?? '',
    listing.page ?? '',
    listing.title,
    listing.size ?? '',
  ].join('\n')
}

/** Показы склеенной раздачи без infohash: страница у каждого индексатора своя */
export function listingsOf(release: {
  title: string
  size?: number
  indexers: { id?: string, detailsUrl?: string }[]
}): Listing[] {
  return release.indexers.map(item => ({
    indexerId: item.id,
    page: item.detailsUrl,
    title: release.title,
    size: release.size,
  }))
}

function mergeListings(current: Listing[] | null, added: Listing[]) {
  const merged = new Map(
    (current ?? []).map(listing => [listedKey(listing), listing]),
  )

  for (const listing of added) merged.set(listedKey(listing), listing)

  return merged.size ? [...merged.values()] : null
}

function laterExpiry(a: Date | null, b: Date | null) {
  if (!a || !b)
    return null

  return a > b ? a : b
}

/**
 * Действующая запись той же раздачи и причины: по infohash, без него — по
 * общему показу
 */
function sameEntry(entry: BlocklistEntry, now: Date) {
  const rows = getDb()
    .select()
    .from(releaseBlocklist)
    .where(
      and(
        eq(releaseBlocklist.reason, entry.reason),
        entry.infoHash
          ? eq(releaseBlocklist.infoHash, entry.infoHash.toLowerCase())
          : and(
              isNull(releaseBlocklist.infoHash),
              eq(releaseBlocklist.titleId, entry.titleId),
            ),
        active(now),
      ),
    )
    .all()

  if (entry.infoHash)
    return rows[0]

  const keys = new Set((entry.listings ?? []).map(listedKey))

  return rows.find(row =>
    row.listings?.some(listing => keys.has(listedKey(listing))),
  )
}

/**
 * Запрет раздачи. Одна раздача и причина — одна запись: повторный запрет
 * сливается с ней (серии, больший срок, показы)
 */
export function blockRelease(entry: BlocklistEntry, now = new Date()) {
  const days = EXPIRES_DAYS[entry.reason]
  const expiresAt
    = days === null ? null : new Date(now.getTime() + days * DAY_MS)
  const episodes = entry.episodes ?? null
  const current
    = entry.infoHash || entry.listings?.length
      ? sameEntry(entry, now)
      : undefined

  if (current) {
    return getDb()
      .update(releaseBlocklist)
      .set({
        episodes:
          current.episodes && episodes
            ? [...new Set([...current.episodes, ...episodes])]
            : null,
        expiresAt: laterExpiry(current.expiresAt, expiresAt),
        listings: mergeListings(current.listings, entry.listings ?? []),
        detailsUrl: current.detailsUrl ?? entry.detailsUrl ?? null,
      })
      .where(eq(releaseBlocklist.id, current.id))
      .returning()
      .get()!
  }

  return getDb()
    .insert(releaseBlocklist)
    .values({
      titleId: entry.titleId,
      infoHash: entry.infoHash?.toLowerCase() ?? null,
      detailsUrl: entry.detailsUrl ?? null,
      releaseTitle: entry.releaseTitle,
      reason: entry.reason,
      episodes,
      listings: mergeListings(null, entry.listings ?? []),
      createdAt: now,
      expiresAt,
    })
    .returning()
    .get()
}

/** Заблокированные серии раздачи (`episodeKey`); `null` — раздача целиком */
export type BlockedEpisodes = Set<string> | null

/** Раздачи, которые автоматика сейчас не берёт */
export interface BlockedReleases {
  /** По infohash в нижнем регистре */
  hashes: Map<string, BlockedEpisodes>
  /** Раздача без infohash — по показу (`listedKey`) */
  listed: Map<string, BlockedEpisodes>
}

function addBlock(
  map: Map<string, BlockedEpisodes>,
  key: string,
  episodes: string[] | null,
) {
  const current = map.get(key)

  if (current === null)
    return

  if (!episodes) {
    map.set(key, null)
    return
  }

  map.set(key, new Set([...(current ?? []), ...episodes]))
}

/**
 * Действующий чёрный список для тайтла: infohash — по всем записям (это сама
 * раздача), показы — только по записям тайтла
 */
export function blockedReleases(
  titleId: string,
  now = new Date(),
): BlockedReleases {
  const blocked: BlockedReleases = {
    hashes: new Map(),
    listed: new Map(),
  }
  const rows = getDb()
    .select({
      titleId: releaseBlocklist.titleId,
      infoHash: releaseBlocklist.infoHash,
      episodes: releaseBlocklist.episodes,
      listings: releaseBlocklist.listings,
    })
    .from(releaseBlocklist)
    .where(active(now))
    .all()

  for (const row of rows) {
    if (row.infoHash)
      addBlock(blocked.hashes, row.infoHash, row.episodes)

    if (row.titleId !== titleId)
      continue

    for (const listing of row.listings ?? [])
      addBlock(blocked.listed, listedKey(listing), row.episodes)
  }

  return blocked
}

/** Что из раздачи в чёрном списке; `undefined` — ничего */
export function blockedPart(
  release: {
    infoHash?: string
    title: string
    size?: number
    indexers: { id?: string, detailsUrl?: string }[]
  },
  blocked: BlockedReleases,
): BlockedEpisodes | undefined {
  if (release.infoHash)
    return blocked.hashes.get(release.infoHash.toLowerCase())

  const parts = listingsOf(release).flatMap((listing) => {
    const part = blocked.listed.get(listedKey(listing))

    return part === undefined ? [] : [part]
  })

  if (!parts.length)
    return undefined

  return parts.includes(null)
    ? null
    : new Set(parts.flatMap(part => [...(part ?? [])]))
}

/**
 * Раздачу без infohash узнали после добавления: её записи запоминают ещё один
 * её показ, и следующий проход узнаёт её до скачивания `.torrent`. Прежние
 * показы остаются: одну раздачу показывают разные индексаторы
 */
export function rememberListing(
  infoHash: string,
  listing: Listing,
  now = new Date(),
) {
  const key = listedKey(listing)
  const rows = getDb()
    .select({ id: releaseBlocklist.id, listings: releaseBlocklist.listings })
    .from(releaseBlocklist)
    .where(
      and(eq(releaseBlocklist.infoHash, infoHash.toLowerCase()), active(now)),
    )
    .all()

  for (const row of rows) {
    if (row.listings?.some(item => listedKey(item) === key))
      continue

    getDb()
      .update(releaseBlocklist)
      .set({ listings: mergeListings(row.listings, [listing]) })
      .where(eq(releaseBlocklist.id, row.id))
      .run()
  }
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
