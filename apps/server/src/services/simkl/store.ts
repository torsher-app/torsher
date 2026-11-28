import type { SimklConnection, SimklOutbound } from '../../db/schema.ts'
import type { Grant } from './client.ts'
import { and, eq, sql } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { simklConnections, simklOutbox, simklReceipts } from '../../db/schema.ts'
import { decryptSecret, encryptSecret } from '../secrets/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { grantSchema, SimklError } from './client.ts'

export function connectionOf(profileId: string) {
  return getDb().select().from(simklConnections).where(eq(simklConnections.profileId, profileId)).get()
}

export function connectionKey(connection: SimklConnection) {
  return and(eq(simklConnections.profileId, connection.profileId), eq(simklConnections.generation, connection.generation))
}

export function outboundKey(row: SimklOutbound) {
  return and(eq(simklOutbox.profileId, row.profileId), eq(simklOutbox.attemptId, row.attemptId), eq(simklOutbox.generation, row.generation))
}

export function setConnection(connection: SimklConnection, data: Partial<SimklConnection>) {
  getDb().update(simklConnections).set(data).where(connectionKey(connection)).run()
}

export function requireCurrent(connection: SimklConnection, signal: AbortSignal, direction?: 'pull' | 'push') {
  signal.throwIfAborted()
  const current = connectionOf(connection.profileId)
  if (current?.generation !== connection.generation || current.reauthorize
    || current.clientId !== config.simklClientId || (direction && !current[direction])) {
    throw new SimklError('expired')
  }
  return current
}

export function sealGrant(grant: Grant) {
  return encryptSecret(JSON.stringify(grant))
}

export function openGrant(connection: SimklConnection) {
  return grantSchema.parse(JSON.parse(decryptSecret(connection.grant)))
}

export function receiptKey(connection: SimklConnection, remoteKey: string) {
  return and(
    eq(simklReceipts.profileId, connection.profileId),
    eq(simklReceipts.accountFingerprint, connection.accountFingerprint),
    eq(simklReceipts.remoteKey, remoteKey),
  )
}

export function receiptOf(connection: SimklConnection, remoteKey: string) {
  return getDb().select().from(simklReceipts).where(receiptKey(connection, remoteKey)).get()
}

export function outboxStats(profileId: string) {
  return getDb().select({
    pending: sql<number>`coalesce(sum(state != 'attention'), 0)`,
    issues: sql<number>`coalesce(sum(state = 'attention'), 0)`,
  }).from(simklOutbox).where(eq(simklOutbox.profileId, profileId)).get()!
}

export function enqueueSimklCompletion(ref: {
  profileId: string
  titleId: string
  season: number
  episode: number
}, attemptId: string, diaryId: string, now: number) {
  const title = parseCatalogId(ref.titleId)
  const expectedType = ref.episode > 0 ? 'tv' : 'movie'
  if (!config.simklClientId || title?.type !== expectedType)
    return

  const connection = connectionOf(ref.profileId)
  if (!connection?.push || connection.scope !== 'write' || connection.reauthorize
    || connection.clientId !== config.simklClientId) {
    return
  }
  const { pending, issues } = outboxStats(ref.profileId)
  if (pending + issues >= 10_000) {
    setConnection(connection, { overflow: connection.overflow + 1 })
    return
  }

  getDb().insert(simklOutbox).values({
    ...ref,
    attemptId,
    generation: connection.generation,
    diaryId,
    watchedAt: Math.floor(now / 1000) * 1000,
    nextTryAt: now,
  }).onConflictDoNothing().run()
}
