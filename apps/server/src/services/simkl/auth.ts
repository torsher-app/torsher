import type { SimklConnection } from '../../db/schema.ts'
import type { SimklScope, SimklStatus } from '../../dto/simkl.ts'
import type { Grant } from './client.ts'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { config } from '../../config.ts'
import { getDb } from '../../db/index.ts'
import { profiles, simklConnections } from '../../db/schema.ts'
import {
  grantScope,
  identifyAccount,
  redeemDevice,
  refreshGrant,
  requestDevice,
  revokeGrant,
  SimklError,
  SimklRequestError,
  SimklSession,
} from './client.ts'
import { simklAccountFingerprint } from './identity.ts'
import { connectionKey, connectionOf, openGrant, requireCurrent, sealGrant, setConnection } from './store.ts'

interface Challenge {
  clientId: string
  scope: SimklScope
  controller: AbortController
  device?: Awaited<ReturnType<typeof requestDevice>>
  expiresAt: number
  nextPollAt: number
  interval: number
  polling: boolean
  timer?: ReturnType<typeof setTimeout>
}

const challenges = new Map<string, Challenge>()
const revokeWarnings = new Set<string>()

export function cancelSimklDevice(profileId: string) {
  const challenge = challenges.get(profileId)
  challenges.delete(profileId)
  challenge?.controller.abort()
  clearTimeout(challenge?.timer)
}

export function stopSimklAuthorizations() {
  for (const profileId of challenges.keys())
    cancelSimklDevice(profileId)
}

export function deviceStatus(profileId: string): SimklStatus['challenge'] {
  const challenge = challenges.get(profileId)
  if (!challenge?.device)
    return null
  return {
    scope: challenge.scope,
    userCode: challenge.device.user_code,
    verificationUri: challenge.device.verification_uri,
    expiresAt: new Date(challenge.expiresAt).toISOString(),
    nextPollAt: new Date(challenge.nextPollAt).toISOString(),
  }
}

export function revokeWarning(profileId: string) {
  return revokeWarnings.has(profileId)
}

async function revoke(profileId: string, clientId: string, grant: Grant) {
  try {
    await revokeGrant(clientId, grant)
  }
  catch {
    if (getDb().select({ id: profiles.id }).from(profiles).where(eq(profiles.id, profileId)).get())
      revokeWarnings.add(profileId)
  }
}

function revokeConnection(connection: SimklConnection, replacement?: Grant) {
  // Decrypt before retaining anything in the revocation closure.
  try {
    const grant = openGrant(connection)
    if (replacement && grant.refresh_token === replacement.refresh_token)
      return Promise.resolve()
    return revoke(connection.profileId, connection.clientId, grant)
  }
  catch {
    revokeWarnings.add(connection.profileId)
    return Promise.resolve()
  }
}

/** Called after the profile transaction (which cascades the live binding). */
export function forgetSimklProfile(profileId: string, connection: SimklConnection | undefined) {
  cancelSimklDevice(profileId)
  revokeWarnings.delete(profileId)
  if (connection)
    void revokeConnection(connection)
}

export function removeSimklConnection(profileId: string, connection = connectionOf(profileId)) {
  cancelSimklDevice(profileId)
  if (!connection)
    return
  getDb().delete(simklConnections).where(connectionKey(connection)).run()
  return revokeConnection(connection)
}

export async function connectSimklDevice(profileId: string, scope: SimklScope) {
  const clientId = config.simklClientId
  if (!clientId)
    throw new SimklError('unavailable')
  if (challenges.has(profileId))
    throw new SimklError('busy')

  const challenge: Challenge = {
    clientId,
    scope,
    controller: new AbortController(),
    expiresAt: 0,
    nextPollAt: 0,
    interval: 0,
    polling: false,
  }
  challenges.set(profileId, challenge)
  try {
    const device = await requestDevice(clientId, scope, challenge.controller.signal)
    if (challenges.get(profileId) !== challenge)
      throw new SimklError('expired')
    challenge.device = device
    challenge.interval = device.interval * 1000
    challenge.expiresAt = Date.now() + device.expires_in * 1000
    challenge.nextPollAt = Date.now() + challenge.interval
    challenge.timer = setTimeout(() => {
      if (challenges.get(profileId) === challenge)
        cancelSimklDevice(profileId)
    }, device.expires_in * 1000).unref()
  }
  catch (error) {
    if (challenges.get(profileId) === challenge)
      cancelSimklDevice(profileId)
    throw error
  }
}

export async function pollSimklDevice(profileId: string, abortTask: () => void) {
  const challenge = challenges.get(profileId)
  if (!challenge?.device || challenge.clientId !== config.simklClientId || challenge.expiresAt <= Date.now())
    throw new SimklError('expired')
  if (challenge.polling || challenge.nextPollAt > Date.now())
    return
  challenge.polling = true

  let grant: Grant | undefined
  let saved = false
  let activeGrant = false
  try {
    // Do not abort a dispatched redemption. A late response must be revoked.
    grant = await redeemDevice(challenge.clientId, challenge.device.device_code)
    const scope = grantScope(grant)
    if (scope !== challenge.scope)
      throw new SimklError('scope')
    if (challenges.get(profileId) !== challenge)
      throw new SimklError('expired')
    const identity = await identifyAccount(challenge.clientId, grant.access_token)
    const accountFingerprint = simklAccountFingerprint(identity.account.id)
    if (challenges.get(profileId) !== challenge || config.simklClientId !== challenge.clientId)
      throw new SimklError('expired')

    const db = getDb()
    const previous = db.transaction(() => {
      const inUse = db.select().from(simklConnections).where(eq(simklConnections.accountFingerprint, accountFingerprint)).get()
      if (inUse && inUse.profileId !== profileId) {
        try {
          activeGrant = openGrant(inUse).refresh_token === grant!.refresh_token
        }
        catch {
          // If the existing token cannot be compared, do not risk revoking it.
          activeGrant = true
        }
        throw new SimklError('identity')
      }
      const current = connectionOf(profileId)
      if (current)
        db.delete(simklConnections).where(connectionKey(current)).run()
      db.insert(simklConnections).values({
        profileId,
        generation: randomUUID(),
        accountFingerprint,
        account: identity.user.name,
        clientId: challenge.clientId,
        grant: sealGrant(grant!),
        expiresAt: Date.now() + grant!.expires_in * 1000,
        scope,
        pull: current?.accountFingerprint === accountFingerprint && current.pull,
      }).run()
      return current
    })
    saved = true
    revokeWarnings.delete(profileId)
    abortTask()
    cancelSimklDevice(profileId)
    if (previous)
      await revokeConnection(previous, grant)
  }
  catch (error) {
    if (grant && !saved && !activeGrant) {
      const current = connectionOf(profileId)
      try {
        activeGrant = !!current && openGrant(current).refresh_token === grant.refresh_token
      }
      catch {
        activeGrant = true
      }
      if (!activeGrant)
        await revoke(profileId, challenge.clientId, grant)
    }
    if (challenges.get(profileId) !== challenge)
      throw new SimklError('expired')
    if (!grant && error instanceof SimklRequestError) {
      if (error.code === 'authorization_pending')
        return
      if (error.code === 'slow_down' || error.status === 429) {
        challenge.interval += 5000
        return
      }
      if (error.code === 'access_denied' || error.code === 'expired_token') {
        cancelSimklDevice(profileId)
        throw new SimklError(error.code === 'access_denied' ? 'denied' : 'expired')
      }
      if (error.ambiguous) {
        challenge.interval *= 2
        return
      }
    }
    cancelSimklDevice(profileId)
    throw error
  }
  finally {
    challenge.nextPollAt = Date.now() + challenge.interval
    challenge.polling = false
  }
}

export async function sessionFor(connection: SimklConnection, signal: AbortSignal) {
  const current = requireCurrent(connection, signal)
  let grant: Grant
  try {
    grant = openGrant(current)
  }
  catch {
    setConnection(current, { reauthorize: true })
    throw new SimklError('expired')
  }
  if (current.expiresAt - 60_000 <= Date.now()) {
    grant = await refreshGrant(current.clientId, grant, signal)
    requireCurrent(current, signal)
    if (grantScope(grant) !== current.scope) {
      setConnection(current, { reauthorize: true })
      throw new SimklError('scope')
    }
    setConnection(current, {
      grant: sealGrant(grant),
      expiresAt: Date.now() + grant.expires_in * 1000,
    })
  }
  return new SimklSession(current.clientId, grant.access_token, signal)
}
