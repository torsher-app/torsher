import type { Profile } from '../../db/schema.ts'
import type {
  MineRecommendationExclusionsQuery,
  MineRecommendationItem,
  MineRecommendationRefresh,
  MineRecommendationsQuery,
} from '../../dto/mineRecommendations.ts'
import type { TmdbMediaType } from '../tmdb/mappers.ts'
import type { PublicRequest } from '../tmdb/recommendations.ts'
import type { TmdbListResponse, TmdbListResult } from '../tmdb/types.ts'
import type { CurrentProfile } from './personalAccess.ts'
import type { RecommendationBudget } from './recommendationRefresh.ts'
import type { RecommendationSeed } from './recommendationSignals.ts'
import { createHash } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mineTitlePreferences } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { titleAllowedCached } from '../profiles/access.ts'
import { getProfile } from '../profiles/index.ts'
import { SecretError } from '../secrets/index.ts'
import { cachedTitleAge, cachedTitleAges } from '../tmdb/certification.ts'
import { currentTmdbKey } from '../tmdb/credentials.ts'
import { listResultToCard, parseCatalogId } from '../tmdb/mappers.ts'
import {
  cachedRecommendationGenres,
  RECOMMENDATION_LIST_TTL_MS,
  recommendationDetails,
  recommendationDiscover,
  recommendationGenres,
  recommendationList,
  recommendationSeason,
} from '../tmdb/recommendations.ts'
import { diaryTimeZone } from '../transfer/diaryTimeZone.ts'
import { calendarDayAt } from './calendar.ts'
import { MinePersonalError } from './personalAccess.ts'
import { withPosterRatings } from './posterRatings.ts'
import {
  fetchRecommendation,
  recommendationBackoffEpoch,
  recommendationBudget,
  recommendationPause,
  unavailableSeedList,
} from './recommendationRefresh.ts'
import {
  batchRecommendationMetadata,
  recommendationMetadata,
} from './recommendationMetadata.ts'
import { recommendationSignals } from './recommendationSignals.ts'

const SCREEN_LIMIT = 12
const POOL_LIMIT = 24
const METADATA_BATCH_SIZE = 64
const COLD_SEED_LIMIT = 6
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000
const SLOT_GC_INTERVAL_MS = 60_000
const MAX_RECENT_INTENTS = 12

interface CandidatePage {
  spec: PublicRequest<TmdbListResponse>
  media: TmdbMediaType
  seed?: RecommendationSeed
}

interface Candidate {
  id: string
  score: number
  attributed: RecommendationSeed[]
  watchlistedAt?: number
  listed?: TmdbListResult
}

type Metadata = NonNullable<ReturnType<typeof recommendationMetadata>>
interface CandidateView extends Candidate {
  metadata: Metadata
  age?: number
  needsMetadata: boolean
}

function kindMatches(
  media: TmdbMediaType,
  kind: MineRecommendationsQuery['kind'],
) {
  return kind === 'all' || kind === (media === 'movie' ? 'movie' : 'series')
}

function catalogMedia(kind: MineRecommendationsQuery['kind']): TmdbMediaType[] {
  return kind === 'all' ? ['movie', 'tv'] : [kind === 'movie' ? 'movie' : 'tv']
}

function minutesOf({ maxMinutes }: MineRecommendationsQuery) {
  return maxMinutes === 'any' ? undefined : Number(maxMinutes)
}

function candidatePages(
  seeds: RecommendationSeed[],
  query: MineRecommendationsQuery,
  today: string,
): CandidatePage[] {
  if (query.source === 'watchlist')
    return []
  const nearby = seeds.flatMap((seed) => {
    const ref = parseCatalogId(seed.id)
    return ref && kindMatches(ref.type, query.kind)
      ? [
          {
            seed,
            media: ref.type,
            spec: recommendationList(ref, query.language),
          },
        ]
      : []
  })
  return nearby.length
    ? nearby
    : catalogMedia(query.kind).map(media => ({
        media,
        spec: recommendationDiscover(
          media,
          query.language,
          today,
          query.genre,
          minutesOf(query),
        ),
      }))
}

function collectCandidates(
  pages: CandidatePage[],
  signals: ReturnType<typeof recommendationSignals>,
  query: MineRecommendationsQuery,
) {
  const { blocked, watchlist } = signals
  const candidates = new Map<string, Candidate>()
  if (query.source !== 'new') {
    for (const [id, watchlistedAt] of watchlist) {
      const ref = parseCatalogId(id)
      if (ref && kindMatches(ref.type, query.kind) && !blocked.has(id))
        candidates.set(id, { id, watchlistedAt, score: 110, attributed: [] })
    }
  }

  for (const { media, spec, seed } of pages) {
    if (unavailableSeedList(spec.key))
      continue
    const seen = new Set<string>()
    const results = spec.read()?.results
    for (const [index, listed] of (Array.isArray(results) ? results : [])
      .slice(0, 20)
      .entries()) {
      if (
        !Number.isSafeInteger(listed.id)
        || listed.id <= 0
        || listed.adult
        || (listed.media_type && listed.media_type !== media)
      ) {
        continue
      }
      const card = listResultToCard(listed, media)
      if (
        !card
        || seen.has(card.id)
        || blocked.has(card.id)
        || (query.source === 'new' && watchlist.has(card.id))
      ) {
        continue
      }
      seen.add(card.id)
      const row = candidates.get(card.id) ?? {
        id: card.id,
        score: 0,
        attributed: [],
      }
      row.listed ??= listed
      row.score += seed ? seed.strength * (1 - index / 40) : 52 - index
      if (seed)
        row.attributed.push(seed)
      candidates.set(card.id, row)
    }
  }
  return [...candidates.values()].sort(
    (a, b) =>
      b.score - a.score
      || (b.watchlistedAt ?? 0) - (a.watchlistedAt ?? 0)
      || a.id.localeCompare(b.id),
  )
}

function canShow(
  candidate: CandidateView,
  ageLimit: number | null,
  query: MineRecommendationsQuery,
) {
  const { metadata, age } = candidate
  const max = minutesOf(query)
  return (
    !metadata.unavailable
    && (ageLimit === null || (age !== undefined && age < ageLimit))
    && (!query.genre || metadata.genreIds.includes(query.genre))
    && (max === undefined
      || (metadata.runtimeMinutes !== null && metadata.runtimeMinutes <= max))
  )
}

function diverseSubset(candidates: CandidateView[]) {
  const queue = candidates.slice(0, POOL_LIMIT)
  const genres = new Map<number, number>()
  const franchises = new Map<number, number>()
  const picked: CandidateView[] = []
  const priority = ({ score, metadata }: CandidateView) =>
    score
    - 16
    * (metadata.genreIds.length
      ? Math.min(...metadata.genreIds.map(genre => genres.get(genre) ?? 0))
      : 0)
    - (metadata.franchise === undefined
      ? 0
      : 65 * (franchises.get(metadata.franchise) ?? 0))
  while (queue.length && picked.length < SCREEN_LIMIT) {
    let best = 0
    for (let index = 1; index < queue.length; index++) {
      if (priority(queue[index]!) > priority(queue[best]!))
        best = index
    }
    const item = queue.splice(best, 1)[0]!
    picked.push(item)
    for (const genre of item.metadata.genreIds)
      genres.set(genre, (genres.get(genre) ?? 0) + 1)
    const id = item.metadata.franchise
    if (id !== undefined)
      franchises.set(id, (franchises.get(id) ?? 0) + 1)
  }
  return picked
}

function reasonOf(
  candidate: CandidateView,
  context: Pick<
    RecommendationReading,
    'query' | 'timeZone' | 'today' | 'genreNames'
  >,
): MineRecommendationItem['reason'] {
  const { query, timeZone, today, genreNames } = context
  if (candidate.watchlistedAt !== undefined) {
    return {
      kind: 'watchlistSince',
      day: calendarDayAt(candidate.watchlistedAt, timeZone),
    }
  }

  const seeds = [...candidate.attributed].sort(
    (a, b) => b.strength - a.strength || a.id.localeCompare(b.id),
  )
  const named = seeds.flatMap((seed) => {
    const title = recommendationMetadata(
      seed.id,
      query.language,
      today,
      genreNames,
    )?.card.title.trim()
    return title && title !== seed.id ? [{ ...seed, title }] : []
  })
  const rated = named.find(seed => seed.rating !== null && seed.rating >= 6)
  if (rated?.rating != null) {
    return {
      kind: 'ratedSeed',
      titleId: rated.id,
      title: rated.title,
      rating: rated.rating,
    }
  }
  const favorite = named.find(seed => seed.favorite)
  if (favorite) {
    return {
      kind: 'favoriteSeed',
      titleId: favorite.id,
      title: favorite.title,
    }
  }
  const watched = named.find(seed => seed.watched)
  if (watched)
    return { kind: 'watchedSeed', titleId: watched.id, title: watched.title }

  const chosen = candidate.metadata.genres.find(
    genre => genre.id === query.genre,
  )
  return chosen ? { kind: 'selectedGenre', genre: chosen } : null
}

interface RecommendationReading {
  profile: Profile
  query: MineRecommendationsQuery
  now: number
  today: string
  timeZone: string
  genreNames: Map<number, string>
  signals: ReturnType<typeof recommendationSignals>
  pages: CandidatePage[]
  candidates: CandidateView[]
}

function readRecommendations(
  profile: Profile,
  query: MineRecommendationsQuery,
): RecommendationReading {
  const now = Date.now()
  const timeZone = diaryTimeZone()
  const today = calendarDayAt(now, timeZone)
  const signals = recommendationSignals(
    profile,
    query.language,
    timeZone,
    now,
    query.kind,
  )
  const genreNames = cachedRecommendationGenres(query.language)
  const pages = candidatePages(signals.seeds, query, today)
  const candidates = collectCandidates(pages, signals, query)
  const ages
    = profile.ageLimit === null
      ? undefined
      : cachedTitleAges(
          candidates.map(row => row.id),
          now,
        )
  const available = candidates.filter((row) => {
    const age = ages?.get(row.id)
    return (
      profile.ageLimit === null || age === undefined || age < profile.ageLimit
    )
  })
  const views: CandidateView[] = []
  const checkFreshness
    = query.refresh === 'visible' && query.source !== 'watchlist'
  for (
    let offset = 0;
    offset < available.length;
    offset += METADATA_BATCH_SIZE
  ) {
    const batch = available.slice(offset, offset + METADATA_BATCH_SIZE)
    const cache = batchRecommendationMetadata(
      batch.map(row => row.id),
      query.language,
      today,
      now,
    )
    for (const row of batch) {
      const metadata = recommendationMetadata(
        row.id,
        query.language,
        today,
        genreNames,
        row.listed,
        cache,
      )
      if (!metadata)
        continue
      const candidate = { ...row, age: ages?.get(row.id), metadata }
      views.push({
        ...candidate,
        needsMetadata:
          checkFreshness
          && hydrationWork({ query, profile }, candidate).some(
            spec => !cache.fresh(spec),
          ),
      })
    }
  }
  return {
    profile,
    query,
    now,
    today,
    timeZone,
    signals,
    genreNames,
    pages,
    candidates: views,
  }
}

function genrePages(query: MineRecommendationsQuery) {
  return catalogMedia(query.kind).map(media =>
    recommendationGenres(media, query.language),
  )
}

function detailsLanguage(profile: Profile, language: string) {
  return profile.ageLimit === null
    || language === 'en-US'
    || language === 'ru-RU'
    ? language
    : 'ru-RU'
}

function hydrationWork(
  reading: Pick<RecommendationReading, 'query' | 'profile'>,
  row: Pick<CandidateView, 'metadata' | 'age'>,
) {
  const { metadata } = row
  const { query, profile } = reading
  if (metadata.unavailable)
    return []
  if (
    query.genre
    && metadata.genreIds.length
    && !metadata.genreIds.includes(query.genre)
  ) {
    return []
  }
  const max = minutesOf(query)
  if (
    max !== undefined
    && metadata.runtimeMinutes !== null
    && metadata.runtimeMinutes > max
  ) {
    return []
  }

  const needsAge = profile.ageLimit !== null && row.age === undefined
  const needsDetails = !metadata.hasDetails || needsAge
  const needsRuntime = metadata.runtimeMinutes === null
  const result: PublicRequest<unknown>[] = []
  if (needsDetails || (metadata.ref.type === 'movie' && needsRuntime)) {
    result.push(
      recommendationDetails(
        metadata.ref,
        detailsLanguage(profile, query.language),
      ),
    )
  }
  if (metadata.season !== undefined && (needsRuntime || !metadata.episode)) {
    result.push(
      recommendationSeason(metadata.ref, metadata.season, query.language),
    )
  }
  return result
}

function seedNameWork(
  reading: RecommendationReading,
  candidates: CandidateView[],
) {
  const wanted = new Map(
    candidates.flatMap(row =>
      row.attributed.map(seed => [seed.id, seed] as const),
    ),
  )
  return [...wanted.values()].flatMap((seed) => {
    const metadata = recommendationMetadata(
      seed.id,
      reading.query.language,
      reading.today,
      reading.genreNames,
    )
    if (!metadata || metadata.card.title !== seed.id)
      return []
    const spec = recommendationDetails(metadata.ref, reading.query.language)
    return spec.read(true) ? [] : [{ seed, spec }]
  })
}

function usefulWork(reading: RecommendationReading) {
  if (reading.candidates.some(row => row.needsMetadata))
    return true
  if (
    reading.pages
      .slice(0, COLD_SEED_LIMIT)
      .some(
        page => !unavailableSeedList(page.spec.key) && !page.spec.read(true),
      )
  ) {
    return true
  }
  if (genrePages(reading.query).some(page => !page.read(true)))
    return true
  const eligible = reading.candidates.filter(row =>
    canShow(row, reading.profile.ageLimit, reading.query),
  )
  return seedNameWork(reading, eligible.slice(0, SCREEN_LIMIT)).length > 0
}

interface WantedView {
  key: string
  backoffEpoch: number
}
interface VisibleIntent {
  wanted: WantedView
  reading: RecommendationReading
  current: CurrentProfile
}
interface ProfileSlot {
  lastUsed: number
  wanted?: WantedView
  active?: VisibleIntent
  next?: VisibleIntent
  settled: Map<string, number>
}
const slots = new Map<string, ProfileSlot>()
let nextSlotSweep = 0

function intentKey(reading: RecommendationReading) {
  const { query, pages, signals } = reading
  const watchlist
    = query.source === 'new'
      ? []
      : [...signals.watchlist.keys()]
          .filter(id => !signals.blocked.has(id))
          .sort()
  return createHash('sha256')
    .update(
      JSON.stringify([
        query.language,
        query.source,
        query.kind,
        query.maxMinutes,
        query.genre ?? null,
        pages.map(page => page.spec.key).sort(),
        watchlist,
      ]),
    )
    .digest('base64url')
}

function stillCurrent(intent: VisibleIntent) {
  try {
    return intent.current() === intent.reading.profile.id
  }
  catch (error) {
    if (error instanceof MinePersonalError)
      return false
    throw error
  }
}

function gate(slot: ProfileSlot, intent: VisibleIntent) {
  return (
    slot.wanted === intent.wanted
    && intent.wanted.backoffEpoch === recommendationBackoffEpoch()
    && stillCurrent(intent)
    && !recommendationPause()
  )
}

async function warmPages(
  slot: ProfileSlot,
  intent: VisibleIntent,
  budget: RecommendationBudget,
) {
  const profileId = intent.reading.profile.id
  const pages = intent.reading.pages.slice(0, COLD_SEED_LIMIT)
  for (let start = 0; start < pages.length && gate(slot, intent); start += 2) {
    await Promise.all(
      pages
        .slice(start, start + 2)
        .map(page =>
          fetchRecommendation(
            page.spec,
            budget,
            () =>
              gate(slot, intent)
              && (!page.seed || titleAllowedCached(profileId, page.seed.id)),
          ),
        ),
    )
  }
  if (gate(slot, intent)) {
    await Promise.all(
      genrePages(intent.reading.query).map(spec =>
        fetchRecommendation(spec, budget, () => gate(slot, intent)),
      ),
    )
  }
}

function sameCandidateStillAllowed(profileId: string, id: string) {
  const profile = getProfile(profileId)
  if (!profile)
    return false
  if (profile.ageLimit === null)
    return true
  // Unknown ages may spend a bounded request to get proof. Cached denials
  // remain authoritative during catalog hydration.
  const age = cachedTitleAge(id)
  return age === undefined || age < profile.ageLimit
}

async function warmTitles(
  slot: ProfileSlot,
  intent: VisibleIntent,
  budget: RecommendationBudget,
) {
  const profile = getProfile(intent.reading.profile.id)
  if (!profile)
    return
  const { query } = intent.reading
  const reading = readRecommendations(profile, query)
  const admissible: CandidateView[] = []
  for (const candidate of reading.candidates) {
    if (
      !budget.remaining
      || admissible.length >= POOL_LIMIT
      || !gate(slot, intent)
    ) {
      break
    }
    const canRequest = () =>
      gate(slot, intent) && sameCandidateStillAllowed(profile.id, candidate.id)
    let entry = candidate
    const attempted = new Set<string>()
    // A title request can reveal which exact season to hydrate.
    for (
      let step = 0;
      candidate.needsMetadata && step < 3 && canRequest();
      step++
    ) {
      const spec = hydrationWork(reading, entry).find(
        spec => !attempted.has(spec.key) && !spec.read(true),
      )
      if (!spec)
        break
      attempted.add(spec.key)
      await fetchRecommendation(spec, budget, canRequest)
      const metadata = recommendationMetadata(
        candidate.id,
        query.language,
        reading.today,
        reading.genreNames,
        candidate.listed,
      )
      if (!metadata)
        break
      entry = {
        ...candidate,
        metadata,
        age:
          profile.ageLimit !== null ? cachedTitleAge(candidate.id) : undefined,
      }
    }
    if (canShow(entry, profile.ageLimit, query))
      admissible.push(entry)
  }
  for (const { seed, spec } of seedNameWork(
    reading,
    diverseSubset(admissible),
  )) {
    if (!budget.remaining || !gate(slot, intent))
      break
    await fetchRecommendation(
      spec,
      budget,
      () => gate(slot, intent) && titleAllowedCached(profile.id, seed.id),
    )
  }
}

async function refresh(slot: ProfileSlot, intent: VisibleIntent) {
  const budget = recommendationBudget()
  await warmPages(slot, intent, budget)
  if (gate(slot, intent))
    await warmTitles(slot, intent, budget)
}

function startRefresh(slot: ProfileSlot, intent: VisibleIntent) {
  slot.active = intent
  void refresh(slot, intent)
    .catch(() => {
      logFor('catalog').warn('Recommendation refresh failed')
    })
    .finally(() => {
      const now = Date.now()
      const key = intent.wanted.key
      if (gate(slot, intent)) {
        slot.settled.delete(key)
        slot.settled.set(key, now + RECOMMENDATION_LIST_TTL_MS)
        if (slot.settled.size > MAX_RECENT_INTENTS)
          slot.settled.delete(slot.settled.keys().next().value!)
      }
      slot.lastUsed = now
      slot.active = undefined
      const next = slot.next
      slot.next = undefined
      if (
        next
        && gate(slot, next)
        && (slot.settled.get(next.wanted.key) ?? 0) <= now
      ) {
        startRefresh(slot, next)
      }
    })
}

function profileSlot(profileId: string, now: number) {
  if (now >= nextSlotSweep) {
    nextSlotSweep = now + SLOT_GC_INTERVAL_MS
    for (const [id, slot] of slots) {
      if (
        !slot.active
        && (slot.lastUsed + JOB_RETENTION_MS <= now || !getProfile(id))
      ) {
        slots.delete(id)
      }
    }
  }
  const slot = slots.get(profileId) ?? {
    lastUsed: now,
    settled: new Map<string, number>(),
  }
  slot.lastUsed = now
  slots.set(profileId, slot)
  return slot
}

function catalogConfigured() {
  try {
    return !!currentTmdbKey()
  }
  catch (error) {
    if (error instanceof SecretError)
      return false
    throw error
  }
}

function updateRefresh(
  reading: RecommendationReading,
  current: CurrentProfile,
): MineRecommendationRefresh {
  const { query, now, profile } = reading
  const key = intentKey(reading)
  const backoffEpoch = recommendationBackoffEpoch()
  const visible = query.refresh === 'visible'
  const slot = visible ? profileSlot(profile.id, now) : slots.get(profile.id)
  if (
    slot
    && visible
    && (slot.wanted?.key !== key || slot.wanted.backoffEpoch !== backoffEpoch)
  ) {
    slot.wanted = { key, backoffEpoch }
    slot.next = undefined
  }

  if (query.source === 'watchlist')
    return { state: 'idle' }
  const status = recommendationPause(now)
  if (status)
    return status
  if (!catalogConfigured())
    return { state: 'unavailable', retryAfterMs: 0, cause: 'config' }

  const wanted = slot?.wanted
  if (
    !slot
    || !wanted
    || wanted.key !== key
    || wanted.backoffEpoch !== backoffEpoch
  ) {
    return { state: 'idle' }
  }
  if (visible && slot.active?.wanted === wanted) {
    // The same work can serve another authorized viewer of the profile.
    // Keep its budget and epoch; queued starts use the latest viewer check.
    slot.active.current = current
  }
  else if (visible) {
    const needs = (slot.settled.get(key) ?? 0) <= now && usefulWork(reading)
    if (needs) {
      const intent = { wanted, reading, current }
      if (slot.active)
        slot.next = intent
      else startRefresh(slot, intent)
    }
    else {
      slot.next = undefined
    }
  }
  return slot.active?.wanted === wanted || slot.next?.wanted === wanted
    ? { state: 'pending' }
    : { state: 'idle' }
}

export function getMineRecommendations(
  current: CurrentProfile,
  query: MineRecommendationsQuery,
) {
  const profileId = current()
  const profile = getProfile(profileId)
  if (!profile)
    throw new MinePersonalError('profileChanged', 409)
  const reading = readRecommendations(profile, query)
  const selection = diverseSubset(
    reading.candidates.filter(row => canShow(row, profile.ageLimit, query)),
  )
  const cards = withPosterRatings(
    selection.map(row => row.metadata.card),
    profileId,
  )
  const items: MineRecommendationItem[] = selection.map((row, index) => ({
    card: cards[index]!,
    backdrop: row.metadata.backdrop,
    genres: row.metadata.genres,
    runtimeMinutes: row.metadata.runtimeMinutes,
    episode: row.metadata.episode,
    reason: reasonOf(row, reading),
  }))
  return {
    profileId,
    items,
    genres: [...reading.genreNames]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, query.language)),
    hasPersonalSignals: reading.signals.hasPersonalSignals,
    refresh: updateRefresh(reading, current),
  }
}

export function getMineRecommendationExclusions(
  current: CurrentProfile,
  query: MineRecommendationExclusionsQuery,
) {
  const profileId = current()
  const profile = getProfile(profileId)
  if (!profile)
    throw new MinePersonalError('profileChanged', 409)
  const rows = getDb()
    .select({
      id: mineTitlePreferences.titleId,
      at: mineTitlePreferences.updatedAt,
    })
    .from(mineTitlePreferences)
    .where(
      and(
        eq(mineTitlePreferences.profileId, profileId),
        eq(mineTitlePreferences.notInterested, true),
      ),
    )
    .all()
    .sort(
      (a, b) => b.at.getTime() - a.at.getTime() || a.id.localeCompare(b.id),
    )
  const ages
    = profile.ageLimit === null
      ? undefined
      : cachedTitleAges(rows.map(row => row.id))
  const selected = rows.filter(
    row =>
      parseCatalogId(row.id)
      && (profile.ageLimit === null
        || (ages?.get(row.id) ?? Infinity) < profile.ageLimit),
  )
  const genreNames = cachedRecommendationGenres(query.language)
  const today = calendarDayAt(Date.now(), diaryTimeZone())
  return {
    profileId,
    total: selected.length,
    items: withPosterRatings(
      selected
        .slice(query.offset, query.offset + query.limit)
        .flatMap(
          row =>
            recommendationMetadata(row.id, query.language, today, genreNames)
              ?.card ?? [],
        ),
      profileId,
    ),
  }
}
