const STORAGE_KEY = 'torsher.recentSearches'
const LIMIT = 6

/** Запрос сверху списка: без пробелов по краям, без повторов с точностью до регистра. */
export function addRecent(list: string[], query: string, limit = LIMIT) {
  const text = query.trim()

  if (!text)
    return list

  const key = text.toLowerCase()

  return [text, ...list.filter(item => item.toLowerCase() !== key)].slice(
    0,
    limit,
  )
}

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

// Хранилища может не быть (приватный режим, запрет сайта): тогда недавних просто нет
function defaultStorage(): Storage | undefined {
  try {
    return window.localStorage
  }
  catch {
    return undefined
  }
}

export function loadRecent(storage = defaultStorage()): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? '[]')

    return Array.isArray(parsed)
      ? parsed
          .filter((item): item is string => typeof item === 'string')
          .slice(0, LIMIT)
      : []
  }
  catch {
    return []
  }
}

export function saveRecent(list: string[], storage = defaultStorage()) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(list))
  }
  catch {
    // Недавние не сохранились — поиск работает и без них
  }
}
