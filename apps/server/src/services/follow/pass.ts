import type {
  Follow,
  FollowDecision,
  FollowEpisode,
  FollowPendingCandidate,
  TrackedTopic,
} from '../../db/schema.ts'
import type { VoiceRef } from '../sources/profile.ts'
import type { FoundRelease, RankContext } from '../sources/rank.ts'
import type { CheckedCandidate, DecideContext, SeasonPlan } from './decide.ts'
import type { NewPending } from './notify.ts'
import type { UpgradeCheck, UpgradeTarget } from './upgrade.ts'
import type { EpisodeRef, EpisodeWithState } from './wanted.ts'
import type { VideoClass } from '@torsher/release-parser'
import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, follows, followSeasons } from '../../db/schema.ts'
import { summaryOf } from '../mine/cards.ts'
import { DEFAULT_PROFILE } from '../sources/profile.ts'
import { rankReleases } from '../sources/rank.ts'
import { knownResolutions } from '../sources/resolution.ts'
import { getPinnedVoice } from '../sources/voices.ts'
import { getTitleIdentity } from '../tmdb/index.ts'
import { movieAvailableFrom } from './availability.ts'
import { blockedHashes } from './blocklist.ts'
import {
  bestQualitySeen,
  cutoffStepOf,
  isAtCutoff,
  planSeason,
  positionOf,
  releaseSeasons,
} from './decide.ts'
import { followEpisodeStates, movieState, stateInputs } from './episodes.ts'
import { grabCandidate, pendingOf, resetEpisodes } from './grab.ts'
import { recordHistory, reportedEpisodes } from './history.ts'
import { announceWaiting } from './notify.ts'
import { scheduleOf } from './index.ts'
import {
  seasonTopics,
  titleTopics,
  topicOfRelease,
  touchTopics,
} from './topics.ts'
import { recordTrackerEpisodes } from './trackerEpisodes.ts'
import { upgradeTargets, versionOf } from './upgrade.ts'
import { compareEpisodes, episodeKey, WANTED_STATES } from './wanted.ts'

// Фону язык зрителя не нужен: из деталей берётся только расписание, а
// обновление расписания держит свежими детали на этом языке
export const BACKGROUND_LANGUAGE = 'en-US'
// Снимок кандидатов серии для панели: что нашли и почему отклонили
const DECISIONS_PER_EPISODE = 20

/**
 * Доступность фильма для слежения: с какого момента его можно скачать и
 * наступил ли он. Не фильм — `undefined`.
 */
export async function movieAvailability(
  follow: Pick<Follow, 'kind' | 'titleId'>,
  now = new Date(),
) {
  if (follow.kind !== 'movie')
    return undefined

  const from = await movieAvailableFrom(follow.titleId)

  return { from, available: !!from && from <= now }
}

/** Состояния серий слежения на расписании из кэша TMDB */
export async function followStates(
  follow: Follow,
  now = new Date(),
): Promise<EpisodeWithState[]> {
  const summary = await summaryOf(follow.titleId, BACKGROUND_LANGUAGE)

  if (!summary)
    return []

  // Фильм нужен с проката, а без него — с цифрового релиза
  if (follow.kind === 'movie') {
    return movieState(
      follow,
      summary.details.status === 'released'
      || !!(await movieAvailability(follow, now))?.available,
    )
  }

  return followEpisodeStates(
    follow,
    scheduleOf(summary),
    BACKGROUND_LANGUAGE,
    now,
  )
}

/**
 * Своя студия сезона: закрепление сезона, иначе ближайшего прошлого сезона
 * («как в прошлых сериях» переходит в новый), иначе студия из правил.
 */
export function seasonVoice(
  follow: Follow,
  season: number,
): VoiceRef | undefined {
  for (let number = season; number >= (season > 0 ? 1 : 0); number--) {
    const pinned = getPinnedVoice(follow.titleId, number)

    if (pinned)
      return pinned
  }

  return follow.voiceStudio ? { studio: follow.voiceStudio } : undefined
}

function episodeRows(followId: string) {
  return getDb()
    .select()
    .from(followEpisodes)
    .where(eq(followEpisodes.followId, followId))
    .all()
}

function seasonRow(followId: string, season: number) {
  return getDb()
    .select()
    .from(followSeasons)
    .where(
      and(
        eq(followSeasons.followId, followId),
        eq(followSeasons.season, season),
      ),
    )
    .get()
}

function decisionOf(
  candidate: CheckedCandidate,
  verdict: FollowDecision['verdict'],
  key: string,
): FollowDecision {
  const { release } = candidate
  const own = candidate.episodeRejections.get(key)

  return {
    id: release.id,
    title: release.title,
    infoHash: release.infoHash,
    indexers: release.indexers.map(item => item.name),
    size: release.size,
    seeders: release.seeders,
    quality: release.resolution?.value,
    studio: release.voice?.studio,
    voiceType: release.voice?.type,
    verdict,
    // Раздача берётся ради других серий, а эту не заменит: почему
    rejections:
      !candidate.rejections.length && own ? [own] : candidate.rejections,
  }
}

/** Снимок кандидатов, которые называют серию: выбранный первым */
function decisionsFor(plan: SeasonPlan, episode: EpisodeRef) {
  const key = episodeKey(episode)
  const grabbed = plan.grabs.find(item =>
    item.episodes.some(ref => episodeKey(ref) === key),
  )?.candidate
  const pending = plan.pending.find(
    item => episodeKey(item.episode) === key,
  )?.candidate
  const chosen = grabbed ?? pending
  const named = plan.candidates.filter(item =>
    item.considered.some(ref => episodeKey(ref) === key),
  )
  const rest = named.filter(item => item !== chosen)
  const list = chosen ? [chosen, ...rest] : rest

  return list
    .slice(0, DECISIONS_PER_EPISODE)
    .map(item =>
      decisionOf(
        item,
        item === grabbed ? 'grab' : item === pending ? 'pending' : 'rejected',
        key,
      ),
    )
}

function historyBySeason(
  follow: Follow,
  kind: 'found' | 'pending' | 'missing' | 'downloaded',
  episodes: EpisodeRef[],
  extra: { releaseTitle?: string, params?: Record<string, unknown> } = {},
  at = new Date(),
) {
  for (const season of new Set(episodes.map(item => item.season))) {
    recordHistory(
      {
        followId: follow.id,
        titleId: follow.titleId,
        kind,
        season,
        episodes: episodes
          .filter(item => item.season === season)
          .map(item => item.episode),
        ...extra,
      },
      at,
    )
  }
}

function saveSeason(
  follow: Follow,
  season: number,
  best: VideoClass | undefined,
  now: Date,
) {
  getDb()
    .insert(followSeasons)
    .values({
      followId: follow.id,
      season,
      bestQualitySeen: best ?? null,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [followSeasons.followId, followSeasons.season],
      set: { bestQualitySeen: best ?? null, updatedAt: now },
    })
    .run()
}

/**
 * Записи решателя по сезону: первое появление, отложенные, снимок нужных и
 * рассмотренных апгрейдом серий
 */
function savePlan(
  follow: Follow,
  plan: SeasonPlan,
  rows: Map<string, FollowEpisode>,
  considered: EpisodeRef[],
  topics: TrackedTopic[],
  now: Date,
): NewPending[] {
  const db = getDb()
  const fresh: NewPending[] = []
  const found: EpisodeRef[] = []

  for (const [key, at] of plan.found) {
    const [season, episode] = key.split(':').map(Number) as [number, number]

    db.insert(followEpisodes)
      .values({ followId: follow.id, season, episode, firstSeenAt: at })
      .onConflictDoNothing()
      .run()
    found.push({ season, episode })
  }

  if (found.length)
    historyBySeason(follow, 'found', found, {}, now)

  const pendingByCandidate = new Map<
    string,
    { candidate: FollowPendingCandidate, episodes: EpisodeRef[] }
  >()

  for (const item of plan.pending) {
    const key = episodeKey(item.episode)
    const row = rows.get(key)
    const candidate = pendingOf(
      item.candidate.release,
      topicOfRelease(item.candidate.release, topics),
    )

    db.update(followEpisodes)
      .set({ pending: candidate, waitUntil: item.until, stateNote: null })
      .where(
        and(
          eq(followEpisodes.followId, follow.id),
          eq(followEpisodes.season, item.episode.season),
          eq(followEpisodes.episode, item.episode.episode),
        ),
      )
      .run()

    if (!row?.pending) {
      const group = pendingByCandidate.get(candidate.id) ?? {
        candidate,
        episodes: [],
      }

      group.episodes.push(item.episode)
      pendingByCandidate.set(candidate.id, group)
    }
  }

  for (const [id, { candidate, episodes }] of pendingByCandidate) {
    const item = plan.pending.find(
      entry => entry.candidate.release.id === id,
    )!
    const wait = item.candidate.rejections.find(
      rejection => rejection.code === 'wait',
    )?.params

    historyBySeason(
      follow,
      'pending',
      episodes,
      {
        releaseTitle: item.candidate.release.title,
        params: { until: item.until.toISOString(), ...wait },
      },
      now,
    )
    fresh.push({
      episodes,
      candidate,
      until: item.until,
      wait: wait ?? {},
    })
  }

  for (const episode of considered) {
    if (!rows.has(episodeKey(episode)) && !plan.found.has(episodeKey(episode)))
      continue

    db.update(followEpisodes)
      .set({ decisions: decisionsFor(plan, episode) })
      .where(
        and(
          eq(followEpisodes.followId, follow.id),
          eq(followEpisodes.season, episode.season),
          eq(followEpisodes.episode, episode.episode),
        ),
      )
      .run()
  }

  return fresh
}

/** Заменяемые серии сезона для решателя: версия текущего файла или запрет */
function upgradeChecks(
  targets: Map<string, UpgradeTarget>,
  season: number,
  ctx: RankContext,
) {
  const checks = new Map<string, UpgradeCheck>()

  for (const [key, target] of targets) {
    if (Number(key.split(':')[0]) !== season)
      continue

    checks.set(
      key,
      target.current
        ? { current: versionOf(target.current, ctx) }
        : { blocked: target.blocked },
    )
  }

  return checks
}

/**
 * Есть ли у слежения серии в библиотеке, которые ещё стоит заменить: можно
 * заменить и файл не в cutoff сезона. По ним идёт целевой поиск апгрейда.
 */
export async function upgradeNeeded(
  follow: Follow,
  states: EpisodeWithState[],
  now = new Date(),
) {
  const targets = [...upgradeTargets(follow, states, now)].filter(
    ([, target]) => target.current,
  )

  if (!targets.length)
    return false

  const identity = await getTitleIdentity(follow.titleId)
  const rows = episodeRows(follow.id)

  return targets.some(([key, target]) => {
    const season = Number(key.split(':')[0])
    const voice = seasonVoice(follow, season)
    const stored = seasonRow(follow.id, season)
    const seasonCtx = {
      season,
      voice,
      cutoffStep: cutoffStepOf(
        follow.qualityPreset,
        (stored?.bestQualitySeen as VideoClass | null) ?? undefined,
        rows.filter(row => row.season === season).length,
      ),
    }
    const version = versionOf(target.current!, {
      kind: follow.kind,
      originalLanguage: identity?.originalLanguage,
      profile: DEFAULT_PROFILE,
      pinned: voice,
    })

    return !isAtCutoff(
      positionOf(version, seasonCtx, {
        russianOriginal: identity?.originalLanguage === 'ru',
        profile: DEFAULT_PROFILE,
        preset: follow.qualityPreset,
      }),
      seasonCtx,
    )
  })
}

/**
 * Фильм в библиотеке, и заменять его больше незачем или нельзя (cutoff,
 * посмотрели, выбран вручную, прошло 60 дней): слежение завершается само.
 * Пока идёт захват или апгрейд, слежение ждёт его.
 */
export async function completeMovie(follow: Follow, now = new Date()) {
  if (follow.kind !== 'movie' || follow.state !== 'active')
    return false

  const states = await followStates(follow, now)
  const grabbing = episodeRows(follow.id).some(
    row => !!row.upgradeFrom || (!!row.torrentId && !row.downloadedAt),
  )

  if (
    states[0]?.state !== 'in_library'
    || grabbing
    || (await upgradeNeeded(follow, states, now))
  ) {
    return false
  }

  getDb()
    .update(follows)
    .set({ state: 'done', nextSearchAt: null, updatedAt: now })
    .where(eq(follows.id, follow.id))
    .run()
  return true
}

/**
 * Прогон решателя по найденным раздачам: нужные серии по сезонам, проверки,
 * порядок Р5 с закреплённой студией сезона, жадное покрытие, окно ожидания.
 * Кандидаты в cutoff и с кончившимся окном захватываются сразу, как и
 * апгрейд серии в библиотеке. Серии раздач, которых нет в TMDB, сначала
 * записываются с трекера — и становятся нужными в том же прогоне.
 */
export async function decideFollow(
  follow: Follow,
  releases: FoundRelease[],
  now = new Date(),
) {
  if (follow.kind === 'series')
    await recordTrackerEpisodes(follow.titleId, releases, now)

  const states = await followStates(follow, now)
  const wanted = states.filter(item => WANTED_STATES.has(item.state))
  const targets = upgradeTargets(follow, states, now)

  if (!wanted.length && !targets.size)
    return

  const identity = await getTitleIdentity(follow.titleId)
  const availability = await movieAvailability(follow, now)
  const rows = new Map(
    episodeRows(follow.id).map(row => [episodeKey(row), row]),
  )
  const ctx: DecideContext = {
    kind: follow.kind,
    preset: follow.qualityPreset,
    voiceStrict: follow.voiceStrict,
    requireRussian: follow.requireRussian,
    waitHours: follow.waitHours,
    russianOriginal: identity?.originalLanguage === 'ru',
    profile: DEFAULT_PROFILE,
    episodeCounts: identity?.episodeCounts,
    wanted: new Set(wanted.map(episodeKey)),
    downloading: new Set(
      states.filter(item => item.state === 'downloading').map(episodeKey),
    ),
    blocked: blockedHashes(now),
    firstSeen: new Map(
      [...rows.values()].map(row => [episodeKey(row), row.firstSeenAt]),
    ),
    ...(availability
      && !availability.available && {
      unavailableUntil: availability.from ?? null,
    }),
    now,
  }
  const grabs: { plan: SeasonPlan, voice?: VoiceRef }[] = []
  const waiting: NewPending[] = []
  const topics = titleTopics(follow.titleId)
  const ownTopics = seasonTopics(follow.id)
  const seenTopics = new Set<string>()

  const considered = states.filter(
    item => WANTED_STATES.has(item.state) || targets.has(episodeKey(item)),
  )

  for (const season of new Set(considered.map(item => item.season))) {
    const inSeason = releases.filter(release =>
      releaseSeasons(release, follow.kind).includes(season),
    )

    for (const release of inSeason) {
      const topic = topicOfRelease(release, topics)

      if (topic)
        seenTopics.add(topic.id)
    }

    const voice = seasonVoice(follow, season)
    const rankCtx = {
      kind: follow.kind,
      originalLanguage: identity?.originalLanguage,
      episodeCounts: identity?.episodeCounts,
      profile: DEFAULT_PROFILE,
      pinned: voice,
    }
    const { ranked } = rankReleases(inSeason, {
      ...rankCtx,
      known: knownResolutions(inSeason),
    })
    const stored = seasonRow(follow.id, season)
    const best = bestQualitySeen(
      ranked,
      (stored?.bestQualitySeen as VideoClass | null) ?? undefined,
    )
    const seen = [...rows.values()].filter(
      row => row.season === season,
    ).length
    const plan = planSeason(
      ranked,
      {
        season,
        voice,
        cutoffStep: cutoffStepOf(follow.qualityPreset, best, seen),
        topic: ownTopics.get(season),
      },
      { ...ctx, upgrades: upgradeChecks(targets, season, rankCtx) },
    )

    if (best)
      saveSeason(follow, season, best, now)

    waiting.push(
      ...savePlan(
        follow,
        plan,
        rows,
        considered.filter(item => item.season === season),
        topics,
        now,
      ),
    )
    grabs.push({ plan, voice })
  }

  touchTopics([...seenTopics], now)
  await announceWaiting(follow, waiting)

  for (const { plan, voice } of grabs) {
    for (const grab of plan.grabs) {
      await grabCandidate(
        follow,
        pendingOf(
          grab.candidate.release,
          topicOfRelease(grab.candidate.release, topics),
        ),
        grab.episodes,
        {
          ownStudio: voice?.studio,
          now,
        },
      )
    }
  }
}

/**
 * Окно кончилось или место освободилось: отложенные кандидаты захватываются
 * без нового поиска. Серии, которые за это время скачали или оставили перед
 * курсором, кандидата больше не ждут.
 */
export async function grabPending(follow: Follow, now = new Date()) {
  const rows = getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        isNotNull(followEpisodes.pending),
        isNull(followEpisodes.torrentId),
      ),
    )
    .all()
    .filter(
      row =>
        row.stateNote === 'no_space'
        || (!!row.waitUntil && row.waitUntil <= now),
    )

  if (!rows.length)
    return

  const { library, downloading } = stateInputs(follow, follow.kind)
  const cursor = { season: follow.startSeason, episode: follow.startEpisode }
  const groups = new Map<
    string,
    { candidate: FollowPendingCandidate, episodes: EpisodeRef[] }
  >()

  for (const row of rows) {
    const key = episodeKey(row)

    if (
      library.has(key)
      || downloading.has(key)
      || compareEpisodes(row, cursor) < 0
    ) {
      resetEpisodes(follow, [row])
      continue
    }

    const group = groups.get(row.pending!.id) ?? {
      candidate: row.pending!,
      episodes: [],
    }

    group.episodes.push({ season: row.season, episode: row.episode })
    groups.set(row.pending!.id, group)
  }

  for (const { candidate, episodes } of groups.values()) {
    await grabCandidate(follow, candidate, episodes, {
      ownStudio: seasonVoice(follow, episodes[0]!.season)?.studio,
      now,
    })
  }
}

/** Файл захваченной серии лёг в библиотеку: событие `downloaded` один раз */
export function markDownloaded(follow: Follow, now = new Date()) {
  const rows = getDb()
    .select()
    .from(followEpisodes)
    .where(
      and(
        eq(followEpisodes.followId, follow.id),
        isNotNull(followEpisodes.torrentId),
        isNotNull(followEpisodes.fileIndex),
        isNull(followEpisodes.downloadedAt),
        // Апгрейд кончается заменой файла, а не появлением серии
        isNull(followEpisodes.upgradeFrom),
      ),
    )
    .all()

  if (!rows.length)
    return

  const { library } = stateInputs(follow, follow.kind)
  const done = rows.filter(row => library.has(episodeKey(row)))

  for (const row of done) {
    getDb()
      .update(followEpisodes)
      .set({ downloadedAt: now })
      .where(
        and(
          eq(followEpisodes.followId, follow.id),
          eq(followEpisodes.season, row.season),
          eq(followEpisodes.episode, row.episode),
        ),
      )
      .run()
  }

  if (done.length)
    historyBySeason(follow, 'downloaded', done, {}, now)
}

/** «Не нашли»: событие один раз на серию; возвращает впервые не найденные */
export function reportMissing(
  follow: Follow,
  states: EpisodeWithState[],
  now = new Date(),
) {
  const missing = states.filter(item => item.state === 'missing')

  if (!missing.length)
    return []

  const reported = reportedEpisodes(follow.id, 'missing')
  const fresh = missing.filter(item => !reported.has(episodeKey(item)))

  if (fresh.length)
    historyBySeason(follow, 'missing', fresh, {}, now)

  return fresh
}

/** Действующие слежения: на паузе и остановленные ничего не ищут и не качают */
export function activeFollows() {
  return getDb()
    .select()
    .from(follows)
    .where(eq(follows.state, 'active'))
    .all()
}
