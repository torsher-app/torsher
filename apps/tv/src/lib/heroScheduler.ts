import type { FocusVia } from '../focus/index.ts'

/**
 * Hero меняется не сразу: при быстрой прокрутке пультом фон не дёргается,
 * а под указкой не мигает на каждой карточке, над которой пролетел курсор.
 */
export const HERO_DELAY_MS: Record<FocusVia, number> = {
  nav: 120,
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
