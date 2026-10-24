/**
 * Карточка справа от списка (`Sheet` с `:modal="false"`): клик по содержимому
 * списка — строке, заголовку группы — её не закрывает, строка переключает
 * карточку. Пустое место под строками — сам прокручиваемый контейнер списка:
 * клик туда закрывает карточку, как клик мимо списка
 */
export function keepOpenOnListClick(event: Event, list: string) {
  const target = event.target as HTMLElement | null
  const container = target?.closest(list)

  if (container && container !== target)
    event.preventDefault()
}
