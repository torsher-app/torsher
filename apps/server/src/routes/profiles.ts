import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { Profile } from '../db/schema.ts'
import { PROFILE_COOKIE, sessionCookieOptions } from '../config.ts'
import { messageResponse } from '../dto/common.ts'
import {
  createProfile as createProfileBody,
  deleteProfileQuery,
  pinErrorResponse,
  profile,
  profileIdParams,
  profileList,
  selectProfile,
  setProfilePin,
  updateProfile as updateProfileBody,
} from '../dto/profiles.ts'
import {
  profileHistoryQuery,
  profileHistory as profileHistoryResponse,
} from '../dto/mine.ts'
import { requireByRoute } from '../middleware/auth.ts'
import { profileHistory } from '../services/mine/history.ts'
import { selectDeviceProfile } from '../services/devices/index.ts'
import {
  checkPinAttempt,
  createProfile,
  deleteProfile,
  getProfile,
  LastProfileError,
  listProfiles,
  PinLockedError,
  setPin,
  updateProfile,
  verifyPin,
} from '../services/profiles/index.ts'
import { hashPassword } from '../utils/password.ts'

const guardResponses = {
  401: messageResponse,
}

// Выбор профиля в сессии владельца живёт в cookie браузера, как и сессия
const profileCookieOptions = {
  ...sessionCookieOptions,
  maxAge: 400 * 24 * 60 * 60,
} as const

/** Хеш PIN наружу не уходит: только признак, что PIN задан */
export function toProfileResponse(row: Profile) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    language: row.language,
    hasPin: !!row.pinHash,
    ageLimit: row.ageLimit as 6 | 12 | 16 | 18 | null,
    posterRating: row.posterRating,
  }
}

const notFound = { message: 'Profile not found' }

export const profileRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireByRoute)

  // Список для экрана выбора профиля на ТВ и для панели
  app.get(
    '',
    {
      config: { viewer: true },
      schema: {
        operationId: 'getProfiles',
        tags: ['Profiles'],
        response: { 200: profileList, ...guardResponses },
      },
    },
    async request => ({
      items: listProfiles().map(toProfileResponse),
      currentId: request.profileId,
      selected: request.profileSelected,
    }),
  )

  app.post(
    '',
    {
      schema: {
        operationId: 'postProfile',
        tags: ['Profiles'],
        body: createProfileBody,
        response: { 201: profile, 400: messageResponse, ...guardResponses },
      },
    },
    async (request, reply) => {
      const { pin, ...input } = request.body
      const created = createProfile({
        name: input.name,
        color: input.color,
        language: input.language ?? null,
        ageLimit: input.ageLimit ?? null,
        posterRating: input.posterRating,
        pinHash: pin ? await hashPassword(pin) : undefined,
      })

      return reply.code(201).send(toProfileResponse(created))
    },
  )

  app.patch(
    '/:id',
    {
      schema: {
        operationId: 'patchProfile',
        tags: ['Profiles'],
        params: profileIdParams,
        body: updateProfileBody,
        response: {
          200: profile,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!getProfile(request.params.id))
        return reply.code(404).send(notFound)

      // Drizzle пропускает поля `undefined`, а пустой набор — ошибка:
      // пустой PATCH просто отвечает профилем
      const updated = Object.values(request.body).some(v => v !== undefined)
        ? updateProfile(request.params.id, request.body)
        : getProfile(request.params.id)

      return toProfileResponse(updated!)
    },
  )

  // История профиля — только владельцу: витрина видит свои разделы «Моё»
  app.get(
    '/:id/history',
    {
      schema: {
        operationId: 'getProfileHistory',
        tags: ['Profiles'],
        params: profileIdParams,
        querystring: profileHistoryQuery,
        response: {
          200: profileHistoryResponse,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!getProfile(request.params.id))
        return reply.code(404).send(notFound)

      return profileHistory(request.params.id, request.query)
    },
  )

  app.delete(
    '/:id',
    {
      schema: {
        operationId: 'deleteProfile',
        tags: ['Profiles'],
        params: profileIdParams,
        querystring: deleteProfileQuery,
        response: {
          200: messageResponse,
          400: messageResponse,
          404: messageResponse,
          409: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params
      const { moveTo } = request.query

      if (!getProfile(id))
        return reply.code(404).send(notFound)

      if (moveTo && (moveTo === id || !getProfile(moveTo))) {
        return reply
          .code(400)
          .send({ message: 'The target profile does not exist' })
      }

      try {
        deleteProfile(id, moveTo)
      }
      catch (err) {
        if (err instanceof LastProfileError)
          return reply.code(409).send({ message: err.message })

        throw err
      }

      return { message: 'Profile deleted' }
    },
  )

  app.put(
    '/:id/pin',
    {
      schema: {
        operationId: 'putProfilePin',
        tags: ['Profiles'],
        params: profileIdParams,
        body: setProfilePin,
        response: {
          200: profile,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const updated = await setPin(request.params.id, request.body.pin)

      return updated
        ? toProfileResponse(updated)
        : reply.code(404).send(notFound)
    },
  )

  app.delete(
    '/:id/pin',
    {
      schema: {
        operationId: 'deleteProfilePin',
        tags: ['Profiles'],
        params: profileIdParams,
        response: { 200: profile, 404: messageResponse, ...guardResponses },
      },
    },
    async (request, reply) => {
      const updated = await setPin(request.params.id, null)

      return updated
        ? toProfileResponse(updated)
        : reply.code(404).send(notFound)
    },
  )

  // Делает профиль текущим: у устройства — в базе, у сессии владельца — в cookie
  app.post(
    '/:id/select',
    {
      config: { viewer: true },
      schema: {
        operationId: 'postProfileSelect',
        tags: ['Profiles'],
        params: profileIdParams,
        body: selectProfile,
        response: {
          200: profile,
          400: messageResponse,
          403: pinErrorResponse,
          404: messageResponse,
          429: pinErrorResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const found = getProfile(request.params.id)

      if (!found)
        return reply.code(404).send(notFound)

      try {
        const attempt = await checkPinAttempt(
          found.id,
          request.deviceId ?? `owner:${request.userId}`,
          () => verifyPin(found, request.body.pin),
        )

        if (!attempt.ok) {
          return reply.code(403).send({
            message: 'Wrong PIN',
            kind: 'wrong_pin',
            attemptsLeft: attempt.attemptsLeft,
            retryAfter: null,
          })
        }
      }
      catch (err) {
        if (!(err instanceof PinLockedError))
          throw err

        return reply.code(429).send({
          message: err.message,
          kind: 'locked',
          attemptsLeft: null,
          retryAfter: err.retryAfter,
        })
      }

      if (request.deviceId)
        selectDeviceProfile(request.deviceId, found.id)
      else reply.setCookie(PROFILE_COOKIE, found.id, profileCookieOptions)

      return toProfileResponse(found)
    },
  )
}
