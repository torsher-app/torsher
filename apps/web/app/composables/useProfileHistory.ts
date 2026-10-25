import type { HistoryEntry } from '@torsher/api-client'
import type { MaybeRefOrGetter } from 'vue'
import { toast } from 'vue-sonner'
import { useI18n } from 'vue-i18n'
import { api } from '~/services/api'

type LoadState = 'loading' | 'error' | 'ready'

/**
 * История профиля порциями: по тайтлу — последняя серия и время просмотра.
 * `more` дописывает следующую порцию; новый профиль начинает с начала, и
 * ответ прежнего в список не попадает.
 */
export function useProfileHistory(
  profileId: MaybeRefOrGetter<string | undefined>,
  options: { limit: number },
) {
  const { t, locale } = useI18n()
  const items = shallowRef<HistoryEntry[]>([])
  const total = ref(0)
  const state = ref<LoadState>('loading')
  const loadingMore = ref(false)
  // Сколько строк сервера уже запрошено: тайтл без деталей TMDB в ответ не
  // попадает, и по числу показанных смещение не посчитать
  const served = ref(0)
  // Чья история в `items`: тот же профиль остаётся на экране, пока идёт новый
  // запрос (смена языка, импорт), чужой — нет
  let shownFor: string | undefined
  let token = 0

  function request(id: string, offset: number) {
    return withErrorMode('silent', () =>
      api.profiles.getProfileHistory(id, {
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

    if (state.value !== 'ready' || shownFor !== id) {
      items.value = []
      total.value = 0
      shownFor = undefined
      state.value = 'loading'
    }

    loadingMore.value = false

    try {
      const res = await request(id, 0)

      if (mine !== token)
        return

      items.value = res.items
      total.value = res.total
      served.value = options.limit
      shownFor = id
      state.value = 'ready'
    }
    catch {
      if (mine === token && state.value === 'loading')
        state.value = 'error'
    }
  }

  const hasMore = computed(
    () => state.value === 'ready' && served.value < total.value,
  )

  async function more() {
    const id = toValue(profileId)
    const mine = token

    if (!id || !hasMore.value || loadingMore.value)
      return

    loadingMore.value = true

    try {
      const res = await request(id, served.value)

      if (mine !== token)
        return

      const known = new Set(items.value.map(item => item.title.id))

      items.value = [
        ...items.value,
        ...res.items.filter(item => !known.has(item.title.id)),
      ]
      total.value = res.total
      served.value += options.limit
    }
    catch {
      if (mine === token)
        toast.error(t('panel.history.moreError'))
    }
    finally {
      if (mine === token)
        loadingMore.value = false
    }
  }

  watch(() => [toValue(profileId), locale.value], load, { immediate: true })

  return { items, total, state, loadingMore, hasMore, load, more }
}
