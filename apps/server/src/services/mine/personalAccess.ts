import type { MinePersonalErrorKind } from '../../dto/minePersonal.ts'
import type { FastifyRequest } from 'fastify'
import { viewerStillOnProfile } from '../../middleware/auth.ts'
import { titleAllowed, titleAllowedCached } from '../profiles/access.ts'
import { getProfile } from '../profiles/index.ts'
import { cachedTitleAge } from '../tmdb/certification.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'

type ErrorStatus = 400 | 404 | 409 | 503

export class MinePersonalError extends Error {
  readonly kind: MinePersonalErrorKind
  readonly status: ErrorStatus

  constructor(kind: MinePersonalErrorKind, status: ErrorStatus) {
    super(kind)
    this.kind = kind
    this.status = status
  }
}

export function capturedProfile(
  request: FastifyRequest,
  expectedProfileId = request.profileId,
) {
  return () => {
    if (!viewerStillOnProfile(request, expectedProfileId))
      throw new MinePersonalError('profileChanged', 409)
    return expectedProfileId
  }
}

export type CurrentProfile = ReturnType<typeof capturedProfile>

export async function allowMineTitle(titleId: string, current: CurrentProfile) {
  const profileId = current()
  const title = parseCatalogId(titleId)
  if (!title)
    throw new MinePersonalError('notFound', 404)
  const limit = getProfile(profileId)?.ageLimit
  if (limit === null)
    return title
  const age = cachedTitleAge(titleId)
  if (age !== undefined && limit !== undefined) {
    if (age >= limit)
      throw new MinePersonalError('notFound', 404)
    return title
  }
  const allowed = await titleAllowed(profileId, titleId)
  current()
  if (!allowed || !titleAllowedCached(profileId, titleId))
    throw new MinePersonalError('notFound', 404)
  return title
}
