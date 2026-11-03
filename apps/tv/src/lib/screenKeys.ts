import type { RouteLocationNormalized } from 'vue-router'

/**
 * Ключ экрана в стеке KeepAlive — запись истории, а не путь. Возврат по
 * истории (`popstate`) получает экран этой записи, переход вперёд и `replace` —
 * новый экран: тайтл, открытый в цепочке второй раз, не встаёт с фокусом,
 * оставленным на нём раньше. Запись с другим путём на той же позиции (адрес
 * поменяли руками, у записи нет своего состояния) — тоже новый экран.
 */
export function createScreenKeys() {
  const entries = new Map<number, { key: string, path: string }>()
  let counter = 0

  /**
   * `position` — номер записи в истории vue-router, `path` — путь маршрута,
   * `popped` — шаг по истории.
   */
  return function keyOf(position: number, path: string, popped: boolean) {
    const known = entries.get(position)

    if (popped && known?.path === path)
      return known.key

    const key = `${path}#${++counter}`

    entries.set(position, { key, path })

    // Переход вперёд отрезает записи впереди: на них больше не вернуться
    if (!popped) {
      for (const other of [...entries.keys()]) {
        if (other > position)
          entries.delete(other)
      }
    }

    return key
  }
}

/**
 * Объединённый библиотечный файл может содержать несколько серий: смена
 * контекста должна создать новый плеер с новой позицией и ключом прогресса.
 * Остальные экраны по-прежнему сохраняют ключ пути, независимо от фильтров.
 */
export function screenComponentKey(
  route: Pick<RouteLocationNormalized, 'path' | 'query'>,
) {
  if (!route.path.startsWith('/play/library/'))
    return route.path

  return JSON.stringify([
    route.path,
    ...['title', 'season', 'episode'].map((key) => {
      const value = route.query[key]

      return typeof value === 'string' ? value : null
    }),
  ])
}
