import type { UnmatchedImportRow } from '@torsher/api-client'
import type { MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { api } from '~/services/api'

type LoadState = 'loading' | 'error' | 'ready'

/**
 * Строки импорта, которые не сопоставились сами, порциями. Сопоставленная
 * или скрытая строка уходит из списка сразу, без перезагрузки.
 */
export function useImportUnmatched(
  profileId: MaybeRefOrGetter<string | undefined>,
  options: { limit: number },
) {
  const { t, locale } = useI18n()
  const items = ref<UnmatchedImportRow[]>([])
  const total = ref(0)
  const state = ref<LoadState>('loading')
  const loadingMore = ref(false)
  let token = 0

  function request(id: string, offset: number) {
    return withErrorMode('silent', () =>
      api.profiles.getProfileImportUnmatched(id, {
        offset,
        limit: options.limit,
        language: locale.value.replace('_', '-'),
      }))
  }

  async function load() {
    const id = toValue(profileId)

    if (!id)
      return

    const mine = ++token

    state.value = 'loading'

    try {
      const res = await request(id, 0)

      if (mine !== token)
        return

      items.value = res.items
      total.value = res.total
      state.value = 'ready'
    }
    catch {
      if (mine === token)
        state.value = 'error'
    }
  }

  const hasMore = computed(
    () => state.value === 'ready' && items.value.length < total.value,
  )

  async function more() {
    const id = toValue(profileId)
    const mine = token

    if (!id || !hasMore.value || loadingMore.value)
      return

    loadingMore.value = true

    try {
      const res = await request(id, items.value.length)

      if (mine !== token)
        return

      const known = new Set(items.value.map(item => item.id))

      items.value = [
        ...items.value,
        ...res.items.filter(item => !known.has(item.id)),
      ]
      total.value = res.total
    }
    catch {
      if (mine === token)
        toast.error(t('panel.imports.unmatched.moreError'))
    }
    finally {
      if (mine === token)
        loadingMore.value = false
    }
  }

  function drop(rowId: string) {
    items.value = items.value.filter(item => item.id !== rowId)
    total.value = Math.max(0, total.value - 1)
  }

  async function match(rowId: string, titleId: string) {
    const id = toValue(profileId)

    if (!id)
      return

    await withErrorMode('silent', () =>
      api.profiles.postProfileImportMatch(id, rowId, { titleId }))
    drop(rowId)
  }

  async function dismiss(rowId: string) {
    const id = toValue(profileId)

    if (!id)
      return

    await withErrorMode('silent', () =>
      api.profiles.deleteProfileImportUnmatched(id, rowId))
    drop(rowId)
  }

  watch(() => [toValue(profileId), locale.value], load, { immediate: true })

  return {
    items,
    total,
    state,
    loadingMore,
    hasMore,
    load,
    more,
    match,
    dismiss,
  }
}
