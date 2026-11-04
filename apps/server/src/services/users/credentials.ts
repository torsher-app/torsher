import { randomUUID } from 'node:crypto'
import { hashPassword, verifyPassword } from '../../utils/password.ts'
import { normalizeUsername } from '../../utils/username.ts'
import { logFor } from '../logs/index.ts'
import { findOwner, signinLimiter } from './index.ts'

let placeholderHash: Promise<string> | undefined

/** Shared owner sign-in: same normalization, timing and attempt budget for every transport. */
export async function verifyOwnerCredentials(
  input: { username: string, password: string },
  ip: string,
) {
  const key = `signin:${ip}`
  if (signinLimiter.isLimited(key) || !signinLimiter.hit(key)) {
    return {
      ok: false as const,
      status: 429 as const,
      message: 'too_many_attempts',
      retryAfter: signinLimiter.retryAfter(key),
    }
  }

  const user = findOwner()
  const hash
    = user?.passwordHash
      ?? (await (placeholderHash ??= hashPassword(randomUUID())))
  const valid = await verifyPassword(input.password, hash)
  if (
    !user
    || !valid
    || normalizeUsername(user.username) !== normalizeUsername(input.username)
  ) {
    logFor('auth').warn({ ip }, 'Sign-in failed')
    return {
      ok: false as const,
      status: 400 as const,
      message: 'Invalid username or password',
    }
  }
  signinLimiter.reset(key)
  if (user.isBanned || user.isDeleted) {
    return {
      ok: false as const,
      status: 403 as const,
      message: 'Account is not available',
    }
  }
  if (!user.isActive) {
    return {
      ok: false as const,
      status: 403 as const,
      message: 'Account is not active',
    }
  }
  return { ok: true as const, user }
}
