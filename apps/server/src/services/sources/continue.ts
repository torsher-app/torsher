import type { ContinueCard, ContinueRow, HomeMode } from '../../dto/home.ts'
import { getSeason, getTitle } from '../tmdb/index.ts'
import { parseCatalogId, withImageSize } from '../tmdb/mappers.ts'
import { excludedFromContinue, resumeTarget, watchedTitles } from './resume.ts'

const ROW_LIMIT = 20
// С запасом: часть тайтлов отсеется — досмотрены, брошены или без метаданных
const CANDIDATE_LIMIT = 40
const CARD_BACKDROP_SIZE = 'w780'

const MODE_TYPE: Record<HomeMode, 'movie' | 'tv' | undefined> = {
  all: undefined,
  movies: 'movie',
  series: 'tv',
}

async function continueCard(
  profileId: string,
  titleId: string,
  language: string,
): Promise<ContinueCard | undefined> {
  // Детали и сезоны — из кэша TMDB: без сети ряд собирается из него, а тайтл
  // без кэша пропускается
  const details = await getTitle(titleId, language)

  if (!details)
    return undefined

  const target = await resumeTarget(profileId, titleId, async () =>
    details.seasons?.map(season => ({
      number: season.number,
      airedEpisodeCount: season.airedEpisodeCount,
    })))

  if (!target)
    return undefined

  const episode = target.season
    ? (
        await getSeason(titleId, target.season, language).catch(() => undefined)
      )?.episodes.find(item => item.number === target.episode)
    : undefined
  const runtime = episode ? episode.runtime : details.runtime
  const backdrop = details.backdrop
    ? withImageSize(details.backdrop, CARD_BACKDROP_SIZE)
    : undefined

  return {
    id: details.id,
    kind: details.kind,
    title: details.title,
    originalTitle: details.originalTitle,
    year: details.year,
    poster: details.poster,
    image: episode?.still ?? backdrop,
    season: target.season,
    episode: target.episode,
    episodeTitle: episode?.title || undefined,
    position: target.position,
    duration: target.duration ?? (runtime ? runtime * 60 : null),
    next: target.next,
    file: target.file,
  }
}

/**
 * Ряд «Продолжить»: тайтлы профиля с незаконченным просмотром, свежие первыми.
 * Тайтл, чьи метаданные не загрузились, пропускается, а не роняет ряд.
 */
export async function getContinueRow(
  profileId: string,
  mode: HomeMode,
  language: string,
): Promise<ContinueRow> {
  const excluded = excludedFromContinue(profileId)
  const type = MODE_TYPE[mode]
  const ids = watchedTitles(profileId, CANDIDATE_LIMIT).filter((id) => {
    const ref = parseCatalogId(id)

    return !!ref && !excluded.has(id) && (!type || ref.type === type)
  })
  const results = await Promise.allSettled(
    ids.map(id => continueCard(profileId, id, language)),
  )
  const items = results
    .flatMap(result =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    )
    .slice(0, ROW_LIMIT)

  return {
    id: 'continue',
    kind: 'continue',
    title: 'home.rows.continue',
    items,
  }
}
