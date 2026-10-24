import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Device, Profile } from '../db/schema.ts'
import { DEVICE_TOKEN_COOKIE, deviceCookieOptions } from '../config.ts'
import { messageResponse } from '../dto/common.ts'
import {
  confirmedPairing,
  confirmPairing as confirmPairingBody,
  device,
  deviceIdParams,
  deviceList,
  pairing,
  pairingErrorResponse,
  pairingSecretParams,
  pairingStatus,
  startPairing as startPairingBody,
  updateDevice,
} from '../dto/devices.ts'
import { requireOwner } from '../middleware/auth.ts'
import {
  confirmPairing,
  countActivePairings,
  deviceTypeOf,
  isWatching,
  listDevices,
  PairingError,
  pairingPollLimiter,
  pairingStartLimiter,
  pollPairing,
  renameDevice,
  revokeDevice,
  startPairing,
} from '../services/devices/index.ts'
import { notify } from '../services/notifications/index.ts'
import { listProfiles } from '../services/profiles/index.ts'

const guardResponses = {
  401: messageResponse,
}

// Больше действующих кодов разом не бывает у домашнего сервера: остальное —
// перебор или зацикленный клиент
const MAX_ACTIVE_PAIRINGS = 50

const tooMany = { message: 'Too many requests' }

function toDeviceResponse(
  row: Device,
  profiles: Map<string, Profile>,
  now: number,
) {
  const profile = row.profileId ? profiles.get(row.profileId) : undefined

  return {
    id: row.id,
    name: row.name,
    type: row.type,
    profile: profile
      ? {
          id: profile.id,
          name: profile.name,
          color: profile.color,
        }
      : null,
    address: row.lastIp,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    watching: isWatching(row, now),
  }
}

function profilesById() {
  return new Map(listProfiles().map(item => [item.id, item]))
}

export const deviceRoutes: FastifyPluginAsyncZod = async (app) => {
  // Без входа: ТВ ещё не подключён. Код и секрет живут 10 минут
  app.post(
    '/pairing',
    {
      schema: {
        operationId: 'postDevicePairing',
        tags: ['Devices'],
        body: startPairingBody,
        response: { 201: pairing, 429: messageResponse },
      },
    },
    async (request, reply) => {
      if (
        !pairingStartLimiter.hit(request.ip)
        || countActivePairings() >= MAX_ACTIVE_PAIRINGS
      ) {
        return reply.code(429).send(tooMany)
      }

      const userAgent = request.headers['user-agent']
      const started = startPairing({
        type: request.body.type ?? deviceTypeOf(userAgent),
        ip: request.ip,
        userAgent,
      })

      return reply.code(201).send({
        secret: started.secret,
        code: started.code,
        expiresAt: started.expiresAt.toISOString(),
      })
    },
  )

  // Без входа, по секрету. После подтверждения отдаёт cookie устройства
  // один раз: следующий опрос с тем же секретом — 404
  app.get(
    '/pairing/:secret',
    {
      schema: {
        operationId: 'getDevicePairing',
        tags: ['Devices'],
        params: pairingSecretParams,
        response: {
          200: pairingStatus,
          400: messageResponse,
          404: messageResponse,
          429: messageResponse,
        },
      },
    },
    async (request, reply) => {
      if (!pairingPollLimiter.hit(request.ip))
        return reply.code(429).send(tooMany)

      const result = pollPairing(request.params.secret)

      if (!result)
        return reply.code(404).send({ message: 'Pairing not found' })

      if (result.status !== 'approved') {
        return {
          status: result.status,
          expiresAt: result.expiresAt.toISOString(),
          device: null,
        }
      }

      reply.setCookie(DEVICE_TOKEN_COOKIE, result.token, deviceCookieOptions)

      return {
        status: result.status,
        expiresAt: result.expiresAt.toISOString(),
        device: { id: result.device.id, name: result.device.name },
      }
    },
  )

  app.post(
    '/pairing/confirm',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'postDevicePairingConfirm',
        tags: ['Devices'],
        body: confirmPairingBody,
        response: {
          200: confirmedPairing,
          400: messageResponse,
          ...guardResponses,
          422: pairingErrorResponse,
        },
      },
    },
    async (request, reply) => {
      try {
        const confirmed = confirmPairing({
          code: request.body.code,
          name: request.body.name,
          userId: request.userId,
        })

        // След на случай чужой сессии: устройство подтверждает только владелец
        notify({
          kind: 'device_paired',
          severity: 'info',
          section: 'people',
          params: { name: confirmed.name, type: confirmed.type },
        })

        return confirmed
      }
      catch (err) {
        if (err instanceof PairingError)
          return reply.code(422).send({ message: err.message, kind: err.kind })

        throw err
      }
    },
  )

  app.get(
    '',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getDevices',
        tags: ['Devices'],
        response: { 200: deviceList, ...guardResponses },
      },
    },
    async () => {
      const profiles = profilesById()
      const now = Date.now()

      return {
        items: listDevices().map(row => toDeviceResponse(row, profiles, now)),
      }
    },
  )

  app.patch(
    '/:id',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'patchDevice',
        tags: ['Devices'],
        params: deviceIdParams,
        body: updateDevice,
        response: {
          200: device,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const updated = renameDevice(request.params.id, request.body.name)

      if (!updated)
        return reply.code(404).send({ message: 'Device not found' })

      return toDeviceResponse(updated, profilesById(), Date.now())
    },
  )

  // Отзыв токена: устройству придётся подключиться заново по коду
  app.delete(
    '/:id',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'deleteDevice',
        tags: ['Devices'],
        params: deviceIdParams,
        response: {
          200: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!revokeDevice(request.params.id))
        return reply.code(404).send({ message: 'Device not found' })

      return { message: 'Device revoked' }
    },
  )
}
