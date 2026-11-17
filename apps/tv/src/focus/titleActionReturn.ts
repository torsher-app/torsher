import type { FocusEngine } from './engine.ts'

type ActionFocus = Pick<FocusEngine, 'current' | 'focusOn' | 'activate'>

/** Цель возврата принадлежит экрану, с которого открыли глобальное меню. */
export function captureTitleActionReturn(
  focus: ActionFocus,
  opener: HTMLElement | undefined,
) {
  const screen = opener?.closest<HTMLElement>('main')
  const section = opener?.closest<HTMLElement>('[data-focus-section]')
  const name = section?.getAttribute('data-focus-section')

  return () => {
    if (!screen?.isConnected || screen.getClientRects().length === 0)
      return false
    // За время закрытия мог появиться фокус другой панели или нового экрана.
    const current = focus.current()
    if (current?.isConnected && current !== opener)
      return false
    if (opener?.isConnected && focus.focusOn(opener))
      return true
    if (section?.isConnected && name && focus.activate(name))
      return true
    // Ряд мог исчезнуть целиком: ищем доступную цель только в живом экране,
    // а service проверяет регистрацию и видимость каждого кандидата.
    for (const candidate of screen.querySelectorAll<HTMLElement>(
      '[data-focusable]',
    )) {
      if (focus.focusOn(candidate))
        return true
    }
    return false
  }
}
