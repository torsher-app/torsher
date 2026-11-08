import type { FastifyReply, FastifyRequest } from 'fastify'
import { cachedTitleAge, loadTitleAge } from '../tmdb/certification.ts'
import { getProfile } from './index.ts'

export function hasAgeLimit(profileId: string) {
  return getProfile(profileId)?.ageLimit !== null
}

export function titleAllowedCached(
  profileId: string,
  titleId: string | null | undefined,
) {
  const profile = getProfile(profileId)
  if (!profile)
    return false
  if (profile.ageLimit === null)
    return true
  const age = titleId ? cachedTitleAge(titleId) : undefined
  return age !== undefined && age < profile.ageLimit
}

// Shared cap and in-flight deduplication also cover concurrently built home rows.
const pending = new Map<string, Promise<number | undefined>>()
const waiting: Array<() => void> = []
let active = 0
async function loadAge(id: string) {
  if (active >= 6)
    await new Promise<void>(resolve => waiting.push(resolve))
  else active++
  try {
    return await loadTitleAge(id)
  }
  finally {
    const next = waiting.shift()
    if (next)
      next()
    else active--
  }
}
function ageOf(id: string) {
  const existing = pending.get(id)
  if (existing)
    return existing
  const loading = loadAge(id).finally(() => pending.delete(id))
  pending.set(id, loading)
  return loading
}

export async function allowedTitleIds(
  profileId: string,
  ids: Array<string | null | undefined>,
) {
  const profile = getProfile(profileId)
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (!profile)
    return new Set<string>()
  if (profile.ageLimit === null)
    return new Set(unique)
  const decisions = await Promise.all(
    unique.map(async id => ({ id, age: await ageOf(id) })),
  )
  // The selected profile or its threshold may change while metadata is loading.
  const current = getProfile(profileId)
  if (!current)
    return new Set<string>()
  if (current.ageLimit === null)
    return new Set(unique)
  const limit = current.ageLimit
  return new Set(
    decisions
      .filter(item => item.age !== undefined && item.age < limit)
      .map(item => item.id),
  )
}

export async function filterTitles<T>(
  profileId: string,
  items: T[],
  id: (item: T) => string | null | undefined,
) {
  const profile = getProfile(profileId)
  if (!profile)
    return []
  if (profile.ageLimit === null)
    return items
  const allowed = await allowedTitleIds(profileId, items.map(id))
  return items.filter(item => allowed.has(id(item) ?? ''))
}

export async function titleAllowed(
  profileId: string,
  titleId: string | null | undefined,
) {
  if (!hasAgeLimit(profileId))
    return !!getProfile(profileId)
  return (
    !!titleId && (await allowedTitleIds(profileId, [titleId])).has(titleId)
  )
}

/** Hook for viewer routes whose :id is a catalog title. */
export async function requireTitleAccess(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { id } = request.params as { id?: string }
  if (!(await titleAllowed(request.profileId, id))) {
    return reply
      .code(404)
      .serializer(JSON.stringify)
      .send({ message: 'Title not found' })
  }
}
