import type { Backdrop } from '@torsher/api-client'
import { computed, onScopeDispose, shallowRef, watch } from 'vue'
import { api } from '../api.ts'
import { createLatest } from '../lib/latest.ts'
import { session } from '../session.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'

const CACHE_MS = 30 * 60 * 1000

/** A profile switch clears visible data before a new request can resolve. */
export function useScreensaverBackdrops() {
  const language = useCatalogLanguage()
  const key = computed(() =>
    JSON.stringify([
      session.status,
      session.profile?.id,
      session.profile?.ageLimit,
      language.value,
    ]),
  )
  const items = shallowRef<Backdrop[]>([])
  const latest = createLatest()
  let cached: { key: string, items: Backdrop[], at: number } | undefined

  watch(
    key,
    async (current) => {
      items.value = []
      latest.cancel()
      if (session.status !== 'ready')
        return
      const outcome = await latest.run(async () => {
        if (cached?.key === current && Date.now() - cached.at < CACHE_MS)
          return cached.items
        return (
          await api.catalog.getCatalogBackdrops({ language: language.value })
        ).items
      })
      if (outcome.status !== 'done')
        return
      cached = { key: current, items: outcome.value, at: Date.now() }
      items.value = outcome.value
    },
    { immediate: true, flush: 'sync' },
  )
  onScopeDispose(latest.cancel)
  return { items, key }
}
