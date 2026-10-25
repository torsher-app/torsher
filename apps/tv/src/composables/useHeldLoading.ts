import { onScopeDispose, ref, watch } from 'vue'
import { loaderHoldMs } from '../lib/loader.ts'

/**
 * Загрузка для показа: лоадер, который уже проявился, держится минимальное
 * время (`loaderHoldMs`), и экран меняется один раз, без вспышки. Контент
 * и фокус ждут этого флага, а не самой загрузки. Проявляется лоадер сам, через
 * `--loader-delay` (AppLoader, `.skeleton`): флаг поднимается сразу, и место
 * под лоадер занято с первого кадра.
 */
export function useHeldLoading(loading: () => boolean) {
  const shown = ref(loading())
  let startedAt = shown.value ? performance.now() : 0
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(loading, (value) => {
    clearTimeout(timer)

    if (value) {
      // Загрузка вернулась, пока держали прежний лоадер: он уже на экране,
      // и его время идёт от прежнего начала
      if (!shown.value)
        startedAt = performance.now()

      shown.value = true
      return
    }

    const hold = loaderHoldMs(startedAt, performance.now())

    if (hold === 0) {
      shown.value = false
      return
    }

    timer = setTimeout(() => {
      shown.value = false
    }, hold)
  })

  onScopeDispose(() => clearTimeout(timer))

  return shown
}
