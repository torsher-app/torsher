import type { Card, TitleRating } from '../../dto/catalog.ts'
import type { TmdbRef } from '../tmdb/mappers.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { imdbIdKey, knownImdbIds, queueImdbIds } from './externalIds.ts'
import { imdbRatings } from './imdb/index.ts'
import { TMDB_PROVIDER, tmdbRatings } from './tmdb.ts'

/** Тайтл, которому ищут оценки: поставщик берёт нужные ему ID и названия */
export interface TitleRef {
  // Каталожный ID: ключ ответа поставщика
  key: string
  kind: 'movie' | 'series'
  tmdbId: number
  imdbId?: string
  title: string
  originalTitle: string
  year?: number
  // Оценка из ответа TMDB, который уже получен: отдельного запроса за ней нет
  tmdbVote?: Rating
}

/** Шкала 0–10 */
export interface Rating {
  value: number
  votes?: number
}

/**
 * Поставщик оценок — точка расширения ядра: встроенные TMDB и IMDb, позже
 * плагины. Отсутствие оценки — нет ключа в ответе, а не ошибка.
 */
export interface RatingProvider {
  id: string
  // Название бренда в интерфейсе, не переводится
  label: string
  enabled: () => boolean
  // Нужен ли IMDb ID: тогда тайтлы без него встают в фоновую очередь
  needsImdbId?: boolean
  // Медленный поставщик пропускается, ответ его не ждёт
  timeoutMs?: number
  ratingsFor: (refs: TitleRef[]) => Promise<Map<string, Rating>>
}

const DEFAULT_TIMEOUT_MS = 300

const providers: RatingProvider[] = [tmdbRatings, imdbRatings]

/** Новый поставщик встаёт после встроенных; повторный id заменяет прежний */
export function registerRatingProvider(provider: RatingProvider) {
  const index = providers.findIndex(item => item.id === provider.id)

  if (index === -1)
    providers.push(provider)
  else providers[index] = provider
}

export function unregisterRatingProvider(id: string) {
  const index = providers.findIndex(item => item.id === id)

  if (index !== -1)
    providers.splice(index, 1)
}

function withTimeout(provider: RatingProvider, refs: TitleRef[]) {
  let timer: NodeJS.Timeout | undefined

  const timeout = new Promise<Map<string, Rating>>((resolve) => {
    timer = setTimeout(
      resolve,
      provider.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      new Map(),
    )
  })

  return Promise.race([
    provider.ratingsFor(refs).catch(() => new Map<string, Rating>()),
    timeout,
  ]).finally(() => clearTimeout(timer))
}

/** Оценки включённых поставщиков в порядке реестра; упавший или медленный пропускается */
export async function collectRatings(refs: TitleRef[]) {
  const result = new Map<string, TitleRating[]>(
    refs.map(ref => [ref.key, []]),
  )

  if (refs.length === 0)
    return result

  const active = providers.filter(provider => provider.enabled())
  const answers = await Promise.all(
    active.map(provider => withTimeout(provider, refs)),
  )

  active.forEach((provider, index) => {
    for (const [key, rating] of answers[index]!) {
      result.get(key)?.push({
        provider: provider.id,
        label: provider.label,
        value: rating.value,
        votes: rating.votes,
      })
    }
  })

  return result
}

/** Оценки одного тайтла для карточки: IMDb ID уже известен из деталей */
export async function ratingsOf(ref: TitleRef) {
  return (await collectRatings([ref])).get(ref.key) ?? []
}

function needsImdbIds() {
  return providers.some(
    provider => provider.needsImdbId && provider.enabled(),
  )
}

/**
 * Дополняет карточки оценками всех поставщиков. TMDB-оценку карточка уже
 * несёт из списка; IMDb ID берётся из таблицы соответствий, а неизвестные
 * встают в фоновую очередь.
 */
export async function withRatings(cards: Card[]): Promise<Card[]> {
  const parsed = cards.flatMap((card) => {
    const ref = parseCatalogId(card.id)

    return ref ? [{ card, ref }] : []
  })
  const wantImdb = needsImdbIds()
  const known = wantImdb
    ? knownImdbIds(parsed.map(item => item.ref))
    : new Map<string, string | null>()
  const missing: TmdbRef[] = []

  const refs = parsed.map(({ card, ref }): TitleRef => {
    const imdbId = known.get(imdbIdKey(ref))

    if (wantImdb && imdbId === undefined)
      missing.push(ref)

    const tmdb = card.ratings?.find(
      rating => rating.provider === TMDB_PROVIDER,
    )

    return {
      key: card.id,
      kind: card.kind,
      tmdbId: ref.tmdbId,
      imdbId: imdbId ?? undefined,
      title: card.title,
      originalTitle: card.originalTitle,
      year: card.year,
      tmdbVote: tmdb ? { value: tmdb.value, votes: tmdb.votes } : undefined,
    }
  })

  if (missing.length > 0)
    queueImdbIds(missing)

  const ratings = await collectRatings(refs)

  for (const { card } of parsed) {
    const list = ratings.get(card.id) ?? []

    card.ratings = list.length > 0 ? list : undefined
  }

  return cards
}

export {
  purgeExpiredExternalIds,
  rememberImdbIdIfChanged,
} from './externalIds.ts'
