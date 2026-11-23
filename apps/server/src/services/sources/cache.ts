import type { SearchOutcome } from './search.ts'
import { logSearchCacheHit } from './logDiagnostics.ts'

// Поиск стоит секунд и запросов к индексаторам: результат держим в памяти.
// После перезапуска сервера поиск просто повторится
export const SEARCH_TTL_MS = 30 * 60 * 1000
const MAX_ENTRIES = 50

export interface CachedSearch {
  outcome: SearchOutcome
  updatedAt: Date
}

const entries = new Map<string, CachedSearch>()
const running = new Map<
  string,
  {
    task: Promise<CachedSearch>
    refresh: boolean
    indexerScope?: ReadonlySet<string>
  }
>()

/**
 * Свежий результат отдаётся из памяти, одинаковые запросы во время поиска
 * ждут один поиск (карточка ищет заранее, а пользователь уже нажал «Смотреть»).
 */
export function cachedSearch(
  key: string,
  load: () => Promise<SearchOutcome>,
  options: {
    refresh?: boolean
    indexerScope?: ReadonlySet<string>
    shouldPromote?: (runningScope?: ReadonlySet<string>) => boolean
    now?: number
  } = {},
): Promise<CachedSearch> {
  const now = options.now ?? Date.now()
  const found = entries.get(key)

  if (
    found
    && !options.refresh
    && now - found.updatedAt.getTime() < SEARCH_TTL_MS
  ) {
    logSearchCacheHit(found.outcome)
    return Promise.resolve(found)
  }

  const inFlight = running.get(key)

  if (
    inFlight
    && (inFlight.refresh
      || !options.refresh
      || !options.shouldPromote?.(inFlight.indexerScope))
  ) {
    return inFlight.task
  }

  const task = load()
    .then((outcome) => {
      const entry = { outcome, updatedAt: new Date() }

      // Пустой ответ без запросов не должен скрыть результаты или
      // помешать повторить поиск сразу после окончания паузы.
      if (
        running.get(key)?.task !== task
        || outcome.indexerCount === 0
        || outcome.diagnostics?.asked === 0
      ) {
        return entry
      }

      entries.delete(key)
      entries.set(key, entry)

      // Map хранит порядок вставки: первым идёт самый старый поиск
      while (entries.size > MAX_ENTRIES)
        entries.delete(entries.keys().next().value!)

      return entry
    })
    .finally(() => {
      if (running.get(key)?.task === task)
        running.delete(key)
    })

  running.set(key, {
    task,
    refresh: !!options.refresh,
    indexerScope: options.indexerScope,
  })
  return task
}

export function peekSearch(key: string) {
  return entries.get(key)
}

export function clearSearchCache() {
  entries.clear()
  running.clear()
}
