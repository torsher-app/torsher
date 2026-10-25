import { loaderHoldMs } from '@torsher/tokens/loader'
import { onScopeDispose, readonly, ref, watch } from 'vue'

/**
 * Загрузка для показа: скелетон, который уже проявился, держится минимальное
 * время (`loaderHoldMs`), и экран меняется один раз, без вспышки. Контент
 * ждёт этого флага, а не самой загрузки. Проявляется скелетон сам, через
 * `--loader-delay` (`Skeleton`): флаг поднимается сразу, и место под скелетон
 * занято с первого кадра.
 */
export function useHeldLoading(loading: () => boolean) {
  const shown = ref(loading())
  let startedAt = shown.value ? performance.now() : 0
  let timer: ReturnType<typeof setTimeout> | undefined

  watch(loading, (value) => {
    clearTimeout(timer)

    if (value) {
      // Загрузка вернулась, пока держали прежний скелетон: он уже на экране,
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

  return readonly(shown)
}
