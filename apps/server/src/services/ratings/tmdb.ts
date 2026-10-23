import type { TitleRating } from '../../dto/catalog.ts'
import type { Rating, RatingProvider } from './index.ts'

export const TMDB_PROVIDER = 'tmdb'
const TMDB_LABEL = 'TMDB'

/** Оценка TMDB из ответа: без голосов её нет */
export function tmdbVote(
  average: number | undefined,
  count: number | undefined,
): Rating | undefined {
  return average !== undefined && count
    ? { value: Math.round(average * 10) / 10, votes: count }
    : undefined
}

/** Строка TMDB, которую маппер кладёт в ответ сразу; порядок наводит реестр */
export function tmdbRating(
  average: number | undefined,
  count: number | undefined,
): TitleRating | undefined {
  const vote = tmdbVote(average, count)

  return vote
    ? { provider: TMDB_PROVIDER, label: TMDB_LABEL, ...vote }
    : undefined
}

/** Оценка уже пришла с деталями или списком TMDB: поставщик её только отдаёт */
export const tmdbRatings: RatingProvider = {
  id: TMDB_PROVIDER,
  label: TMDB_LABEL,
  enabled: () => true,
  async ratingsFor(refs) {
    const found = new Map<string, Rating>()

    for (const ref of refs) {
      if (ref.tmdbVote)
        found.set(ref.key, ref.tmdbVote)
    }

    return found
  },
}
