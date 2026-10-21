// После пяти неверных PIN подряд профиль на этом устройстве закрывается
// на пять минут: четыре цифры иначе перебираются за минуты
const MAX_FAILURES = 5
const LOCK_MS = 5 * 60 * 1000

interface Attempts {
  failures: number
  lockedUntil: number
}

const attempts = new Map<string, Attempts>()

export class PinLockedError extends Error {
  readonly retryAfter: number

  constructor(retryAfter: number) {
    super('Too many wrong PIN attempts')
    this.name = 'PinLockedError'
    this.retryAfter = retryAfter
  }
}

/** Ключ — профиль и тот, кто вводит (устройство или сессия владельца) */
function keyOf(profileId: string, viewerKey: string) {
  return `${profileId}:${viewerKey}`
}

/**
 * Проверяет PIN с учётом блокировки: `ok` или число оставшихся попыток.
 * Во время блокировки бросает `PinLockedError`, PIN не проверяется.
 */
export async function checkPinAttempt(
  profileId: string,
  viewerKey: string,
  verify: () => Promise<boolean>,
  now = Date.now(),
): Promise<{ ok: true } | { ok: false, attemptsLeft: number }> {
  const key = keyOf(profileId, viewerKey)
  const entry = attempts.get(key)

  if (entry && entry.lockedUntil > now)
    throw new PinLockedError(Math.ceil((entry.lockedUntil - now) / 1000))

  if (await verify()) {
    attempts.delete(key)
    return { ok: true }
  }

  const failures = (entry && entry.lockedUntil === 0 ? entry.failures : 0) + 1

  if (failures >= MAX_FAILURES) {
    attempts.set(key, { failures: 0, lockedUntil: now + LOCK_MS })
    throw new PinLockedError(Math.ceil(LOCK_MS / 1000))
  }

  attempts.set(key, { failures, lockedUntil: 0 })

  return { ok: false, attemptsLeft: MAX_FAILURES - failures }
}

export function resetPinAttempts() {
  attempts.clear()
}
