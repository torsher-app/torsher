import type { Ref } from 'vue'
import { computed, onActivated, ref } from 'vue'
import { platform } from '../platform/index.ts'

// Firefox отдаёт колесо мыши строками, а не пикселями
const WHEEL_LINE_PX = 40

/**
 * Вертикальное смещение экрана. На ТВ контент едет `transform`: экран сам ставит
 * секцию на место, нативной прокрутки нет. В вебе контейнер прокручивается
 * нативно — колесо и тачпад работают как в браузере, — а выравнивание с пульта
 * или клавиатуры прокручивает его. `offset` в обоих режимах — текущее смещение.
 *
 * Над окном прокрутки стоят hero и шапка экрана: в вебе экран вешает `onWheel`
 * на свой корень, и колесо над ними прокручивает окно — как страницу прокручивает
 * колесо над закреплённой шапкой. `wheelHeld` — поверх экрана открыта панель:
 * окно за ней колесо не трогает. `followsFocus` — окну строк экрана держать ли
 * строку с фокусом (`anchorSpan`).
 */
export function useStackScroll(
  container: Ref<HTMLElement | undefined>,
  options: { wheelHeld?: () => boolean } = {},
) {
  const native = platform === 'web'
  const offset = ref(0)
  // Веб: прокрутку ведёт фокус, пока её не взяло колесо. Экран ставит `true`,
  // когда выравнивает строку с фокусом, колесо над экраном сбрасывает
  const followsFocus = ref(true)

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

  function onWheel(event: WheelEvent) {
    const el = container.value

    if (!native || !el)
      return

    followsFocus.value = false

    // ctrlKey — масштаб страницы щипком тачпада, не прокрутка
    if (
      event.ctrlKey
      || options.wheelHeld?.()
      || !(event.target instanceof Node)
      || el.contains(event.target)
    ) {
      return
    }

    const unit
      = event.deltaMode === WheelEvent.DOM_DELTA_LINE
        ? WHEEL_LINE_PX
        : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
          ? el.clientHeight
          : 1

    el.scrollBy({ top: event.deltaY * unit })
  }

  // KeepAlive уносит DOM из документа, и нативная прокрутка сбрасывается:
  // вернувшийся экран встаёт на прежнее место без анимации
  onActivated(() => {
    if (native && container.value)
      container.value.scrollTop = offset.value
  })

  const transform = computed(() =>
    native ? undefined : `translateY(${-offset.value}px)`,
  )

  return {
    native,
    offset,
    followsFocus,
    alignTo,
    onScroll,
    onWheel,
    transform,
  }
}
