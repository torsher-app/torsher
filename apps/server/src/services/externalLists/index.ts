import type {
  ExternalListCounts,
  ExternalListPreviewInput,
  ExternalListPreviewJob,
  ExternalListsErrorCode,
  ExternalListWire,
} from '../../dto/externalLists.ts'
import type { PreparedCandidates } from './candidates.ts'
import type { SourceSnapshot } from './mdblist.ts'
import type { Credential, StoredList } from './state.ts'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { externalLists } from '../../db/schema.ts'
import { MaintenanceBusyError } from '../libraryMaintenance/admission.ts'
import { logFor } from '../logs/index.ts'
import { titleAllowedCached } from '../profiles/access.ts'
import { applyCandidates, prepareCandidates } from './candidates.ts'
import { ExternalListsError, listErrorCode } from './errors.ts'
import { readMdblist, sourcePath } from './mdblist.ts'
import {
  assertCanSync,
  assertCredential,
  assertProviderDue,
  consumeProviderRequest,
  dueList,
  profileOf,
  providerDueAt,
  readCredential,
  RUN_COOLDOWN_MS,
  settingsStatus,
  storedList,
  storedLists,
  storeKey,
  updateProviderLimits,
} from './state.ts'

export { listExclusions, unsetExclusion } from './state.ts'

const MAX_LISTS = 20
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const MAX_RUN_MS = 2 * MINUTE
const PREVIEW_TTL_MS = 10 * MINUTE
const POLL_INTERVAL_MS = MINUTE

interface Work {
  kind: 'preview' | 'run'
  controller: AbortController
  listId?: string
}
interface Prepared {
  list: Pick<SourceSnapshot, 'name' | 'id'>
  batch: PreparedCandidates
  readAt: number
}
interface Preview {
  token: string
  ownerId: string
  input: ExternalListPreviewInput
  revision?: number
  keyRevision: string
  result?: Prepared
  error?: ExternalListsErrorCode
  expiresAt: number
}

let active: Work | undefined
let preview: Preview | undefined
let lastPreviewAt = -Infinity
let scheduler: ReturnType<typeof setInterval> | undefined
let previewExpiry: ReturnType<typeof setTimeout> | undefined

function wire(list: StoredList): ExternalListWire {
  return {
    id: list.id,
    sourceId: list.sourceId,
    name: list.name,
    profileId: list.profileId,
    media: list.media,
    intervalHours: list.intervalHours,
    paused: list.paused,
    running:
      active?.kind === 'run'
      && active.listId === list.id
      && !active.controller.signal.aborted,
    lastAttemptAt: list.lastAttemptAt,
    lastReadAt: list.lastReadAt,
    nextRunAt: list.paused ? null : list.nextRunAt,
    lastResult: list.lastResult,
  }
}

export function listSettings() {
  return { ...settingsStatus(), lists: storedLists().map(wire) }
}

function clearPreview() {
  clearTimeout(previewExpiry)
  previewExpiry = undefined
  preview = undefined
}

export function saveKey(key: string | null) {
  storeKey(key)
  active?.controller.abort()
  clearPreview()
  return listSettings()
}

function listOf(id: string) {
  const list = storedList(id)
  if (!list)
    throw new ExternalListsError('notFound')
  return list
}

function assertRevision(id: string, revision: number) {
  const list = storedList(id)
  if (!list || list.revision !== revision)
    throw new ExternalListsError('previewExpired')
  return list
}

function assertUnique(sourceId: number, profileId: string, replacing?: string) {
  const lists = storedLists().filter(list => list.id !== replacing)
  if (
    lists.some(
      list => list.sourceId === sourceId && list.profileId === profileId,
    )
  ) {
    throw new ExternalListsError('duplicate')
  }
  if (lists.length >= MAX_LISTS)
    throw new ExternalListsError('listLimit')
}

function reserve(kind: Work['kind'], listId?: string) {
  if (active)
    throw new ExternalListsError('retryLater')
  const job = { kind, listId, controller: new AbortController() }
  active = job
  return job
}

function allowWork() {
  assertCanSync()
  const credential = readCredential()
  assertProviderDue()
  return credential
}

async function prepare(
  job: Work,
  credential: Credential,
  source: string | number,
  config: Pick<StoredList, 'profileId' | 'media' | 'checkOffset'>,
  validate: () => void,
): Promise<Prepared> {
  const signal = AbortSignal.any([
    job.controller.signal,
    AbortSignal.timeout(MAX_RUN_MS),
  ])
  const snapshot = await readMdblist(
    {
      key: credential.key,
      signal,
      beforeRequest() {
        validate()
        consumeProviderRequest(credential.revision)
      },
      onResponse(response) {
        job.controller.signal.throwIfAborted()
        validate()
        updateProviderLimits(credential.revision, response)
      },
    },
    source,
  )
  const readAt = Date.now()
  validate()
  profileOf(config.profileId)
  const batch = await prepareCandidates(snapshot, config, signal)
  return { list: { id: snapshot.id, name: snapshot.name }, batch, readAt }
}

function ensurePreview(ownerId: string, token: string) {
  if (
    !preview
    || preview.ownerId !== ownerId
    || preview.token !== token
    || preview.expiresAt <= Date.now()
  ) {
    throw new ExternalListsError('previewExpired')
  }
  return preview
}

function previewWire(job: Preview): ExternalListPreviewJob {
  const { token, error, result, input } = job
  if (result) {
    return {
      token,
      status: 'ready',
      preview: {
        name: result.list.name,
        sourceId: result.list.id,
        profileId: input.profileId,
        counts: result.batch.counts,
        items: result.batch.additions.filter(item =>
          titleAllowedCached(input.profileId, item.titleId),
        ),
      },
    }
  }
  return error
    ? { token, status: 'error', error }
    : { token, status: 'pending' }
}

export function getPreview(ownerId: string, token: string) {
  const current = ensurePreview(ownerId, token)
  if (current.input.listId)
    assertRevision(current.input.listId, current.revision!)
  profileOf(current.input.profileId)
  return previewWire(current)
}

export function startPreview(ownerId: string, input: ExternalListPreviewInput) {
  const credential = allowWork()
  profileOf(input.profileId)
  sourcePath(input.source)
  const existing = input.listId ? listOf(input.listId) : undefined
  if (!existing && storedLists().length >= MAX_LISTS)
    throw new ExternalListsError('listLimit')
  if (Date.now() - lastPreviewAt < MINUTE)
    throw new ExternalListsError('retryLater')

  const job = reserve('preview', input.listId)
  const token = randomUUID()
  const current: Preview = {
    token,
    ownerId,
    input,
    revision: existing?.revision,
    keyRevision: credential.revision,
    expiresAt: Infinity,
  }
  clearPreview()
  preview = current
  lastPreviewAt = Date.now()
  function validate() {
    if (existing)
      assertRevision(existing.id, existing.revision)
  }
  void prepare(
    job,
    credential,
    input.source,
    { ...input, checkOffset: 0 },
    validate,
  )
    .then((result) => {
      assertCanSync()
      validate()
      assertCredential(current.keyRevision)
      assertUnique(result.list.id, input.profileId, input.listId)
      if (!job.controller.signal.aborted)
        current.result = result
    })
    .catch((error: unknown) => {
      current.error = listErrorCode(error)
    })
    .finally(() => {
      active = undefined
      if (preview === current) {
        current.expiresAt = Date.now() + PREVIEW_TTL_MS
        previewExpiry = setTimeout(clearPreview, PREVIEW_TTL_MS)
        previewExpiry.unref()
      }
    })
  return { token, status: 'pending' as const }
}

function nextRun(now: number, intervalHours: number) {
  return now + intervalHours * HOUR + Math.floor(Math.random() * 5 * MINUTE)
}

function successfulResult(counts: ExternalListCounts) {
  return {
    status:
      counts.pending || counts.deferred
        ? ('partial' as const)
        : ('complete' as const),
    counts,
    error: null,
  }
}

export function confirmPreview(ownerId: string, token: string) {
  const current = ensurePreview(ownerId, token)
  const { result, input } = current
  if (!result || active)
    throw new ExternalListsError('retryLater')

  const list = getDb().transaction((tx) => {
    assertCanSync()
    assertCredential(current.keyRevision)
    if (input.listId)
      assertRevision(input.listId, current.revision!)
    profileOf(input.profileId)
    assertUnique(result.list.id, input.profileId, input.listId)
    const counts = applyCandidates(input.profileId, result.batch)
    const now = Date.now()
    const values = {
      sourceId: result.list.id,
      name: result.list.name,
      profileId: input.profileId,
      media: input.media,
      intervalHours: input.intervalHours,
      paused: false,
      revision: (current.revision ?? 0) + 1,
      checkOffset: result.batch.checkOffset,
      failures: 0,
      lastAttemptAt: now,
      lastReadAt: result.readAt,
      nextRunAt: nextRun(now, input.intervalHours),
      lastResult: successfulResult(counts),
    }
    return input.listId
      ? tx
          .update(externalLists)
          .set(values)
          .where(eq(externalLists.id, input.listId))
          .returning()
          .get()
      : tx.insert(externalLists).values(values).returning().get()
  })
  clearPreview()
  return wire(list)
}

function invalidateList(id: string) {
  if (active?.listId === id)
    active.controller.abort()
  if (preview?.input.listId === id)
    clearPreview()
}

export function setPaused(id: string, paused: boolean) {
  assertCanSync()
  const list = listOf(id)
  if (list.paused === paused)
    return wire(list)
  if (!paused)
    readCredential()
  const updated = getDb()
    .update(externalLists)
    .set({
      paused,
      revision: list.revision + 1,
      nextRunAt: paused
        ? list.nextRunAt
        : Math.max(
            Date.now(),
            (list.lastAttemptAt ?? 0) + RUN_COOLDOWN_MS,
            list.failures > 0 ? (list.nextRunAt ?? 0) : 0,
          ),
    })
    .where(eq(externalLists.id, id))
    .returning()
    .get()
  invalidateList(id)
  return wire(updated)
}

export function deleteList(id: string) {
  assertCanSync()
  listOf(id)
  getDb().delete(externalLists).where(eq(externalLists.id, id)).run()
  invalidateList(id)
}

function currentRun(job: Work, list: StoredList) {
  job.controller.signal.throwIfAborted()
  const stored = assertRevision(list.id, list.revision)
  if (stored.paused)
    throw new ExternalListsError('previewExpired')
}

function failureResult(list: StoredList, code: ExternalListsErrorCode) {
  const now = Date.now()
  const failures = list.failures + 1
  const paused = code === 'sourceUnavailable'
  const providerRetry = providerDueAt()
  const wait = Math.min(
    24 * HOUR,
    RUN_COOLDOWN_MS * 2 ** Math.min(8, failures - 1)
    + Math.floor(Math.random() * MINUTE),
  )
  const retry
    = code === 'retryLater' && providerRetry > now
      ? Math.max((list.lastAttemptAt ?? now) + RUN_COOLDOWN_MS, providerRetry)
      : now + wait
  return {
    failures,
    paused,
    nextRunAt:
      paused || code === 'keyRejected' ? null : Math.max(retry, providerRetry),
    lastResult: { status: 'error' as const, counts: null, error: code },
  }
}

async function run(job: Work, list: StoredList, credential: Credential) {
  const validate = () => currentRun(job, list)
  try {
    const result = await prepare(
      job,
      credential,
      list.sourceId,
      list,
      validate,
    )
    getDb().transaction((tx) => {
      validate()
      assertCanSync()
      assertCredential(credential.revision)
      const counts = applyCandidates(list.profileId, result.batch)
      tx.update(externalLists)
        .set({
          name: result.list.name,
          checkOffset: result.batch.checkOffset,
          failures: 0,
          lastReadAt: result.readAt,
          nextRunAt: nextRun(Date.now(), list.intervalHours),
          lastResult: successfulResult(counts),
        })
        .where(eq(externalLists.id, list.id))
        .run()
    })
  }
  catch (error) {
    try {
      validate()
      assertCanSync()
    }
    catch {
      return
    }
    const code
      = error instanceof MaintenanceBusyError
        ? 'retryLater'
        : listErrorCode(error)
    getDb()
      .update(externalLists)
      .set(failureResult(list, code))
      .where(eq(externalLists.id, list.id))
      .run()
  }
}

function startRun(list: StoredList) {
  const now = Date.now()
  if (
    list.paused
    || now < (list.lastAttemptAt ?? 0) + RUN_COOLDOWN_MS
    || (list.failures > 0 && list.nextRunAt !== null && now < list.nextRunAt)
  ) {
    throw new ExternalListsError('retryLater')
  }
  const credential = allowWork()
  const job = reserve('run', list.id)
  let attempted: StoredList
  try {
    attempted = getDb()
      .update(externalLists)
      .set({ lastAttemptAt: Date.now() })
      .where(eq(externalLists.id, list.id))
      .returning()
      .get()
  }
  catch (error) {
    active = undefined
    throw error
  }
  void run(job, attempted, credential)
    .catch(() => {
      logFor('catalog').warn('External list job could not record its result')
    })
    .finally(() => {
      active = undefined
    })
  return wire(attempted)
}

export function requestRun(id: string) {
  return startRun(listOf(id))
}

function tick() {
  if (active)
    return
  try {
    const list = dueList(Date.now())
    if (list)
      startRun(list)
  }
  catch (error) {
    if (!(error instanceof ExternalListsError))
      logFor('catalog').warn('External list scheduler could not start')
  }
}

export function startExternalListScheduler() {
  if (scheduler)
    return
  scheduler = setInterval(tick, POLL_INTERVAL_MS)
  scheduler.unref()
  tick()
}

export function stopExternalListScheduler() {
  clearInterval(scheduler)
  scheduler = undefined
  active?.controller.abort()
  clearPreview()
}
