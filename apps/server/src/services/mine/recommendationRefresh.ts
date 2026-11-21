import type { MineRecommendationRefresh } from '../../dto/mineRecommendations.ts'
import type { PublicRequest } from '../tmdb/recommendations.ts'
import { withMetaCache } from '../tmdb/cache.ts'
import { RECOMMENDATION_LIST_TTL_MS } from '../tmdb/recommendations.ts'
import { TmdbError, tmdbGet } from '../tmdb/client.ts'

const MAX_CONCURRENT = 2
const MAX_REQUESTS = 16
const COOLDOWN_MS = 60_000
const inFlight = new Map<string, Promise<unknown>>()
const missingSeeds = new Map<string, number>()
const MAX_MISSING_SEEDS = 256
const waiting: Array<() => void> = []
let active = 0
let backoffEpoch = 0
let pause:
  | {
    until: number
    cause: 'rateLimit' | 'config' | 'network'
  }
  | undefined

export function unavailableSeedList(key: string, now = Date.now()) {
  const until = missingSeeds.get(key)
  if (until === undefined)
    return false
  if (until > now)
    return true
  missingSeeds.delete(key)
  return false
}

export function recommendationBackoffEpoch() {
  return backoffEpoch
}

export function recommendationPause(
  now = Date.now(),
): MineRecommendationRefresh | undefined {
  if (!pause)
    return
  if (pause.until <= now) {
    pause = undefined
    return
  }
  const retryAfterMs = Math.ceil(pause.until - now)
  return pause.cause === 'rateLimit'
    ? { state: 'backoff', retryAfterMs }
    : { state: 'unavailable', retryAfterMs, cause: pause.cause }
}

function recordUpstreamFailure(error: unknown) {
  if (!(error instanceof TmdbError) || error.kind === 'not_found')
    return
  const now = Date.now()
  if (error.upstreamStatus === 429) {
    backoffEpoch++
    const until = now + (error.retryAfterMs ?? COOLDOWN_MS)
    pause = {
      cause: 'rateLimit',
      until:
        pause?.cause === 'rateLimit' ? Math.max(pause.until, until) : until,
    }
  }
  else if (!recommendationPause(now)) {
    pause = {
      cause: error.kind === 'config' ? 'config' : 'network',
      until: now + COOLDOWN_MS,
    }
  }
}

export interface RecommendationBudget {
  remaining: number
  tried: Set<string>
}

export function recommendationBudget(): RecommendationBudget {
  return { remaining: MAX_REQUESTS, tried: new Set() }
}

async function acquireSlot() {
  if (active >= MAX_CONCURRENT)
    await new Promise<void>(resolve => waiting.push(resolve))
  else active++
}

function releaseSlot() {
  const next = waiting.shift()
  if (next)
    next()
  else active--
}

class EndLookup extends Error {}

/** Coalesce the complete load, including its cache write, across profiles. */
export async function fetchRecommendation<T>(
  spec: PublicRequest<T>,
  budget: RecommendationBudget,
  canRequest: () => boolean,
): Promise<T | undefined> {
  const fresh = spec.read(true)
  if (fresh !== undefined)
    return fresh
  if (
    budget.tried.has(spec.key)
    || unavailableSeedList(spec.key)
    || recommendationPause()
    || !canRequest()
  ) {
    return
  }
  budget.tried.add(spec.key)
  const existing = inFlight.get(spec.key)
  if (existing)
    return existing as Promise<T | undefined>

  await acquireSlot()
  let running: Promise<T | undefined> | undefined
  try {
    if (!canRequest() || recommendationPause())
      return
    const duplicate = inFlight.get(spec.key)
    if (duplicate)
      return duplicate as Promise<T | undefined>
    running = withMetaCache(spec.key, spec.ttlMs, async () => {
      if (!budget.remaining || recommendationPause() || !canRequest())
        throw new EndLookup()
      budget.remaining--
      try {
        return await tmdbGet<T>(spec.path, spec.params)
      }
      catch (error) {
        // Cache may return stale data, but the 429 still stops further starts.
        recordUpstreamFailure(error)
        if (
          error instanceof TmdbError
          && error.kind === 'not_found'
          && spec.path.endsWith('/recommendations')
        ) {
          missingSeeds.set(spec.key, Date.now() + RECOMMENDATION_LIST_TTL_MS)
          if (missingSeeds.size > MAX_MISSING_SEEDS)
            missingSeeds.delete(missingSeeds.keys().next().value!)
        }
        throw error
      }
    }).catch((error: unknown) => {
      if (error instanceof EndLookup || error instanceof TmdbError)
        return undefined
      throw error
    })
    inFlight.set(spec.key, running)
    return await running
  }
  finally {
    if (running && inFlight.get(spec.key) === running)
      inFlight.delete(spec.key)
    releaseSlot()
  }
}
