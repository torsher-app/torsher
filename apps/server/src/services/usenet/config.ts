import type { UsenetConnection } from './errors.ts'
import type { SabClient } from './sab.ts'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { realpath } from 'node:fs/promises'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { libraryFolders, usenetClients, usenetJobs } from '../../db/schema.ts'
import { restoreInProgress } from '../backups/index.ts'
import { runtime as backupRuntime } from '../backups/state.ts'
import { overlaps, ownStoragePaths } from '../library/folders.ts'
import { restoreHeld } from '../libraryMaintenance/restore.ts'
import {
  previewTrustedAddress,
  TrustedHttpError,
  trustedUrl,
} from '../net/trustedHttp.ts'
import { decryptSecret, encryptSecret } from '../secrets/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import { UsenetError } from './errors.ts'
import {
  absolutePosixPath,
  canReadPinnedDirectory,
  insidePath,
} from './paths.ts'
import { checkSab, inspectSabCategory, sabAttemptName } from './sab.ts'

export interface UsenetConfigInput {
  url: string
  apiKey?: string
  category: string
  remoteRoot: string
  localRoot: string
  enabled: boolean
  followEnabled: boolean
  lanAddresses?: string[]
}

export interface UsenetConfigCheck {
  connection: UsenetConnection
  pathReadable: boolean
  lanAddresses: string[]
}

export type UsenetClient = typeof usenetClients.$inferSelect

const RESTORE_FENCE = 'usenetRestoreHold'

export function usenetRestoreBlocked() {
  return getSetting<boolean>(RESTORE_FENCE) === true
}

export function configuredClient(): UsenetClient | undefined {
  return getDb().select().from(usenetClients).get()
}

function view(client: UsenetClient) {
  const {
    url,
    category,
    remoteRoot,
    localRoot,
    enabled,
    followEnabled,
    lanAddresses,
    verified,
  } = client
  return {
    url,
    category,
    remoteRoot,
    localRoot,
    enabled,
    followEnabled,
    lanAddresses,
    verified,
    hasApiKey: Boolean(client.encryptedApiKey),
    restoreBlocked: usenetRestoreBlocked(),
  }
}

export function getUsenetConfig() {
  const client = configuredClient()
  return client ? view(client) : null
}

function normalizeBase(input: UsenetConfigInput) {
  let url: URL
  try {
    url = trustedUrl(input.url)
  }
  catch {
    throw new UsenetError('invalid')
  }
  if (input.url.includes('?') || url.hash || /[\\\s]/.test(input.url))
    throw new UsenetError('invalid')
  url.pathname = url.pathname.replace(/\/+$/, '')

  const category = input.category.trim()
  if (!/^[\w-][\w .-]{0,63}$/.test(category))
    throw new UsenetError('category')

  return {
    url: url.href.replace(/\/$/, ''),
    category,
  }
}

function checkedKey(
  input: UsenetConfigInput,
  url: string,
  previous?: UsenetClient,
) {
  const apiKey
    = input.apiKey
      || (previous?.url === url
        && previous.verified
        && previous.encryptedApiKey
        && decryptSecret(previous.encryptedApiKey))
  if (
    !apiKey
    || apiKey.length > 512
    || [...apiKey].some(char => char < '!' || char > '~')
  ) {
    throw new UsenetError('auth')
  }
  return apiKey
}

function sameAddresses(current: string[], approved: string[]) {
  const allowed = new Set(approved)
  return (
    allowed.size === current.length
    && current.every(value => allowed.has(value))
  )
}

export async function checkUsenetInbox(localRoot: string) {
  try {
    const allowed = absolutePosixPath(config.usenetInboxPath)
    if (localRoot !== allowed && !insidePath(allowed, localRoot))
      return false

    if (!(await canReadPinnedDirectory(localRoot)))
      return false

    const folderRows = getDb()
      .select({ path: libraryFolders.path })
      .from(libraryFolders)
      .all()
    const denied = [...ownStoragePaths(), ...folderRows.map(row => row.path)]
    for (const path of denied) {
      const physical = await realpath(path).catch(() => path)
      if (overlaps(localRoot, path) || overlaps(localRoot, physical))
        return false
    }
    return true
  }
  catch {
    return false
  }
}

function connectionOf(error: unknown): UsenetConnection {
  if (error instanceof UsenetError) {
    if (
      error.kind === 'invalid'
      || error.kind === 'auth'
      || error.kind === 'category'
      || error.kind === 'needs_confirmation'
      || error.kind === 'address_changed'
      || error.kind === 'unsupported_version'
    ) {
      return error.kind
    }
  }
  if (
    error instanceof TrustedHttpError
    && (error.kind === 'invalid_url' || error.kind === 'blocked_address')
  ) {
    return 'invalid'
  }
  return 'unavailable'
}

async function inspectConnection(
  input: UsenetConfigInput,
  base: { url: string, category: string },
  previous?: UsenetClient,
) {
  let lanAddresses: string[] = []
  try {
    const target = await previewTrustedAddress(new URL(base.url))
    const sameClient = previous?.url === base.url ? previous : undefined
    if (target.private)
      lanAddresses = [...new Set(target.addresses)].sort()

    const classChanged
      = sameClient?.verified
        && Boolean(sameClient.lanAddresses.length) !== target.private
    if (
      classChanged
      && (!input.apiKey
        || !input.lanAddresses
        || !sameAddresses(lanAddresses, input.lanAddresses))
    ) {
      return { connection: 'address_changed' as const, lanAddresses }
    }

    if (target.private) {
      const approved = input.lanAddresses ?? sameClient?.lanAddresses ?? []
      if (!approved.length)
        return { connection: 'needs_confirmation' as const, lanAddresses }
      if (!sameAddresses(lanAddresses, approved))
        return { connection: 'address_changed' as const, lanAddresses }
    }

    const apiKey = checkedKey(input, base.url, previous)
    await checkSab({ ...base, apiKey, lanAddresses })
    return { connection: 'ok' as const, lanAddresses }
  }
  catch (error) {
    return { connection: connectionOf(error), lanAddresses }
  }
}

export async function checkUsenetConfig(
  input: UsenetConfigInput,
): Promise<UsenetConfigCheck> {
  const path = checkPathInput(input)
  let base: ReturnType<typeof normalizeBase>
  try {
    base = normalizeBase(input)
  }
  catch (error) {
    return {
      connection: connectionOf(error),
      pathReadable: await path,
      lanAddresses: [],
    }
  }
  const [result, pathReadable] = await Promise.all([
    inspectConnection(input, base, configuredClient()),
    path,
  ])
  return { ...result, pathReadable }
}

async function checkPathInput(input: UsenetConfigInput) {
  try {
    absolutePosixPath(input.remoteRoot)
    return await checkUsenetInbox(absolutePosixPath(input.localRoot))
  }
  catch {
    return false
  }
}

export async function saveUsenetConfig(input: UsenetConfigInput) {
  const previous = configuredClient()
  const base = {
    ...normalizeBase(input),
    remoteRoot: absolutePosixPath(input.remoteRoot),
    localRoot: absolutePosixPath(input.localRoot),
  }

  if (
    previous
    && !input.enabled
    && !input.apiKey
    && previous.url === base.url
    && previous.category === base.category
    && previous.remoteRoot === base.remoteRoot
    && previous.localRoot === base.localRoot
  ) {
    const updated = getDb()
      .update(usenetClients)
      .set({ enabled: false, followEnabled: false })
      .returning()
      .get()
    return view(updated)
  }

  const [checked, pathReadable] = await Promise.all([
    inspectConnection(input, base, previous),
    checkUsenetInbox(base.localRoot),
  ])
  if (checked.connection !== 'ok')
    throw new UsenetError(checked.connection)
  if (!pathReadable)
    throw new UsenetError('path_unreadable')

  const sameBinding
    = previous?.url === base.url
      && previous.category === base.category
      && (!previous.verified
        || Boolean(previous.lanAddresses.length)
        === Boolean(checked.lanAddresses.length))
  const generation = sameBinding ? previous.generation : randomUUID()
  const apiKey = checkedKey(input, base.url, previous)
  const releaseRestoreFence
    = input.enabled
      && usenetRestoreBlocked()
      && (await restoreQueueKnown(
        { ...base, apiKey, lanAddresses: checked.lanAddresses },
        generation,
      ))

  if (JSON.stringify(previous) !== JSON.stringify(configuredClient()))
    throw new UsenetError('review_required')

  const update = {
    ...base,
    generation,
    encryptedApiKey: encryptSecret(apiKey),
    enabled: input.enabled,
    followEnabled: input.enabled && input.followEnabled,
    lanAddresses: checked.lanAddresses,
    verified: true,
  }
  const db = getDb()
  return db.transaction(() => {
    const saved = db
      .insert(usenetClients)
      .values({ id: 'sabnzbd', ...update })
      .onConflictDoUpdate({ target: usenetClients.id, set: update })
      .returning()
      .get()
    if (releaseRestoreFence)
      setSetting(RESTORE_FENCE, false)
    return view(saved)
  })
}

async function restoreQueueKnown(client: SabClient, generation: string) {
  try {
    const observed = await inspectSabCategory(client)
    if (!observed)
      return false

    const local = getDb()
      .select({ id: usenetJobs.id, nzoId: usenetJobs.nzoId })
      .from(usenetJobs)
      .where(eq(usenetJobs.clientGeneration, generation))
      .all()
    const ids = new Set(local.map(job => job.nzoId))
    const names = new Set(
      local.flatMap(({ id }) => {
        const attempt = sabAttemptName(id)
        return [attempt, `${attempt}.nzb`]
      }),
    )

    return observed.every(
      job =>
        ids.has(job.id)
        || names.has(job.name ?? '')
        || names.has(job.originalName ?? ''),
    )
  }
  catch {
    return false
  }
}

export function usenetHeld() {
  return !!backupRuntime.running || restoreInProgress() || restoreHeld()
}

export function readyUsenet(follow = false) {
  const client = configuredClient()
  return Boolean(
    client?.enabled
    && client.verified
    && (!follow || client.followEnabled)
    && !usenetHeld()
    && !usenetRestoreBlocked(),
  )
}

export function asSabClient(client: UsenetClient): SabClient {
  try {
    return { ...client, apiKey: decryptSecret(client.encryptedApiKey) }
  }
  catch {
    throw new UsenetError('auth')
  }
}
