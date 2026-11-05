import type { FollowVoicesResponse } from '@torsher/api-client'
import type { Ref } from 'vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { api } from '../api.ts'

/** Cache-only reads on entry; only the explicit refresh action starts search. */
export function useFollowVoices(
  titleId: Ref<string>,
  season: Ref<number>,
  canEdit: Ref<boolean>,
) {
  const data = ref<FollowVoicesResponse>()
  const loading = ref(false)
  const error = ref(false)
  let request = 0

  async function load(refresh = false) {
    if (!canEdit.value || loading.value)
      return
    const token = ++request
    loading.value = true
    error.value = false
    try {
      const result = await api.titles.getFollowVoices(titleId.value, {
        season: season.value,
        ...(refresh ? { refresh: '1' as const } : {}),
      })
      if (token === request)
        data.value = result
    }
    catch {
      if (token === request)
        error.value = true
    }
    finally {
      if (token === request)
        loading.value = false
    }
  }

  watch(
    [titleId, season],
    () => {
      request++
      data.value = undefined
      loading.value = false
      error.value = false
    },
    { flush: 'sync' },
  )
  onBeforeUnmount(() => {
    request++
  })
  return { data, loading, error, load }
}
