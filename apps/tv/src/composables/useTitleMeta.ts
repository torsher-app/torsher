import type { TitleDetails } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'

const MAX_GENRES = 3

/**
 * Части строки меты тайтла: год · тип · длительность или сезоны · рейтинг · жанры.
 * Hero показывает рейтинг отдельно, поэтому он по запросу.
 */
export function useTitleMeta() {
  const { t } = useI18n()

  function formatRuntime(minutes: number) {
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60

    return hours > 0
      ? t('title.runtime', { hours, minutes: rest })
      : t('title.runtimeMinutes', { minutes: rest })
  }

  function formatRating(rating: number) {
    return t('title.rating', { rating: rating.toFixed(1) })
  }

  function metaParts(value: TitleDetails, options: { rating?: boolean } = {}) {
    const parts: string[] = []

    if (value.year)
      parts.push(String(value.year))

    parts.push(t(value.kind === 'movie' ? 'title.movie' : 'title.series'))

    if (value.runtime)
      parts.push(formatRuntime(value.runtime))

    if (value.seasons?.length)
      parts.push(t('title.seasonCount', value.seasons.length))

    if (options.rating && value.rating)
      parts.push(formatRating(value.rating))

    if (value.genres.length > 0)
      parts.push(value.genres.slice(0, MAX_GENRES).join(', '))

    return parts
  }

  return { metaParts, formatRating, formatRuntime }
}
