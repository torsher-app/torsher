import type { Device, DeviceType } from '../../db/schema.ts'
import { createHash, randomBytes, randomInt } from 'node:crypto'
import { and, asc, desc, eq, gt, lt } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { devicePairings, devices } from '../../db/schema.ts'
import { createRateLimiter } from '../../utils/rateLimit.ts'

// Код живёт 10 минут: хватает дойти до компьютера, а подбирать его некогда
export const PAIRING_TTL_MS = 10 * 60 * 1000
export const PAIRING_CODE_LENGTH = 6
// Без похожих символов: 0/O и 1/I на экране ТВ легко перепутать
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
// Просроченный код помнится сутки, чтобы ответить «код истёк», а не «неверный»
const PAIRING_KEEP_MS = 24 * 60 * 60 * 1000
// Подтверждённый в последний момент код ещё минуту ждёт, пока ТВ заберёт токен
const CLAIM_GRACE_MS = 60 * 1000
// Чаще одного раза в минуту время последнего запроса не пишем
const SEEN_THROTTLE_MS = 60 * 1000
const STREAM_THROTTLE_MS = 15 * 1000
// Поток был меньше минуты назад — устройство «смотрит сейчас»
export const WATCHING_WINDOW_MS = 60 * 1000

// Без входа: ТВ начинает подключение раз в 10 минут, опрашивает раз в 2–5 с
export const pairingStartLimiter = createRateLimiter({
  limit: 10,
  windowMs: 60 * 1000,
})
export const pairingPollLimiter = createRateLimiter({
  limit: 60,
  windowMs: 60 * 1000,
})

export type PairingErrorKind = 'invalid' | 'expired'

export class PairingError extends Error {
  readonly kind: PairingErrorKind

  constructor(kind: PairingErrorKind) {
    super(kind === 'expired' ? 'The code has expired' : 'Unknown code')
    this.name = 'PairingError'
    this.kind = kind
  }
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function randomCode() {
  let code = ''

  for (let i = 0; i < PAIRING_CODE_LENGTH; i++)
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]

  return code
}

/** Ввод владельца: регистр, пробелы и дефис между тройками не важны */
export function normalizeCode(input: string) {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

/** Тип по `User-Agent`, если устройство не назвало его само */
export function deviceTypeOf(userAgent: string | undefined): DeviceType {
  if (!userAgent)
    return 'other'

  if (
    /web0s|webos|smart-?tv|tizen|android tv|bravia|hbbtv|netcast/i.test(
      userAgent,
    )
  ) {
    return 'tv'
  }

  return /mozilla/i.test(userAgent) ? 'browser' : 'other'
}

function activePairingWithCode(code: string, now: Date) {
  return getDb()
    .select({ id: devicePairings.id })
    .from(devicePairings)
    .where(
      and(
        eq(devicePairings.code, code),
        eq(devicePairings.state, 'pending'),
        gt(devicePairings.expiresAt, now),
      ),
    )
    .get()
}

export function countActivePairings(now = new Date()) {
  return getDb()
    .select({ id: devicePairings.id })
    .from(devicePairings)
    .where(
      and(
        eq(devicePairings.state, 'pending'),
        gt(devicePairings.expiresAt, now),
      ),
    )
    .all()
    .length
}

/**
 * Устройство начинает подключение: секрет остаётся у него (по нему оно
 * опрашивает статус), код показывается на экране для владельца.
 */
export function startPairing(input: {
  type: DeviceType
  ip?: string
  userAgent?: string
}) {
  const now = new Date()
  const db = getDb()

  db.delete(devicePairings)
    .where(
      lt(devicePairings.expiresAt, new Date(now.getTime() - PAIRING_KEEP_MS)),
    )
    .run()

  let code = randomCode()

  // Код уникален среди действующих; 32^6 вариантов — повтор почти невозможен
  while (activePairingWithCode(code, now)) code = randomCode()

  const secret = randomBytes(32).toString('hex')
  const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS)

  db.insert(devicePairings)
    .values({
      secretHash: hashToken(secret),
      code,
      state: 'pending',
      type: input.type,
      ip: input.ip,
      userAgent: input.userAgent?.slice(0, 500),
      createdAt: now,
      expiresAt,
    })
    .run()

  return { secret, code, expiresAt }
}

/** Владелец подтверждает код из панели и даёт устройству имя */
export function confirmPairing(input: {
  code: string
  name: string
  userId: string
}) {
  const now = new Date()
  const code = normalizeCode(input.code)
  const pairing = getDb()
    .select()
    .from(devicePairings)
    .where(
      and(eq(devicePairings.code, code), eq(devicePairings.state, 'pending')),
    )
    .orderBy(desc(devicePairings.expiresAt))
    .get()

  if (!pairing)
    throw new PairingError('invalid')

  if (pairing.expiresAt <= now)
    throw new PairingError('expired')

  const expiresAt = new Date(
    Math.max(pairing.expiresAt.getTime(), now.getTime() + CLAIM_GRACE_MS),
  )

  getDb()
    .update(devicePairings)
    .set({
      state: 'approved',
      name: input.name,
      approvedBy: input.userId,
      expiresAt,
    })
    .where(eq(devicePairings.id, pairing.id))
    .run()

  return { name: input.name, type: pairing.type }
}

export type PairingPoll
  = | { status: 'pending' | 'expired', expiresAt: Date }
    | { status: 'approved', expiresAt: Date, device: Device, token: string }

/**
 * Опрос по секрету. После подтверждения создаёт устройство и отдаёт токен
 * один раз: секрет гаснет. `undefined` — секрет неизвестен или уже использован.
 */
export function pollPairing(secret: string): PairingPoll | undefined {
  const now = new Date()

  return getDb().transaction((tx) => {
    const pairing = tx
      .select()
      .from(devicePairings)
      .where(eq(devicePairings.secretHash, hashToken(secret)))
      .get()

    if (!pairing || pairing.state === 'claimed')
      return undefined

    if (pairing.expiresAt <= now)
      return { status: 'expired' as const, expiresAt: pairing.expiresAt }

    if (pairing.state === 'pending')
      return { status: 'pending' as const, expiresAt: pairing.expiresAt }

    const token = randomBytes(32).toString('base64url')
    const device = tx
      .insert(devices)
      .values({
        name: pairing.name ?? '',
        type: pairing.type,
        tokenHash: hashToken(token),
        lastIp: pairing.ip,
        userAgent: pairing.userAgent,
        createdAt: now,
        lastSeenAt: now,
      })
      .returning()
      .get()

    tx.update(devicePairings)
      .set({ state: 'claimed' })
      .where(eq(devicePairings.id, pairing.id))
      .run()

    return {
      status: 'approved' as const,
      expiresAt: pairing.expiresAt,
      device,
      token,
    }
  })
}

export function deviceByToken(token: string) {
  if (!token)
    return undefined

  return getDb()
    .select()
    .from(devices)
    .where(eq(devices.tokenHash, hashToken(token)))
    .get()
}

export function getDevice(id: string) {
  return getDb().select().from(devices).where(eq(devices.id, id)).get()
}

export function listDevices() {
  return getDb().select().from(devices).orderBy(asc(devices.createdAt)).all()
}

/**
 * Время, адрес и `User-Agent` последнего запроса — не чаще раза в минуту.
 * `true` — запись обновилась (по этому признаку продлевается cookie).
 */
export function touchDevice(
  device: Device,
  request: { ip?: string, userAgent?: string },
  now = new Date(),
) {
  if (
    device.lastSeenAt
    && now.getTime() - device.lastSeenAt.getTime() < SEEN_THROTTLE_MS
  ) {
    return false
  }

  getDb()
    .update(devices)
    .set({
      lastSeenAt: now,
      lastIp: request.ip ?? device.lastIp,
      userAgent: request.userAgent?.slice(0, 500) ?? device.userAgent,
    })
    .where(eq(devices.id, device.id))
    .run()

  return true
}

const streamWrites = new Map<string, number>()

/** Запрос потока устройства; запись в базу — не чаще раза в 15 с */
export function markStreaming(id: string, now = Date.now()) {
  const last = streamWrites.get(id)

  if (last && now - last < STREAM_THROTTLE_MS)
    return

  streamWrites.set(id, now)
  getDb()
    .update(devices)
    .set({ lastStreamAt: new Date(now), lastSeenAt: new Date(now) })
    .where(eq(devices.id, id))
    .run()
}

export function isWatching(device: Device, now = Date.now()) {
  return (
    !!device.lastStreamAt
    && now - device.lastStreamAt.getTime() < WATCHING_WINDOW_MS
  )
}

export function renameDevice(id: string, name: string) {
  return getDb()
    .update(devices)
    .set({ name })
    .where(eq(devices.id, id))
    .returning()
    .get()
}

export function selectDeviceProfile(id: string, profileId: string) {
  getDb().update(devices).set({ profileId }).where(eq(devices.id, id)).run()
}

/** Отзыв — удаление строки: токен больше ни с чем не совпадёт */
export function revokeDevice(id: string) {
  streamWrites.delete(id)

  return getDb().delete(devices).where(eq(devices.id, id)).returning().get()
}
