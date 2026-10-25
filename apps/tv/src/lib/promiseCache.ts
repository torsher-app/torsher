/**
 * Кэш ответов по ключу на время сессии: параллельные запросы одного ключа
 * делят один промис, неудачный ответ не кэшируется, старые записи вытесняются.
 */
export function createPromiseCache<T>(limit: number) {
  const entries = new Map<string, Promise<T>>()

  function get(key: string, load: () => Promise<T>): Promise<T> {
    const found = entries.get(key)

    if (found) {
      // Свежий доступ переносит запись в конец: вытесняется самая давняя
      entries.delete(key)
      entries.set(key, found)

      return found
    }

    const promise = load().catch((error: unknown) => {
      if (entries.get(key) === promise)
        entries.delete(key)

      throw error
    })

    entries.set(key, promise)

    while (entries.size > limit) entries.delete(entries.keys().next().value!)

    return promise
  }

  /** Убрать записи, ключ которых подходит: ответ устарел на сервере */
  function forget(match: (key: string) => boolean) {
    for (const key of [...entries.keys()]) {
      if (match(key))
        entries.delete(key)
    }
  }

  return { get, forget }
}
