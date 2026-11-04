import type { FastifyReply, FastifyRequest } from 'fastify'
import { randomBytes, randomUUID } from 'node:crypto'
import { getDb } from '../../db/index.ts'
import { devices } from '../../db/schema.ts'
import { deviceByToken, hashToken, touchDevice } from '../devices/index.ts'
import { defaultProfile, getProfile } from '../profiles/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import { findOwner } from '../users/index.ts'

// Protocol compatibility baseline, independent of the Torsher release number.
export const COMPATIBILITY_VERSION = '10.10.7'

export function serverId() {
  return getDb().transaction(() => {
    let id = getSetting<string>('jellyfin.serverId')
    if (!id) {
      id = randomUUID().replaceAll('-', '')
      setSetting('jellyfin.serverId', id)
    }
    return id
  })
}

export function authorizationFields(request: FastifyRequest) {
  const result: Record<string, string> = {}
  for (const name of ['authorization', 'x-emby-authorization']) {
    const value = request.headers[name]
    if (typeof value !== 'string' || !/^(?:MediaBrowser|Emby)\s/i.test(value))
      continue
    for (const match of value.matchAll(/(\w+)\s*=\s*"([^"\r\n]*)"/g))
      result[match[1]!.toLowerCase()] = match[2]!
  }
  return result
}

/** Reject ambiguity instead of silently selecting a credential with greater privileges. */
export function facadeToken(request: FastifyRequest) {
  const tokens: string[] = []
  for (const name of ['x-emby-token', 'x-mediabrowser-token']) {
    const value = request.headers[name]
    if (Array.isArray(value))
      tokens.push(...value)
    else if (value !== undefined)
      tokens.push(value)
  }
  for (const name of ['authorization', 'x-emby-authorization']) {
    const value = request.headers[name]
    if (typeof value !== 'string')
      continue
    if (!/^(?:MediaBrowser|Emby)\s/i.test(value)) {
      if (name === 'authorization')
        return undefined
      continue
    }
    for (const match of value.matchAll(/\bToken\s*=\s*"([^"\r\n]*)"/gi))
      tokens.push(match[1]!)
  }
  const query = new URL(request.url, 'http://localhost').searchParams
  for (const [name, value] of query) {
    if (['api_key', 'apikey'].includes(name.toLowerCase()))
      tokens.push(value)
  }
  return tokens.length
    && tokens.every(token => token.length > 0 && token === tokens[0])
    ? tokens[0]
    : undefined
}

export async function requireJellyfin(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = facadeToken(request)
  const device = token ? deviceByToken(token) : undefined
  const owner = device?.purpose === 'jellyfin' ? findOwner() : undefined
  if (
    !device
    || device.purpose !== 'jellyfin'
    || !owner
    || !owner.isActive
    || owner.isBanned
    || owner.isDeleted
    || device.ownerSessionVersion !== owner.sessionVersion
    || !device.profileId
    || !getProfile(device.profileId)
  ) {
    return reply.code(401).send({ message: 'Unauthorized' })
  }
  request.deviceId = device.id
  request.profileId = device.profileId
  request.profileSelected = true
  touchDevice(device, {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
  })
}

export function issueDevice(
  request: FastifyRequest,
  ownerSessionVersion: number,
) {
  const fields = authorizationFields(request)
  const token = randomBytes(32).toString('base64url')
  const device = getDb()
    .insert(devices)
    .values({
      name: `${fields.client || 'Jellyfin-compatible player'}${fields.device ? ` (${fields.device})` : ''}`.slice(
        0,
        200,
      ),
      type: 'other',
      purpose: 'jellyfin',
      tokenHash: hashToken(token),
      profileId: defaultProfile().id,
      ownerSessionVersion,
      lastIp: request.ip,
      userAgent: request.headers['user-agent']?.slice(0, 500),
      lastSeenAt: new Date(),
    })
    .returning()
    .get()
  return { device, token, fields }
}

export function userDto(profileId: string) {
  const profile = getProfile(profileId)!
  return {
    Id: profile.id.replaceAll('-', ''),
    Name: profile.name,
    ServerId: serverId(),
    HasPassword: true,
    HasConfiguredPassword: true,
    HasConfiguredEasyPassword: false,
    Configuration: { EnableNextEpisodeAutoPlay: true },
    Policy: {
      IsAdministrator: false,
      IsHidden: true,
      IsDisabled: false,
      EnableMediaPlayback: true,
      EnableAudioPlaybackTranscoding: false,
      EnableVideoPlaybackTranscoding: false,
      EnablePlaybackRemuxing: false,
      EnableContentDownloading: false,
      EnableRemoteControlOfOtherUsers: false,
    },
  }
}
