import type { Ref } from 'vue'
import { onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue'
import { useFocus } from '../focus/index.ts'

/**
 * Экран стека KeepAlive (карточка тайтла, персона): помнит последний фокус
 * внутри себя и по возврату ставит его на место. `onReturn` — что обновить
 * после возврата (прогресс после плеера). `active` — экран на виду: спящий в
 * кэше не должен перехватывать колесо.
 */
export function useStackedScreen(
  root: Ref<HTMLElement | undefined>,
  options: { fallback: () => string | undefined, onReturn?: () => void },
) {
  const focus = useFocus()
  const active = ref(false)
  let last: HTMLElement | undefined
  let shown = false

  const stopFocus = focus.onFocus((el) => {
    if (root.value?.contains(el))
      last = el
  })

  onActivated(() => {
    active.value = true

    // Первая активация — само открытие: фокус ставит autofocus секции
    if (!shown) {
      shown = true

      return
    }

    // Под указкой экран не двигается: позицию вернула прокрутка, фокус только
    // подсвечивает элемент; под пультом экран встаёт под фокусный блок
    const via = focus.mode === 'pointer' ? 'pointer' : 'nav'

    if (!last?.isConnected || !focus.focusOn(last, via)) {
      const section = options.fallback()

      if (section)
        focus.activate(section)
    }

    options.onReturn?.()
  })

  onDeactivated(() => {
    active.value = false
  })

  onBeforeUnmount(stopFocus)

  return { active }
}
