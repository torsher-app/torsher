import type { Card, TitleDetails } from '../../dto/catalog.ts'
import { mapLimit } from '../../utils/mapLimit.ts'
import { logFor } from '../logs/index.ts'
import { withRatings } from '../ratings/index.ts'
import { getTitleSummary } from '../tmdb/index.ts'

// Одновременных запросов деталей к TMDB, когда их нет в кэше
export const DETAILS_CONCURRENCY = 6

export type TitleSummary = NonNullable<
  Awaited<ReturnType<typeof getTitleSummary>>
>

/** Детали из общего кэша; не загрузились и в кэше нет — `undefined` и запись в журнал */
export async function summaryOf(id: string, language: string) {
  try {
    return await getTitleSummary(id, language)
  }
  catch (err) {
    logFor('catalog').warn(
      { titleId: id, err },
      'Title details unavailable for a personal list',
    )

    return undefined
  }
}

export function summariesOf(ids: string[], language: string) {
  return mapLimit(ids, DETAILS_CONCURRENCY, id => summaryOf(id, language))
}

export function cardOf(details: TitleDetails): Card {
  return {
    id: details.id,
    kind: details.kind,
    title: details.title,
    originalTitle: details.originalTitle,
    year: details.year,
    poster: details.poster,
    ratings: details.ratings.length > 0 ? details.ratings : undefined,
  }
}

/** Карточки по каталожным ID в том же порядке; тайтлы без деталей пропускаются */
export async function cardsOf(ids: string[], language: string) {
  const summaries = await summariesOf(ids, language)

  return withRatings(
    summaries.flatMap(summary => (summary ? [cardOf(summary.details)] : [])),
  )
}
