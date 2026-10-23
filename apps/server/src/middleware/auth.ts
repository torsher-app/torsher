import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Device } from '../db/schema.ts'
import {
  ACCESS_TOKEN_COOKIE,
  DEVICE_TOKEN_COOKIE,
  deviceCookieOptions,
  PROFILE_COOKIE,
} from '../config.ts'
import {
  deviceByToken,
  getDevice,
  markStreaming,
  touchDevice,
} from '../services/devices/index.ts'
import { defaultProfile, getProfile } from '../services/profiles/index.ts'
import { verifySession } from '../services/users/session.ts'
import { verifyTokenFor } from '../utils/token.ts'

declare module 'fastify' {
  interface FastifyRequest {
    /** Владелец; у запроса устройства — пустая строка */
    userId: string
    /** Устройство, подключённое по коду; у сессии владельца — null */
    deviceId: string | null
    /** Профиль зрителя: его позиции, прогресс и язык */
    profileId: string
    /** Профиль выбран явно; иначе `profileId` — профиль по умолчанию */
    profileSelected: boolean
  }

  interface FastifyContextConfig {
    /** Роут витрины в плагине панели: пускает и токен устройства */
    viewer?: boolean
  }
}

// cookie продлевается, когда устройство не заходило дольше суток
const DEVICE_COOKIE_RENEW_MS = 24 * 60 * 60 * 1000
// Токен потока устройства подписан на `device:<id>`: так поток знает,
// чей он, и перестаёт открываться сразу после отзыва устройства
const DEVICE_SUBJECT_PREFIX = 'device:'

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ message: 'Unauthorized' })
}

/** Владелец по access-cookie; токен отозванной сессии (сменился пароль или email) не проходит */
function ownerIdOf(request: FastifyRequest) {
  const token = request.cookies[ACCESS_TOKEN_COOKIE] ?? ''

  try {
    return verifySession(token, 'user_access').userId
  }
  catch {
    return undefined
  }
}

// Выбранный профиль могли удалить: тогда зритель снова смотрит профилем по умолчанию
function setProfile(
  request: FastifyRequest,
  selectedId: string | null | undefined,
) {
  const selected = selectedId ? getProfile(selectedId) : undefined

  request.profileId = selected?.id ?? defaultProfile().id
  request.profileSelected = !!selected
}

function asDevice(request: FastifyRequest, device: Device) {
  request.deviceId = device.id
  setProfile(request, device.profileId)
}

/**
 * Панель и настройки сервера: только сессия владельца. Токен устройства
 * сюда не пускает — им открыта лишь витрина.
 */
export async function requireOwner(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const userId = ownerIdOf(request)

  if (!userId)
    return unauthorized(reply)

  request.userId = userId
}

/**
 * Витрина: токен устройства из cookie или сессия владельца. Кладёт в запрос
 * устройство и профиль; без выбранного профиля — профиль по умолчанию.
 * Отозванное устройство получает 401 на первом же запросе.
 */
export async function requireViewer(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const token = request.cookies[DEVICE_TOKEN_COOKIE]

  if (token) {
    const device = deviceByToken(token)

    if (device) {
      const stale
        = !device.lastSeenAt
          || Date.now() - device.lastSeenAt.getTime() > DEVICE_COOKIE_RENEW_MS

      if (
        touchDevice(device, {
          ip: request.ip,
          userAgent: request.headers['user-agent'],
        })
        && stale
      ) {
        reply.setCookie(DEVICE_TOKEN_COOKIE, token, deviceCookieOptions)
      }

      asDevice(request, device)
      return
    }

    reply.clearCookie(DEVICE_TOKEN_COOKIE, { path: deviceCookieOptions.path })
  }

  const userId = ownerIdOf(request)

  if (!userId)
    return unauthorized(reply)

  request.userId = userId
  setProfile(request, request.cookies[PROFILE_COOKIE])
}

/**
 * Хук плагина, где роуты панели и витрины живут вместе: роут с
 * `config.viewer` открыт и устройству, остальные — только владельцу.
 */
export function requireByRoute(request: FastifyRequest, reply: FastifyReply) {
  return request.routeOptions.config.viewer
    ? requireViewer(request, reply)
    : requireOwner(request, reply)
}

/**
 * Может ли запрос перекладывать общую библиотеку (тайтл раздачи): сессия
 * владельца — всегда, устройство — только с профилем без возрастного порога.
 */
export function canManageLibrary(request: FastifyRequest) {
  if (request.userId)
    return true

  return getProfile(request.profileId)?.ageLimit === null
}

/** Подпись токена потока: устройство или владелец */
export function streamSubjectOf(request: FastifyRequest) {
  return request.deviceId
    ? `${DEVICE_SUBJECT_PREFIX}${request.deviceId}`
    : request.userId
}

/**
 * Поток из `<video>`: токен потока из адреса (сессию он не обновит) или,
 * без него, то же, что у витрины. Запрос потока устройства отмечает его
 * «смотрит сейчас».
 */
export async function requireStream(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const { token } = request.query as { token?: string }

  if (!token) {
    await requireViewer(request, reply)
  }
  else {
    let subject: string

    try {
      subject = verifyTokenFor(token, 'stream').userId
    }
    catch {
      return unauthorized(reply)
    }

    if (subject.startsWith(DEVICE_SUBJECT_PREFIX)) {
      const device = getDevice(subject.slice(DEVICE_SUBJECT_PREFIX.length))

      if (!device)
        return unauthorized(reply)

      asDevice(request, device)
    }
    else {
      // Поток владельца несёт версию сессий: после смены пароля он закрывается
      try {
        request.userId = verifySession(token, 'stream').userId
      }
      catch {
        return unauthorized(reply)
      }
    }
  }

  if (request.deviceId)
    markStreaming(request.deviceId)
}
