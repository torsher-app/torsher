import type { FocusVia } from '../focus/index.ts'

/**
 * Hero меняется не сразу, а когда фокус остановился. Смена hero — fade текста
 * и кроссфейд фона во весь экран; совпав со сдвигом ряда, они роняют кадры
 * на ТВ, поэтому пока ряд листают пультом, верх экрана стоит на месте.
 * Под указкой hero не мигает на каждой карточке, над которой пролетел курсор.
 */
export const HERO_DELAY_MS: Record<FocusVia, number> = {
  nav: 400,
  pointer: 450,
  // Колесо пролистывает ряды быстро — как указка
  wheel: 450,
}

/** Применяет только последний элемент, на котором фокус задержался. */
export function createHeroScheduler<T>(apply: (item: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined

  function cancel() {
    clearTimeout(timer)
    timer = undefined
  }

  function schedule(item: T, via: FocusVia) {
    cancel()
    timer = setTimeout(() => {
      timer = undefined
      apply(item)
    }, HERO_DELAY_MS[via])
  }

  return { schedule, cancel }
}
