import type { Card } from '../../dto/catalog.ts'
import type { HomeMode } from '../../dto/home.ts'
import type { HttpAddon } from './index.ts'
import type { AddonCatalog } from './manifest.ts'
import { mapLimit } from '../../utils/mapLimit.ts'
import { cardOf } from '../mine/cards.ts'
import { withPosterRatings } from '../mine/posterRatings.ts'
import { titleAllowed, titleAllowedCached } from '../profiles/access.ts'
import { findByExternalId } from '../tmdb/find.ts'
import { getTitleSummary, TmdbError } from '../tmdb/index.ts'
import {
  AddonError,
  currentAddon,
  listEnabledAddons,
  onAddonChanged,
  readAddonResource,
} from './index.ts'
import { ADDON_CONCURRENCY, boundedAddonResult, IMDB_ID } from './target.ts'

const MAX_PAGES = 128
const PAGE_TTL = 15 * 60_000
const ITEM_CONCURRENCY = 4

const pages = new Map<string, { ids: string[], expiresAt: number }>()

onAddonChanged((id, revision) => {
  for (const key of pages.keys()) {
    if (key.startsWith(`${id}:${revision}:`))
      pages.delete(key)
  }
})

export function hasAddonCatalogs() {
  return listEnabledAddons('catalog').length > 0
}

async function firstPage(
  addon: HttpAddon,
  catalog: AddonCatalog,
  signal: AbortSignal,
) {
  const key = `${addon.id}:${addon.revision}:${catalog.key}`
  const hit = pages.get(key)
  const now = Date.now()
  if (hit && hit.expiresAt > now)
    return hit.ids

  signal.throwIfAborted()
  const result = await readAddonResource(
    addon,
    'catalog',
    catalog.type,
    catalog.id,
    { signal },
  )
  if (!currentAddon(addon.id, addon.revision, 'catalog'))
    throw new AddonError('not_found')
  const { metas } = result as { metas: unknown[] }
  const ids = [
    ...new Set(
      metas.flatMap((value: unknown) => {
        if (!value || typeof value !== 'object')
          return []
        const { id, type } = value as { id?: unknown, type?: unknown }
        return typeof id === 'string'
          && IMDB_ID.test(id)
          && (type === undefined || type === catalog.type)
          ? [id]
          : []
      }),
    ),
  ]
  pages.delete(key)
  while (pages.size >= MAX_PAGES) pages.delete(pages.keys().next().value!)
  pages.set(key, { ids, expiresAt: Date.now() + PAGE_TTL })
  return ids
}

export async function findAddonCatalogRows(
  mode: HomeMode,
  language: string,
  profileId: string,
  current: () => boolean,
  signal: AbortSignal,
) {
  if (mode === 'library')
    return { rows: [], failed: false }
  const wanted
    = mode === 'movies' ? 'movie' : mode === 'series' ? 'series' : undefined
  const selected = listEnabledAddons('catalog').flatMap(addon =>
    addon.manifest.catalogs
      .filter(
        catalog =>
          (!wanted || catalog.type === wanted)
          && addon.selections.catalogs.includes(catalog.key),
      )
      .map(catalog => ({ addon, catalog })),
  )

  const items = new Map<string, Promise<Card | undefined>>()
  const cards = new Map<string, Promise<Card | undefined>>()
  let failed = false
  const fetchCard = async (type: AddonCatalog['type'], imdbId: string) => {
    signal.throwIfAborted()
    const id = await boundedAddonResult(
      findByExternalId(imdbId, 'imdb_id', type, true),
      signal,
    )
    if (!id || !current())
      return undefined
    const cached = cards.get(id)
    if (cached)
      return cached
    const details = (async () => {
      signal.throwIfAborted()
      if (
        !(await boundedAddonResult(titleAllowed(profileId, id), signal))
        || !current()
      ) {
        return undefined
      }
      signal.throwIfAborted()
      const summary = await boundedAddonResult(
        getTitleSummary(id, language),
        signal,
      )
      return summary ? cardOf(summary.details) : undefined
    })()
    cards.set(id, details)
    return details
  }

  const snapshots = await mapLimit(
    selected,
    ADDON_CONCURRENCY,
    async ({ addon, catalog }) => {
      let ids: string[]
      try {
        if (!current())
          throw new AddonError('not_found')
        ids = await firstPage(addon, catalog, signal)
      }
      catch {
        failed = true
        return { addon, catalog, cards: [] }
      }
      const matched = await mapLimit(ids, ITEM_CONCURRENCY, async (imdbId) => {
        if (!current())
          return undefined
        const key = `${catalog.type}:${imdbId}`
        let pending = items.get(key)
        if (!pending) {
          pending = fetchCard(catalog.type, imdbId)
          items.set(key, pending)
        }
        try {
          return await pending
        }
        catch (error) {
          if (!(error instanceof TmdbError) || error.kind !== 'not_found')
            failed = true
          return undefined
        }
      })
      return { addon, catalog, cards: matched }
    },
  )
  if (!current())
    throw new AddonError('not_found')

  const rows = snapshots.flatMap(({ addon, catalog, cards }) => {
    if (!currentAddon(addon.id, addon.revision, 'catalog'))
      return []
    const seen = new Set<string>()
    const visible = cards.filter((card): card is Card => {
      if (
        !card
        || card.kind !== catalog.type
        || seen.has(card.id)
        || !titleAllowedCached(profileId, card.id)
      ) {
        return false
      }
      seen.add(card.id)
      return true
    })
    if (!visible.length)
      return []
    return [
      {
        id: `${addon.id}:${catalog.key}`,
        kind: 'addon' as const,
        name: catalog.name,
        type: catalog.type,
        items: withPosterRatings(visible, profileId),
      },
    ]
  })
  return { rows, failed }
}
