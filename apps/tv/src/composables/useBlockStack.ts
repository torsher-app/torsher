import type { Ref } from 'vue'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useFocus } from '../focus/index.ts'
import { stackOffset } from '../lib/rowStack.ts'
import { useStackScroll } from './useStackScroll.ts'

// Секция встаёт под верхний край экрана с этим отступом (пиксели макета)
const BLOCK_GAP = 110

/**
 * Экран-стек блоков (`data-block`): карточка тайтла и страница персоны.
 * Пульт и колесо ставят блок фокусной секции под верх экрана с упором в конце,
 * наведение экран не двигает. На ТВ блоки, начатые выше выровненного, гаснут
 * (`blocksAbove`), как ряды главной под hero: их хвост лез бы под кнопку
 * «Назад». В вебе экран прокручивается нативно. Колесо листает секции `order`
 * на одну от выровненной, элемент — в той же колонке; спящий в KeepAlive экран
 * (`active`) колесо не трогает.
 */
export function useBlockStack(options: {
  screen: Ref<HTMLElement | undefined>
  stack: Ref<HTMLElement | undefined>
  order: Ref<string[]>
  active: Ref<boolean>
  // Поверх экрана открыто своё (панель, список): колесо не листает блоки
  wheelHeld?: () => boolean
}) {
  const { screen, stack, order, active, wheelHeld } = options
  const focus = useFocus()
  const {
    native,
    offset,
    alignTo: scrollTo,
    onScroll,
    transform,
  } = useStackScroll(screen)
  const alignedSection = ref<string>()
  const blocksAbove = ref<string[]>([])

  function alignTo(el: HTMLElement) {
    const block = el.closest<HTMLElement>('[data-block]')

    if (!block || !stack.value || !screen.value)
      return

    const gap = (window.innerWidth / 1920) * BLOCK_GAP
    const top = block.offsetTop === 0 ? 0 : block.offsetTop - gap

    const next = stackOffset(
      top,
      stack.value.offsetHeight,
      screen.value.clientHeight,
    )

    scrollTo(next)

    if (native)
      return

    const line = next + gap - 1

    blocksAbove.value
      = next > 0
        ? Array.from(stack.value.querySelectorAll<HTMLElement>('[data-block]'))
            .filter(item => item.offsetTop < line)
            .map(item => item.dataset.block ?? '')
        : []
  }

  /** Фокус от пульта или колеса в секции `section`: её блок встаёт на место. */
  function align(el: HTMLElement, section: string | undefined) {
    alignedSection.value = section
    alignTo(el)
  }

  const stopWheel = focus.onWheel((direction) => {
    if (!active.value)
      return false

    if (wheelHeld?.() || (direction !== 'up' && direction !== 'down'))
      return true

    const index = order.value.indexOf(
      alignedSection.value ?? order.value[0] ?? '',
    )
    const next = order.value[index + (direction === 'down' ? 1 : -1)]

    if (next)
      focus.activate(next, 'wheel', focus.current())

    return true
  })

  function onResize() {
    const current = focus.current()

    if (current && screen.value?.contains(current))
      alignTo(current)
  }

  onMounted(() => window.addEventListener('resize', onResize))

  onBeforeUnmount(() => {
    stopWheel()
    window.removeEventListener('resize', onResize)
  })

  return { native, offset, transform, onScroll, blocksAbove, align }
}

/** Имя секции фокуса, в которой стоит элемент */
export function sectionName(el: HTMLElement) {
  return (
    el
      .closest<HTMLElement>('[data-focus-section]')
      ?.getAttribute('data-focus-section') ?? undefined
  )
}
