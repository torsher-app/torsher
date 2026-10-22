import type { Ref } from 'vue'
import { computed, ref } from 'vue'
import { platform } from '../platform/index.ts'

/**
 * Вертикальное смещение экрана. На ТВ контент едет `transform`: экран сам ставит
 * секцию на место, нативной прокрутки нет. В вебе контейнер прокручивается
 * нативно — колесо и тачпад работают как в браузере, — а выравнивание с пульта
 * или клавиатуры прокручивает его. `offset` в обоих режимах — текущее смещение.
 */
export function useStackScroll(container: Ref<HTMLElement | undefined>) {
  const native = platform === 'web'
  const offset = ref(0)

  function alignTo(top: number) {
    if (!native) {
      offset.value = top

      return
    }

    container.value?.scrollTo({ top, behavior: 'smooth' })
  }

  function onScroll() {
    if (native && container.value)
      offset.value = container.value.scrollTop
  }

  const transform = computed(() =>
    native ? undefined : `translateY(${-offset.value}px)`,
  )

  return { native, offset, alignTo, onScroll, transform }
}
