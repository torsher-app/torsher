const KEY = 'torsher.server'

// Хранилище может быть недоступно: тогда адрес просто не запоминается
export function loadServer(): string | null {
  try {
    return localStorage.getItem(KEY)
  }
  catch {
    return null
  }
}

export function saveServer(base: string) {
  try {
    localStorage.setItem(KEY, base)
  }
  catch {}
}
