import type { Card, TitleDetails } from '@torsher/api-client'
import type { FocusVia } from '../focus/index.ts'
import { onScopeDispose, shallowRef } from 'vue'
import { api } from '../api.ts'
import { createHeroScheduler } from '../lib/heroScheduler.ts'
import { createPromiseCache } from '../lib/promiseCache.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

// Детали тайтлов, по которым прошёл фокус, живут до перезагрузки витрины
const DETAILS_CACHE_LIMIT = 100

const detailsCache = createPromiseCache<TitleDetails>(DETAILS_CACHE_LIMIT)

export interface Hero {
  card: Card
  // Нет, если детали не загрузились: hero показывает то, что есть в карточке
  details?: TitleDetails
}

/** Hero сфокусированного тайтла: меняется с задержкой и после загрузки деталей. */
export function useHero() {
  const language = useCatalogLanguage()
  const hero = shallowRef<Hero>()
  let latest: Card | undefined

  async function apply(card: Card) {
    // Тот же тайтл из другого ряда — другая карточка: у «Продолжить» своя подсказка
    if (hero.value?.card === card)
      return

    latest = card

    const lang = language.value
    let details: TitleDetails | undefined

    try {
      details = await detailsCache.get(`${card.id}:${lang}`, () =>
        api.catalog.getCatalogTitle(card.id, { language: lang }))
    }
    catch {
      // Без деталей hero всё равно показывает название и год
    }

    if (latest === card)
      hero.value = { card, details }
  }

  const scheduler = createHeroScheduler(apply)

  onScopeDispose(scheduler.cancel)

  return {
    hero,
    show: (card: Card, via: FocusVia) => scheduler.schedule(card, via),
  }
}
