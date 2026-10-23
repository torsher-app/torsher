import type { Ref } from 'vue'
import type { LoadError } from '../lib/loadError.ts'
import { onScopeDispose, ref, shallowRef, watch } from 'vue'
import { loadErrorOf } from '../api.ts'
import { createLatest } from '../lib/latest.ts'

export type ResourceStatus = 'idle' | 'loading' | 'ready' | 'error'

/**
 * Данные по ключу: новый ключ отменяет прежний запрос, без ключа — пусто.
 * Ключ включает всё, от чего зависит ответ (ID, номер сезона, язык).
 * `refresh` перезапрашивает тихо: прежние данные остаются на экране до ответа,
 * а ошибка их не стирает.
 */
export function useResource<T>(
  key: Ref<string | undefined>,
  load: (key: string, signal: AbortSignal) => Promise<T>,
) {
  const status = ref<ResourceStatus>('idle')
  const data = shallowRef<T>()
  const error = ref<LoadError>()
  const latest = createLatest()

  async function run(quiet = false) {
    const current = key.value

    if (!quiet)
      data.value = undefined

    if (!current) {
      latest.cancel()
      status.value = 'idle'

      return
    }

    if (!quiet)
      status.value = 'loading'

    const outcome = await latest.run(signal => load(current, signal))

    if (outcome.status === 'cancelled')
      return

    if (outcome.status === 'failed') {
      if (quiet)
        return

      error.value = loadErrorOf(outcome.error)
      status.value = 'error'

      return
    }

    data.value = outcome.value
    status.value = 'ready'
  }

  watch(key, () => run(), { immediate: true })

  onScopeDispose(latest.cancel)

  return {
    status,
    data,
    error,
    retry: () => run(),
    refresh: () => run(true),
  }
}
