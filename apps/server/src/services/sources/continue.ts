import type { ContinueCard, ContinueRow, HomeMode } from '../../dto/home.ts'
import type { MineKind } from '../../dto/mine.ts'
import type { FollowNewEpisode } from '../follow/badges.ts'
import type { ResumeTarget } from './resume.ts'
import { followNewEpisodes } from '../follow/badges.ts'
import { libraryTitleSet } from '../library/home.ts'
import { droppedSince, watchingTotal } from '../mine/index.ts'
import { getSeason, getTitle } from '../tmdb/index.ts'
import { parseCatalogId, withImageSize } from '../tmdb/mappers.ts'
import { episodeProgress } from './progress.ts'
import {
  excludedFromContinue,
  playedBefore,
  resumeTarget,
  watchedTitles,
} from './resume.ts'

const ROW_LIMIT = 20
// С запасом: часть тайтлов отсеется — досмотрены, брошены или без метаданных
const CANDIDATE_LIMIT = 40
const CARD_BACKDROP_SIZE = 'w780'
// Ряд главной — то, что смотрят сейчас: тайтл без просмотров дольше 16 недель
// остаётся только в «Моё» → «Продолжить» (как срок Continue Watching у Plex)
export const CONTINUE_MAX_AGE_DAYS = 112
const DAY_MS = 24 * 60 * 60 * 1000

// Тип раздела «Моё», куда ведёт плитка «Все»; у «Библиотеки» двойника нет
const MODE_KIND: Record<HomeMode, MineKind | undefined> = {
  all: 'all',
  movies: 'movie',
  series: 'series',
  library: undefined,
}

const MODE_TYPE: Record<HomeMode, 'movie' | 'tv' | undefined> = {
  all: undefined,
  movies: 'movie',
  series: 'tv',
  library: undefined,
}

type CardTarget = Omit<ResumeTarget, 'updatedAt'>

/** Цель карточки новой серии «Следить»: с начатого места, если его начали */
function followTarget(
  profileId: string,
  titleId: string,
  fresh: FollowNewEpisode,
): CardTarget {
  const movie = fresh.season === 0
  const row = episodeProgress(profileId, titleId).find(
    point => point.season === fresh.season && point.episode === fresh.episode,
  )

  return {
    season: movie ? null : fresh.season,
    episode: movie ? null : fresh.episode,
    position: row?.position ?? 0,
    duration: row?.duration ?? null,
    next: !movie,
    file:
      fresh.file
      ?? (row?.torrentId && row.fileIndex !== null
        ? { torrentId: row.torrentId, fileIndex: row.fileIndex }
        : null),
  }
}

async function continueCard(
  profileId: string,
  titleId: string,
  language: string,
  fresh?: FollowNewEpisode,
): Promise<ContinueCard | undefined> {
  // Детали и сезоны — из кэша TMDB: без сети ряд собирается из него, а тайтл
  // без кэша пропускается
  const details = await getTitle(titleId, language)

  if (!details)
    return undefined

  const target = fresh
    ? followTarget(profileId, titleId, fresh)
    : await resumeTarget(profileId, titleId, async () =>
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
    ...(fresh && { followNewEpisode: true }),
  }
}

/**
 * Новые серии слежений профиля, свежие первыми. Убранная из «Продолжить»
 * карточка вернётся со следующей новой серией.
 */
export function freshFollowEpisodes(profileId: string) {
  const dropped = droppedSince(profileId)

  return [...followNewEpisodes(profileId)]
    .filter(([titleId, fresh]) => {
      const at = dropped.get(titleId)

      return !at || at < fresh.at
    })
    .sort(([, a], [, b]) => b.at.getTime() - a.at.getTime())
}

/**
 * Ряд «Продолжить»: сначала новые серии слежений профиля с колокольчиком,
 * затем тайтлы с незаконченным просмотром за последние 16 недель, свежие
 * первыми. Тайтл, чьи метаданные не загрузились, пропускается, а не роняет
 * ряд. `total` — сколько в «Моё» → «Продолжить», только когда за рядом
 * что-то осталось: иначе считать статусы незачем.
 */
export async function getContinueRow(
  profileId: string,
  mode: HomeMode,
  language: string,
): Promise<ContinueRow> {
  const excluded = excludedFromContinue(profileId)
  const type = MODE_TYPE[mode]
  // В разделе «Библиотека» — только тайтлы с файлами в библиотеке
  const library = mode === 'library' ? libraryTitleSet(profileId) : undefined
  const fits = (id: string) => {
    const ref = parseCatalogId(id)

    return (
      !!ref && (!type || ref.type === type) && (!library || library.has(id))
    )
  }
  const since = new Date(Date.now() - CONTINUE_MAX_AGE_DAYS * DAY_MS)
  const fresh = freshFollowEpisodes(profileId).filter(([id]) => fits(id))
  const freshIds = new Set(fresh.map(([id]) => id))
  const ids = watchedTitles(profileId, CANDIDATE_LIMIT, since).filter(
    id => fits(id) && !excluded.has(id) && !freshIds.has(id),
  )
  const results = await Promise.allSettled([
    ...fresh.map(([id, item]) => continueCard(profileId, id, language, item)),
    ...ids.map(id => continueCard(profileId, id, language)),
  ])
  const items = results
    .flatMap(result =>
      result.status === 'fulfilled' && result.value ? [result.value] : [],
    )
    .slice(0, ROW_LIMIT)
  const kind = MODE_KIND[mode]
  const hidden = items.length === ROW_LIMIT || playedBefore(profileId, since)
  const total
    = kind && hidden
      ? await watchingTotal(profileId, language, kind).catch(() => undefined)
      : undefined

  return {
    id: 'continue',
    kind: 'continue',
    title: 'home.rows.continue',
    items,
    ...(total !== undefined && { total }),
  }
}
