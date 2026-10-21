import type { SearchOutcome } from './search.ts'

// Поиск стоит секунд и запросов к индексаторам: результат держим в памяти.
// После перезапуска сервера поиск просто повторится
export const SEARCH_TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 50

export interface CachedSearch {
  outcome: SearchOutcome
  updatedAt: Date
}

const entries = new Map<string, CachedSearch>()
const running = new Map<string, Promise<CachedSearch>>()

/**
 * Свежий результат отдаётся из памяти, одинаковые запросы во время поиска
 * ждут один поиск (карточка ищет заранее, а пользователь уже нажал «Смотреть»).
 */
export function cachedSearch(
  key: string,
  load: () => Promise<SearchOutcome>,
  options: { refresh?: boolean, now?: number } = {},
): Promise<CachedSearch> {
  const now = options.now ?? Date.now()
  const found = entries.get(key)

  if (
    found
    && !options.refresh
    && now - found.updatedAt.getTime() < SEARCH_TTL_MS
  ) {
    return Promise.resolve(found)
  }

  const inFlight = running.get(key)

  if (inFlight)
    return inFlight

  const task = load()
    .then((outcome) => {
      const entry = { outcome, updatedAt: new Date() }

      entries.delete(key)
      entries.set(key, entry)

      // Map хранит порядок вставки: первым идёт самый старый поиск
      while (entries.size > MAX_ENTRIES)
        entries.delete(entries.keys().next().value!)

      return entry
    })
    .finally(() => running.delete(key))

  running.set(key, task)
  return task
}

export function peekSearch(key: string) {
  return entries.get(key)
}

export function clearSearchCache() {
  entries.clear()
  running.clear()
}
