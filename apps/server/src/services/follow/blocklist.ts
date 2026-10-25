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
  /** Только эти серии (`episodeKey`); без них — раздача целиком */
  episodes?: string[]
  /** Как индексатор показал раздачу без infohash */
  listing?: { page?: string, title: string }
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
      episodes: entry.episodes ?? null,
      listedPage: entry.listing?.page ?? null,
      listedTitle: entry.listing?.title ?? null,
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

/** Заблокированные серии раздачи (`episodeKey`); `null` — раздача целиком */
export type BlockedEpisodes = Set<string> | null

/** Раздачи, которые автоматика сейчас не берёт */
export interface BlockedReleases {
  /** По infohash в нижнем регистре */
  hashes: Map<string, BlockedEpisodes>
  /** Раздача без infohash — по странице и названию (`listedKey`) */
  listed: Map<string, BlockedEpisodes>
}

export function listedKey(page: string | undefined, title: string) {
  return `${page ?? ''}\n${title}`
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

export function blockedReleases(now = new Date()): BlockedReleases {
  const blocked: BlockedReleases = {
    hashes: new Map(),
    listed: new Map(),
  }
  const rows = getDb()
    .select({
      infoHash: releaseBlocklist.infoHash,
      detailsUrl: releaseBlocklist.detailsUrl,
      releaseTitle: releaseBlocklist.releaseTitle,
      episodes: releaseBlocklist.episodes,
      listedPage: releaseBlocklist.listedPage,
      listedTitle: releaseBlocklist.listedTitle,
    })
    .from(releaseBlocklist)
    .where(active(now))
    .all()

  for (const row of rows) {
    addBlock(blocked.hashes, row.infoHash, row.episodes)

    if (row.listedTitle) {
      addBlock(
        blocked.listed,
        listedKey(row.listedPage ?? undefined, row.listedTitle),
        row.episodes,
      )
    }
  }

  return blocked
}

/** Что из раздачи в чёрном списке; `undefined` — ничего */
export function blockedPart(
  release: { infoHash?: string, title: string, detailsUrls: string[] },
  blocked: BlockedReleases,
): BlockedEpisodes | undefined {
  if (release.infoHash)
    return blocked.hashes.get(release.infoHash.toLowerCase())

  const pages = release.detailsUrls.length ? release.detailsUrls : [undefined]
  const parts = pages.flatMap((page) => {
    const part = blocked.listed.get(listedKey(page, release.title))

    return part === undefined ? [] : [part]
  })

  if (!parts.length)
    return undefined

  return parts.includes(null)
    ? null
    : new Set(parts.flatMap(part => [...(part ?? [])]))
}

/**
 * Раздачу без infohash узнали после добавления: её записи запоминают, как её
 * показал индексатор, и следующий проход узнаёт её до скачивания `.torrent`
 */
export function rememberListing(
  infoHash: string,
  listing: { page?: string, title: string },
  now = new Date(),
) {
  getDb()
    .update(releaseBlocklist)
    .set({ listedPage: listing.page ?? null, listedTitle: listing.title })
    .where(
      and(eq(releaseBlocklist.infoHash, infoHash.toLowerCase()), active(now)),
    )
    .run()
}

/** Раздача в чёрном списке целиком */
export function isBlocked(infoHash: string, now = new Date()) {
  return !!getDb()
    .select({ id: releaseBlocklist.id })
    .from(releaseBlocklist)
    .where(
      and(
        eq(releaseBlocklist.infoHash, infoHash.toLowerCase()),
        isNull(releaseBlocklist.episodes),
        active(now),
      ),
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
