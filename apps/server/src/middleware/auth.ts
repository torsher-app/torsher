import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Device } from '../db/schema.ts'
import {
  ACCESS_TOKEN_COOKIE,
  config,
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
import { guessServerAudio } from '../services/follow/audio.ts'
import { defaultProfile, getProfile } from '../services/profiles/index.ts'
import { needsSetup } from '../services/users/index.ts'
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
    /**
     * Профиль выбран явно; иначе `profileId` — профиль по умолчанию, а у
     * устройства при PIN на нём — пустая строка (профиль надо выбрать)
     */
    profileSelected: boolean
    /** Пропущен без входа: аккаунта ещё не было (`requireOwnerOrFirstRun`) */
    firstRun?: boolean
  }

  interface FastifyContextConfig {
    /** Роут витрины в плагине панели: пускает и токен устройства */
    viewer?: boolean
    /** Роут витрины открыт устройству без профиля: список и выбор профиля */
    allowNoProfile?: boolean
  }
}

// cookie продлевается, когда устройство не заходило дольше суток
const DEVICE_COOKIE_RENEW_MS = 24 * 60 * 60 * 1000
// Токен потока устройства подписан на `device:<id>`: так поток знает,
// чей он, и перестаёт открываться сразу после отзыва устройства
const DEVICE_SUBJECT_PREFIX = 'device:'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
const SAME_ORIGIN_FETCHES = new Set(['same-origin', 'none'])

/**
 * Изменение с чужого сайта под cookie владельца. SameSite=Lax не спасает от
 * соседнего сервиса того же «site» (другой порт или поддомен в домашней сети).
 * Запрос без `Sec-Fetch-Site` пропускаем: его не шлют старые браузеры и
 * не-браузерные клиенты, а современный браузер жертвы странице убрать этот
 * заголовок не даёт.
 */
function isCrossSite(request: FastifyRequest) {
  if (SAFE_METHODS.has(request.method))
    return false

  const site = request.headers['sec-fetch-site']

  if (!site || SAME_ORIGIN_FETCHES.has(site))
    return false

  return !config.clientUrl || request.headers.origin !== config.clientUrl
}

// Своя сериализация: у роута 403 может быть описан другой схемой
// (неверный пароль, PIN), и валидатор ответа превратил бы отказ в 500
function crossSiteRejected(reply: FastifyReply) {
  return reply
    .code(403)
    .serializer(JSON.stringify)
    .send({ message: 'cross_site_request' })
}

function unauthorized(reply: FastifyReply) {
  return reply.code(401).send({ message: 'Unauthorized' })
}

/** Владелец по access-cookie; токен отозванной сессии (сменился пароль или имя пользователя) не проходит */
function ownerIdOf(request: FastifyRequest) {
  const token = request.cookies[ACCESS_TOKEN_COOKIE] ?? ''

  try {
    return verifySession(token, 'user_access').userId
  }
  catch {
    return undefined
  }
}

/**
 * Выбранный профиль могли удалить: тогда зритель снова смотрит профилем по
 * умолчанию. Устройству профиль с PIN сам не подставляется — иначе PIN
 * обходился бы, пока на ТВ профиль не выбран.
 */
function setProfile(
  request: FastifyRequest,
  selectedId: string | null | undefined,
  isDevice = false,
) {
  const selected = selectedId ? getProfile(selectedId) : undefined

  request.profileSelected = !!selected

  if (selected) {
    request.profileId = selected.id
    return
  }

  const fallback = defaultProfile()

  request.profileId = isDevice && fallback.pinHash ? '' : fallback.id
}

function asDevice(request: FastifyRequest, device: Device) {
  request.deviceId = device.id
  setProfile(request, device.profileId, true)
}

function profileRequired(reply: FastifyReply) {
  return reply
    .code(403)
    .serializer(JSON.stringify)
    .send({ message: 'profile_required' })
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

  if (isCrossSite(request))
    return crossSiteRejected(reply)

  request.userId = userId
  guessServerAudio(request.headers['accept-language'])
}

/**
 * Пока аккаунта нет, роут открыт без входа — то же окно, что у создания
 * аккаунта (восстановление из копии на пустом сервере); дальше — владелец.
 * Такой запрос помечен `firstRun`, `userId` у него пустой. Тело читается
 * после хука сколь угодно долго: обработчик перед действием обязан снова
 * проверить, что аккаунта всё ещё нет (`firstRunExpired`).
 */
export async function requireOwnerOrFirstRun(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (needsSetup()) {
    if (isCrossSite(request))
      return crossSiteRejected(reply)

    request.userId = ''
    request.firstRun = true
    return
  }

  return requireOwner(request, reply)
}

/** Запрос пропущен без входа, а аккаунт с тех пор создали: дальше нельзя */
export function firstRunExpired(request: FastifyRequest) {
  return request.firstRun === true && !needsSetup()
}

/**
 * Витрина: токен устройства из cookie или сессия владельца. Кладёт в запрос
 * устройство и профиль; без выбранного профиля — профиль по умолчанию.
 * Устройство без выбранного профиля при PIN на профиле по умолчанию получает
 * 403 `profile_required` везде, кроме роутов с `config.allowNoProfile`.
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

      if (!request.profileId && !request.routeOptions.config.allowNoProfile)
        return profileRequired(reply)

      guessServerAudio(request.headers['accept-language'])
      return
    }

    reply.clearCookie(DEVICE_TOKEN_COOKIE, { path: deviceCookieOptions.path })
  }

  const userId = ownerIdOf(request)

  if (!userId)
    return unauthorized(reply)

  request.userId = userId
  setProfile(request, request.cookies[PROFILE_COOKIE])
  guessServerAudio(request.headers['accept-language'])
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

    if (reply.sent)
      return reply
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

      if (!request.profileId)
        return profileRequired(reply)
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
