import { randomUUID } from 'node:crypto'
import { and, asc, eq, isNull, lte, or } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { externalListDecisions, externalLists } from '../../db/schema.ts'
import { restoreInProgress } from '../backups/index.ts'
import { restoreHeld } from '../libraryMaintenance/restore.ts'
import { titleAllowedCached } from '../profiles/access.ts'
import { getProfile } from '../profiles/index.ts'
import { decryptSecret, encryptSecret } from '../secrets/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import { localTitleDetails } from '../mine/personalMetadata.ts'
import { ExternalListsError } from './errors.ts'

const PROVIDER_SETTING = 'externalLists.mdblist'
const DAY = 24 * 60 * 60 * 1000
const DAILY_BUDGET = 500
const EXCLUSION_PAGE = 50
export const RUN_COOLDOWN_MS = 15 * 60 * 1000

export type StoredList = typeof externalLists.$inferSelect
export interface Credential {
  key: string
  revision: string
}

interface ProviderState {
  encryptedKey?: string
  revision?: string
  rejected?: boolean
  day?: number
  attempts?: number
  blockedUntil?: number
  throttleCount?: number
}

function providerState() {
  return getSetting<ProviderState>(PROVIDER_SETTING) ?? {}
}

export function settingsStatus() {
  const state = providerState()
  return { hasKey: !!state.encryptedKey, keyRejected: state.rejected === true }
}

export function assertCanSync() {
  if (restoreHeld() || restoreInProgress())
    throw new ExternalListsError('retryLater')
}

export function storeKey(key: string | null) {
  assertCanSync()
  getDb().transaction((tx) => {
    const state = providerState()
    const encryptedKey = key === null ? undefined : encryptSecret(key)
    setSetting(PROVIDER_SETTING, {
      ...state,
      encryptedKey,
      revision: randomUUID(),
      rejected: false,
    } satisfies ProviderState)
    tx.update(externalLists).set({ paused: true }).run()
  })
}

export function readCredential(): Credential {
  const { encryptedKey, revision, rejected } = providerState()
  if (!encryptedKey || !revision)
    throw new ExternalListsError('keyRequired')
  if (rejected)
    throw new ExternalListsError('keyRejected')
  try {
    return { key: decryptSecret(encryptedKey), revision }
  }
  catch {
    throw new ExternalListsError('keyRejected')
  }
}

export function assertCredential(revision: string) {
  const state = providerState()
  if (!state.encryptedKey || revision !== state.revision)
    throw new ExternalListsError('previewExpired')
  if (state.rejected)
    throw new ExternalListsError('keyRejected')
  return state
}

export function providerDueAt(state = providerState(), now = Date.now()) {
  const day = Math.floor(now / DAY)
  const quotaAt
    = state.day === day && (state.attempts ?? 0) >= DAILY_BUDGET
      ? (day + 1) * DAY
      : 0
  return Math.max(quotaAt, state.blockedUntil ?? 0)
}

export function assertProviderDue() {
  if (providerDueAt() > Date.now())
    throw new ExternalListsError('retryLater')
}

export function consumeProviderRequest(revision: string) {
  getDb().transaction(() => {
    assertCanSync()
    const state = assertCredential(revision)
    const now = Date.now()
    if (providerDueAt(state, now) > now)
      throw new ExternalListsError('retryLater')
    const day = Math.floor(now / DAY)
    setSetting(PROVIDER_SETTING, {
      ...state,
      day,
      attempts: (state.day === day ? (state.attempts ?? 0) : 0) + 1,
    } satisfies ProviderState)
  })
}

function retryAt(value: string | null, now: number) {
  if (!value)
    return 0
  const time = /^\d{1,10}$/.test(value)
    ? now + Number(value) * 1000
    : Date.parse(value)
  return Number.isFinite(time) && time > now ? time : 0
}

export function updateProviderLimits(revision: string, response: Response) {
  assertCanSync()
  const state = assertCredential(revision)
  if (response.status === 401) {
    setSetting(PROVIDER_SETTING, {
      ...state,
      rejected: true,
    } satisfies ProviderState)
    return
  }

  const exhausted = response.headers.get('x-ratelimit-remaining') === '0'
  if (response.status !== 429 && !exhausted && !state.throttleCount)
    return

  const now = Date.now()
  const rawReset = response.headers.get('x-ratelimit-reset')
  const resetAt
    = exhausted && rawReset && /^\d{1,12}$/.test(rawReset)
      ? Number(rawReset) * 1000
      : 0
  const retry = retryAt(response.headers.get('retry-after'), now)
  const throttleCount
    = response.status === 429 ? (state.throttleCount ?? 0) + 1 : 0
  const fallback
    = now
      + Math.min(
        DAY,
        RUN_COOLDOWN_MS * 2 ** Math.min(8, Math.max(0, throttleCount - 1))
        + Math.floor(Math.random() * 60_000),
      )
  const deadline = Math.max(retry, resetAt)
  setSetting(PROVIDER_SETTING, {
    ...state,
    blockedUntil:
      throttleCount || exhausted
        ? Math.max(
            state.blockedUntil ?? 0,
            deadline > now ? deadline : fallback,
          )
        : state.blockedUntil,
    throttleCount,
  } satisfies ProviderState)
}

export function storedLists() {
  return getDb()
    .select()
    .from(externalLists)
    .orderBy(asc(externalLists.name), asc(externalLists.id))
    .all()
}

export function storedList(id: string) {
  return getDb()
    .select()
    .from(externalLists)
    .where(eq(externalLists.id, id))
    .get()
}

export function dueList(now: number) {
  return getDb()
    .select()
    .from(externalLists)
    .where(
      and(
        eq(externalLists.paused, false),
        lte(externalLists.nextRunAt, now),
        or(
          isNull(externalLists.lastAttemptAt),
          lte(externalLists.lastAttemptAt, now - RUN_COOLDOWN_MS),
        ),
      ),
    )
    .orderBy(asc(externalLists.nextRunAt), asc(externalLists.id))
    .get()
}

export function profileOf(id: string) {
  const profile = getProfile(id)
  if (!profile)
    throw new ExternalListsError('notFound')
  return profile
}

export function profileLanguage(profile: ReturnType<typeof profileOf>) {
  return (profile.language ?? 'en_US').replace('_', '-')
}

export function listExclusions(profileId: string, offset: number) {
  const language = profileLanguage(profileOf(profileId))
  const rows = getDb()
    .select({ titleId: externalListDecisions.titleId })
    .from(externalListDecisions)
    .where(
      and(
        eq(externalListDecisions.profileId, profileId),
        eq(externalListDecisions.decision, 'excluded'),
      ),
    )
    .orderBy(asc(externalListDecisions.titleId))
    .limit(EXCLUSION_PAGE + 1)
    .offset(offset)
    .all()
  return {
    items: rows.slice(0, EXCLUSION_PAGE).map(({ titleId }) => ({
      titleId,
      title: titleAllowedCached(profileId, titleId)
        ? (localTitleDetails(titleId, language)?.title ?? null)
        : null,
    })),
    nextOffset: rows.length > EXCLUSION_PAGE ? offset + EXCLUSION_PAGE : null,
  }
}

export function unsetExclusion(profileId: string, titleId: string) {
  assertCanSync()
  profileOf(profileId)
  getDb()
    .delete(externalListDecisions)
    .where(
      and(
        eq(externalListDecisions.profileId, profileId),
        eq(externalListDecisions.titleId, titleId),
        eq(externalListDecisions.decision, 'excluded'),
      ),
    )
    .run()
}
