import type { TokenPurpose, VerifiedToken } from '../../utils/token.ts'
import { eq } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { users } from '../../db/schema.ts'
import { verifyTokenFor } from '../../utils/token.ts'

/**
 * Текущая версия сессий аккаунта или `undefined`, если сессий у него быть
 * не может: аккаунта нет, он удалён, заблокирован или выключен. Читается
 * из базы на каждый запрос: сброс пароля командой идёт другим процессом,
 * и кэш в памяти сервера его бы не заметил.
 */
export function sessionVersionOf(userId: string) {
  const user = getDb()
    .select({
      sessionVersion: users.sessionVersion,
      isActive: users.isActive,
      isBanned: users.isBanned,
      isDeleted: users.isDeleted,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get()

  if (!user || !user.isActive || user.isBanned || user.isDeleted)
    return undefined

  return user.sessionVersion
}

/** Токен сессии: подпись, цель и срок, как у `verifyTokenFor`, и ещё версия сессий */
export function verifySession(
  token: string,
  purpose: TokenPurpose,
): VerifiedToken {
  const verified = verifyTokenFor(token, purpose)

  if (sessionVersionOf(verified.userId) !== verified.sessionVersion)
    throw new TypeError('Session is revoked')

  return verified
}
