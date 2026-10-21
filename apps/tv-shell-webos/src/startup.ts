export type StartScreen = 'address' | 'connect'

/**
 * Сохранённый адрес проверяем и открываем сразу. Вернулись на обёртку
 * кнопкой «Назад» из витрины («Сменить сервер») — показываем адрес, иначе
 * автоподключение тут же увело бы обратно.
 */
export function startScreen(
  saved: string | null,
  returnedBack: boolean,
): StartScreen {
  return saved && !returnedBack ? 'connect' : 'address'
}

interface NavigationTiming {
  type?: string
}

/** Тип навигации: `back_forward` — страницу открыли переходом по истории */
export function isHistoryNavigation(perf: Performance = performance) {
  const entry = perf.getEntriesByType?.('navigation')[0] as
    NavigationTiming | undefined

  if (entry?.type)
    return entry.type === 'back_forward'

  // Navigation Timing 1: на старых движках второго уровня может не быть
  return perf.navigation?.type === 2
}

interface ShellState {
  shellIndex?: unknown
}

/**
 * Номер записи обёртки в истории. Свежая загрузка — последняя запись,
 * номер запоминается в `history.state` и переживает возврат «Назад».
 */
export function shellHistoryIndex(history: History) {
  const saved = (history.state as ShellState | null)?.shellIndex
  if (typeof saved === 'number')
    return saved

  const index = history.length - 1
  history.replaceState({ shellIndex: index }, '')

  return index
}
