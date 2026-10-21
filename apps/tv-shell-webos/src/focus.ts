// Коды по keyCode: у кнопок пульта на webOS `event.key` ненадёжен
export const KEY = {
  up: 38,
  down: 40,
  enter: 13,
  back: 461,
  escape: 27,
} as const

function focusables(root: ParentNode) {
  return Array.from(
    root.querySelectorAll<HTMLElement>('[data-focusable]'),
  ).filter(el => el.getClientRects().length > 0)
}

/**
 * Элементов на экране обёртки два-три, и они стоят столбиком: ↑ и ↓ ходят
 * по ним в порядке DOM. Без фокуса любая стрелка ставит его на первый.
 */
export function moveFocus(step: 1 | -1, root: ParentNode = document) {
  const items = focusables(root)
  if (items.length === 0)
    return

  const current = items.indexOf(document.activeElement as HTMLElement)
  if (current === -1) {
    items[0]!.focus()
    return
  }

  items[current + step]?.focus()
}
