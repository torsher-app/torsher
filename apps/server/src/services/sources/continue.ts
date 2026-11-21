import type { DiagnosticContext } from '../diagnostics/index.ts'
import { decisionSnapshot } from '../diagnostics/index.ts'
import { continuationFor } from './continuation.ts'
import { localTitleImage } from '../library/images.ts'
import type { ContinueCard, ContinueRow, HomeMode } from '../../dto/home.ts'
import type { MineKind } from '../../dto/mine.ts'
import type { FollowNewEpisode } from '../follow/badges.ts'
import type { ResumeTarget } from './resume.ts'
import { followNewEpisodes } from '../follow/badges.ts'
import { libraryTitleSet } from '../library/home.ts'
import { droppedSince, watchingTotal } from '../mine/index.ts'
import { watchedMarkedTitles } from '../mine/marks.ts'
import { getSeason, getTitle } from '../tmdb/index.ts'
import { parseCatalogId, withImageSize } from '../tmdb/mappers.ts'
import { episodeProgress, lastTitleProgress } from './progress.ts'
import {
  excludedFromContinue,
  playedBefore,
  recentWatchedTitles,
  resumeTarget,
  visibleResumeSource,
  watchedTitles,
} from './resume.ts'
import { allowedTitleIds } from '../profiles/access.ts'
import { and, eq, ne, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  mineTitlePreferences,
  rewatchCycles,
  titleProgress,
} from '../../db/schema.ts'
import { cycleWire } from '../mine/cycles.ts'
import { localTitleDetails } from '../mine/personalMetadata.ts'
import { getProfile } from '../profiles/index.ts'
import { cachedTitleAges } from '../tmdb/certification.ts'
import { personalContinueCount } from '../mine/personal.ts'

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
    mediaFileId: row?.mediaFileId,
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
  context?: DiagnosticContext,
  selectedCycle?: typeof rewatchCycles.$inferSelect,
  cachedDetails?: NonNullable<ReturnType<typeof localTitleDetails>>,
): Promise<ContinueCard | undefined> {
  // Детали и сезоны — из кэша TMDB: без сети ряд собирается из него, а тайтл
  // без кэша пропускается
  const details = cachedDetails ?? (await getTitle(titleId, language))

  if (!details)
    return undefined

  const cycle = selectedCycle ? cycleWire(selectedCycle, language) : undefined
  if (cycle && !cycle.resume)
    return undefined

  const fromFollow
    = !cycle && !!fresh && !lastTitleProgress(profileId, titleId)
  let target: CardTarget | undefined
  if (cycle?.resume) {
    const { season, episode, position, duration, next, source } = cycle.resume
    target = {
      season,
      episode,
      position,
      duration,
      next,
      file:
        source?.kind === 'torrent'
          ? { torrentId: source.torrentId, fileIndex: source.fileIndex }
          : null,
      mediaFileId: source?.kind === 'library' ? source.mediaFileId : null,
    }
  }
  else if (fromFollow && fresh) {
    target = followTarget(profileId, titleId, fresh)
  }
  else {
    target = await resumeTarget(
      profileId,
      titleId,
      async () => details.seasons,
      context,
    )
  }

  if (!target)
    return undefined

  const continuation
    = !cycle && target.season && target.episode
      ? await continuationFor(
          profileId,
          titleId,
          {
            season: target.season,
            episode: target.episode,
          },
          context,
        )
      : undefined
  if (target.next && !target.position && continuation?.preferredTorrent)
    target.file = continuation.preferredTorrent

  if (
    !cycle
    && !target.file
    && fresh?.season === target.season
    && fresh.episode === target.episode
  ) {
    target.file = fresh.file ?? null
  }

  const episode
    = target.season !== null
      ? (
          await getSeason(titleId, target.season, language).catch(
            () => undefined,
          )
        )?.episodes.find(item => item.number === target.episode)
      : undefined
  const runtime = episode ? episode.runtime : details.runtime
  const backdrop = details.backdrop
    ? withImageSize(details.backdrop, CARD_BACKDROP_SIZE)
    : undefined

  const visible = visibleResumeSource(profileId, target)
  const decisionId = decisionSnapshot(
    'continue.decided',
    `${profileId}:${titleId}`,
    context,
    {
      profileId,
      titleId,
      season: target.season,
      episode: target.episode,
      reason: fromFollow
        ? 'follow_new'
        : target.next
          ? 'next_unwatched'
          : 'resume',
      resumeDecisionId: target.decisionId,
      position: target.position,
      duration: target.duration,
      next: target.next,
      followNewEpisode: fromFollow,
      torrentId: visible.file?.torrentId,
      fileIndex: visible.file?.fileIndex,
      mediaFileId: visible.mediaFileId,
      continuationDecisionId: continuation?.decisionId,
      selectionHistory: 'unavailable',
    },
    { follow: fresh?.diagnostic, followTargetUsed: fromFollow },
  )
  return {
    ...(decisionId && { decisionId }),
    id: details.id,
    kind: details.kind,
    title: details.title,
    originalTitle: details.originalTitle,
    year: details.year,
    poster: details.poster,
    image:
      target.season !== null
        ? (episode?.still
          ?? localTitleImage(
            profileId,
            titleId,
            target.season,
            target.episode,
            target.mediaFileId,
          )
          ?? backdrop)
        : (backdrop
          ?? localTitleImage(profileId, titleId, null, null, target.mediaFileId)),
    season: target.season,
    episode: target.episode,
    episodeTitle: episode?.title || undefined,
    position: target.position,
    duration: target.duration ?? (runtime ? runtime * 60 : null),
    next: target.next,
    continuation,
    ...visible,
    ...(fresh && {
      followUpdate: { season: fresh.season, episode: fresh.episode },
    }),
    ...(fromFollow && { followNewEpisode: true }),
    ...(cycle?.resume && {
      cycleId: cycle.id,
      cycleVoiceStudio: cycle.resume.voiceStudio,
      cycleVoiceType: cycle.resume.voiceType,
    }),
  }
}

/**
 * Новые серии слежений профиля, свежие первыми. Убранная из «Продолжить»
 * карточка вернётся со следующей новой серией.
 */
export function freshFollowEpisodes(profileId: string) {
  const dropped = droppedSince(profileId)
  const marked = watchedMarkedTitles(profileId)

  return [...followNewEpisodes(profileId)]
    .filter(([titleId, fresh]) => {
      const at = dropped.get(titleId)

      return !marked.has(titleId) && (!at || at < fresh.at)
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
  context?: DiagnosticContext,
  personal = false,
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
  if (personal) {
    return personalContinueRow(
      profileId,
      mode,
      language,
      context,
      since,
      fits,
      excluded,
    )
  }

  const fresh = freshFollowEpisodes(profileId).filter(([id]) => fits(id))
  const freshIds = new Set(fresh.map(([id]) => id))
  const ids = watchedTitles(profileId, CANDIDATE_LIMIT, since).filter(
    id => fits(id) && !excluded.has(id) && !freshIds.has(id),
  )
  const allowed = await allowedTitleIds(profileId, [
    ...fresh.map(([id]) => id),
    ...ids,
  ])
  const results = await Promise.allSettled([
    ...fresh
      .filter(([id]) => allowed.has(id))
      .map(([id, item]) =>
        continueCard(profileId, id, language, item, context),
      ),
    ...ids
      .filter(id => allowed.has(id))
      .map(id => continueCard(profileId, id, language, undefined, context)),
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

interface PersonalCandidate {
  id: string
  fresh?: FollowNewEpisode
}

async function personalContinueRow(
  profileId: string,
  mode: HomeMode,
  language: string,
  context: DiagnosticContext | undefined,
  since: Date,
  fits: (id: string) => boolean,
  excluded: Set<string>,
): Promise<ContinueRow> {
  const db = getDb()
  const blocked = new Set(
    db
      .select({ titleId: mineTitlePreferences.titleId })
      .from(mineTitlePreferences)
      .where(
        and(
          eq(mineTitlePreferences.profileId, profileId),
          ne(mineTitlePreferences.continuation, 'normal'),
        ),
      )
      .all()
      .map(row => row.titleId),
  )
  const matches = (id: string) => fits(id) && !blocked.has(id)
  const follows = freshFollowEpisodes(profileId).filter(([id]) => matches(id))
  const freshIds = new Set(follows.map(([id]) => id))
  const cycles = new Map(
    db
      .select()
      .from(rewatchCycles)
      .where(
        and(
          eq(rewatchCycles.profileId, profileId),
          eq(rewatchCycles.state, 'active'),
        ),
      )
      .all()
      .filter(row => matches(row.titleId))
      .map(row => [row.titleId, row]),
  )

  const excludedIds = JSON.stringify([
    ...new Set([...blocked, ...freshIds, ...excluded]),
  ])
  const ordinary = recentWatchedTitles(
    profileId,
    since,
    sql`
    ${titleProgress.titleId} NOT IN (SELECT value FROM json_each(${excludedIds}))
  `,
  )
    .all()
    .filter(row => fits(row.titleId))
  const recent = new Map(
    ordinary.map(row => [row.titleId, row.updatedAt?.getTime() ?? 0]),
  )
  for (const cycle of cycles.values()) {
    if (cycle.updatedAt >= since && !freshIds.has(cycle.titleId)) {
      recent.set(
        cycle.titleId,
        Math.max(cycle.updatedAt.getTime(), recent.get(cycle.titleId) ?? 0),
      )
    }
  }
  const candidates: PersonalCandidate[] = [
    ...follows.map(([id, fresh]) => ({ id, fresh })),
    ...[...recent].sort((a, b) => b[1] - a[1]).map(([id]) => ({ id })),
  ]

  const items: ContinueCard[] = []
  let coldBudget = CANDIDATE_LIMIT
  // Following remains first. Failed ACL or catalog candidates leave room for
  // the next batch. Cached candidates can fill a row after the network budget.
  for (
    let offset = 0;
    offset < candidates.length && items.length < ROW_LIMIT;
    offset += ROW_LIMIT
  ) {
    const batch = candidates.slice(offset, offset + ROW_LIMIT)
    const limit = getProfile(profileId)?.ageLimit
    if (limit === undefined)
      break
    const ages
      = limit === null
        ? new Map<string, number>()
        : cachedTitleAges(batch.map(row => row.id))
    const results = await Promise.allSettled(
      batch.map(async ({ id, fresh }) => {
        const age = ages.get(id)
        if (limit !== null && age !== undefined && age >= limit)
          return
        const details = localTitleDetails(id, language)
        const needsClassification = limit !== null && age === undefined
        if (needsClassification || !details) {
          if (coldBudget <= 0)
            return
          coldBudget--
        }
        if (
          needsClassification
          && !(await allowedTitleIds(profileId, [id])).has(id)
        ) {
          return
        }
        return continueCard(
          profileId,
          id,
          language,
          fresh,
          context,
          cycles.get(id),
          details,
        )
      }),
    )
    for (const result of results) {
      if (
        result.status === 'fulfilled'
        && result.value
        && items.length < ROW_LIMIT
      ) {
        items.push(result.value)
      }
    }
  }

  const limit = getProfile(profileId)?.ageLimit
  const currentAges
    = limit === null ? undefined : cachedTitleAges(items.map(row => row.id))
  const visible
    = limit === null
      ? items
      : limit === undefined
        ? []
        : items.filter(
            item => (currentAges?.get(item.id) ?? Infinity) < limit,
          )
  const kind = MODE_KIND[mode]
  const available = kind ? personalContinueCount(profileId, language, kind) : 0
  return {
    id: 'continue',
    kind: 'continue',
    title: 'home.rows.continue',
    items: visible,
    ...(available > visible.length && { total: available }),
  }
}
