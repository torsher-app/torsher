export interface StoredTorrent {
  id: string
  retention: 'cache' | 'keep'
  /** Байт на диске */
  size: number
  /** Последний просмотр, а без него — добавление; мс */
  lastUsedAt: number
  /** Смотрят сейчас или только что: не вытесняется */
  protected: boolean
}

export interface SpaceNeed {
  /** Сколько ещё скачает просмотр */
  bytes: number
  /** Раздача, которую готовят к просмотру: её саму не вытесняем */
  torrentId: string
  /** Раздача в кэше: её место считается в лимите кэша */
  cache: boolean
}

export interface EvictionInput {
  torrents: StoredTorrent[]
  cacheLimit: number
  minFree: number
  free: number
  need?: SpaceNeed
}

export type ShortageKind = 'no_space' | 'cache_limit'

export interface EvictionPlan {
  /** Что вытеснить, в порядке вытеснения */
  evict: string[]
  /** Место после вытеснения */
  free: number
  cacheUsed: number
  /** Ограничения соблюдены (и для `need` хватит места) */
  ok: boolean
  shortage?: ShortageKind
  /** Сколько можно скачать, не нарушив ограничение из `shortage` */
  available: number
}

/** Кандидаты в порядке вытеснения: кэш, давно не смотрели — первыми */
export function evictionQueue(torrents: StoredTorrent[], exceptId?: string) {
  return torrents
    .filter(
      item =>
        item.retention === 'cache'
        && !item.protected
        && item.id !== exceptId
        && item.size > 0,
    )
    .sort((a, b) => a.lastUsedAt - b.lastUsedAt)
}

/**
 * Вытеснение по давности просмотра (LRU): пока кэш больше лимита или на томе
 * меньше запаса (с учётом того, что ещё скачает просмотр), уходят раздачи
 * кэша, которые давно не открывали. Закреплённые и просматриваемые остаются.
 */
export function planEviction(input: EvictionInput): EvictionPlan {
  const { cacheLimit, minFree, need } = input
  const needBytes = need?.bytes ?? 0
  const needCache = need?.cache ? needBytes : 0
  let free = input.free
  let cacheUsed = input.torrents
    .filter(item => item.retention === 'cache')
    .reduce((sum, item) => sum + item.size, 0)

  const fitsCache = () => cacheUsed + needCache <= cacheLimit
  const fitsDisk = () => free - needBytes >= minFree
  const evict: string[] = []

  for (const item of evictionQueue(input.torrents, need?.torrentId)) {
    if (fitsCache() && fitsDisk())
      break

    evict.push(item.id)
    cacheUsed -= item.size
    free += item.size
  }

  return verdict(input, evict, free, cacheUsed)
}

function verdict(
  input: EvictionInput,
  evict: string[],
  free: number,
  cacheUsed: number,
): EvictionPlan {
  const { cacheLimit, minFree, need } = input
  const needBytes = need?.bytes ?? 0
  const needCache = need?.cache ? needBytes : 0

  if (free - needBytes < minFree) {
    return {
      evict,
      free,
      cacheUsed,
      ok: false,
      shortage: 'no_space',
      available: Math.max(0, free - minFree),
    }
  }

  if (cacheUsed + needCache > cacheLimit) {
    return {
      evict,
      free,
      cacheUsed,
      ok: false,
      shortage: 'cache_limit',
      available: Math.max(0, cacheLimit - cacheUsed),
    }
  }

  return { evict, free, cacheUsed, ok: true, available: free - minFree }
}

/**
 * План после вытеснения, часть которого пропущена (по раздаче открылся поток
 * уже после снимка): их место не освободилось, и вердикт пересчитывается.
 */
export function withoutSkipped(
  input: EvictionInput,
  plan: EvictionPlan,
  skipped: ReadonlySet<string>,
): EvictionPlan {
  if (!skipped.size)
    return plan

  const kept = input.torrents
    .filter(item => skipped.has(item.id))
    .reduce((sum, item) => sum + item.size, 0)

  return verdict(
    input,
    plan.evict.filter(id => !skipped.has(id)),
    plan.free - kept,
    plan.cacheUsed + kept,
  )
}
