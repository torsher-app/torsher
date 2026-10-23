import type { CatalogRow } from '../../dto/home.ts'
import { visibleCollections } from '../collections/index.ts'
import { logFor } from '../logs/index.ts'
import { collectionCards, profileStates, watchlistCards } from './index.ts'
import { newEpisodeCards } from './newEpisodes.ts'

const ROW_LIMIT = 20

/**
 * Личные ряды главной: «Новые серии», «Позже» и подборки с «На главной».
 * Пустые не отдаются, упавший ряд не роняет главную.
 */
export async function personalHomeRows(
  profileId: string,
  language: string,
): Promise<CatalogRow[]> {
  const collections = visibleCollections(profileId).filter(
    item => item.showOnHome && item.count > 0,
  )
  const loads: Promise<CatalogRow>[] = [
    profileStates(profileId, language)
      .then(states => newEpisodeCards(states, language, ROW_LIMIT))
      .then(episodes => ({
        id: 'newEpisodes',
        kind: 'episodes',
        title: 'home.rows.newEpisodes',
        items: [],
        episodes,
      })),
    watchlistCards(profileId, language, ROW_LIMIT).then(items => ({
      id: 'watchlist',
      kind: 'posters',
      title: 'home.rows.watchlist',
      items,
    })),
    ...collections.map(collection =>
      collectionCards(collection.id, language, ROW_LIMIT).then(items => ({
        id: 'collection' as const,
        kind: 'posters' as const,
        title: '',
        ref: collection.id,
        name: collection.name,
        items,
      })),
    ),
  ]
  const results = await Promise.allSettled(loads)

  return results.flatMap((result) => {
    if (result.status === 'rejected') {
      logFor('catalog').warn(
        { err: result.reason },
        'Personal home row failed',
      )

      return []
    }

    const row = result.value

    return row.items.length || row.episodes?.length ? [row] : []
  })
}
