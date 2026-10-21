import type { TitleProgress, TitleSources } from '@torsher/api-client'
import type { Ref } from 'vue'
import type { WatchTarget } from '../lib/sources.ts'
import { computed, onScopeDispose, ref } from 'vue'
import { api } from '../api.ts'
import { useResource } from './useResource.ts'

// Пролёт по «Похожему» не дёргает индексаторы: поиск — после паузы на карточке
const SEARCH_DELAY_MS = 1000

/**
 * Раздачи для цели главной кнопки. Первый поиск уходит через секунду после
 * открытия карточки, дальше — сразу при смене серии; сервер держит результат
 * поиска в кэше, поэтому смена серии индексаторы не нагружает.
 */
export function useTitleSources(
  id: Ref<string>,
  target: Ref<WatchTarget | undefined>,
) {
  const started = ref(false)
  const timer = setTimeout(() => {
    started.value = true
  }, SEARCH_DELAY_MS)
  let forceRefresh = false
  const nonce = ref(0)

  onScopeDispose(() => clearTimeout(timer))

  const key = computed(() => {
    const value = target.value

    if (!started.value || !value)
      return undefined

    return `${id.value}:${value.season ?? 0}:${value.episode ?? 0}:${nonce.value}`
  })
  const { data, ...rest } = useResource<TitleSources>(key, (_, signal) => {
    const value = target.value!
    const refresh = forceRefresh

    forceRefresh = false

    return api.titles.getTitleSources(
      id.value,
      {
        season: value.season === undefined ? undefined : String(value.season),
        episode:
          value.episode === undefined ? undefined : String(value.episode),
        refresh: refresh ? '1' : undefined,
      },
      { signal },
    )
  })

  /** Искать заново, мимо кэша сервера */
  function refresh() {
    forceRefresh = true
    started.value = true
    nonce.value += 1
  }

  /** Перечитать из кэша сервера: ранжирование после смены озвучки */
  function reload() {
    started.value = true
    nonce.value += 1
  }

  /** Сразу, без паузы: пользователь уже нажал «Смотреть» или «Источники» */
  function startNow() {
    clearTimeout(timer)
    started.value = true
  }

  return { sources: data, refresh, reload, startNow, ...rest }
}

/** Последняя начатая серия тайтла: из неё — «Продолжить» */
export function useTitleProgress(id: Ref<string>) {
  const { data, ...rest } = useResource<TitleProgress>(
    computed(() => id.value),
    (titleId, signal) => api.titles.getTitleProgress(titleId, { signal }),
  )

  return { progress: data, ...rest }
}
