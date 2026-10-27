import type { CatalogRow } from '../../dto/home.ts'
import { visibleCollections } from '../collections/index.ts'
import { logFor } from '../logs/index.ts'
import { freshFollowEpisodes } from '../sources/continue.ts'
import {
  collectionCards,
  profileStates,
  watchlistCards,
  watchlistTotal,
} from './index.ts'
import { newEpisodeCards } from './newEpisodes.ts'

const ROW_LIMIT = 20

/**
 * Личные ряды главной: «Новые серии», «Позже» и подборки с «На главной».
 * У «Позже» и подборок `total` — сколько всего в их разделе «Моё».
 * Пустые не отдаются, упавший ряд не роняет главную. Сериал с новой серией
 * «Следить» уже стоит в «Продолжить» с колокольчиком — в «Новых сериях» его нет.
 */
export async function personalHomeRows(
  profileId: string,
  language: string,
): Promise<CatalogRow[]> {
  const collections = visibleCollections(profileId).filter(
    item => item.showOnHome && item.count > 0,
  )
  const followed = new Set(freshFollowEpisodes(profileId).map(([id]) => id))
  const loads: Promise<CatalogRow>[] = [
    profileStates(profileId, language)
      .then(states =>
        newEpisodeCards(
          states.filter(state => !followed.has(state.titleId)),
          language,
          ROW_LIMIT,
        ),
      )
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
      total: watchlistTotal(profileId),
    })),
    ...collections.map(collection =>
      collectionCards(collection.id, language, ROW_LIMIT).then(items => ({
        id: 'collection' as const,
        kind: 'posters' as const,
        title: '',
        ref: collection.id,
        name: collection.name,
        items,
        total: collection.count,
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
