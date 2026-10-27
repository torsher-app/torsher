import { eq, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { profiles, users } from '../../db/schema.ts'
import { createRateLimiter } from '../../utils/rateLimit.ts'
import { startWizard } from '../setup/wizard.ts'

// Неудачи входа с одного адреса: пароль владельца не перебрать, а опечатки
// владельца не закроют ему вход надолго
export const signinLimiter = createRateLimiter({
  limit: 10,
  windowMs: 15 * 60 * 1000,
})
// Неверный текущий пароль при смене пароля или имени пользователя — на аккаунт: украденная
// сессия не подберёт им пароль
export const passwordConfirmLimiter = createRateLimiter({
  limit: 5,
  windowMs: 15 * 60 * 1000,
})

export interface NewUser {
  username: string
  passwordHash: string
}

/** Аккаунт на сервере уже есть: второй создать нельзя */
export class SetupDoneError extends Error {
  constructor() {
    super('The server already has an account')
    this.name = 'SetupDoneError'
  }
}

/** Сервер ещё не настроен: аккаунта владельца нет */
export function needsSetup() {
  return !getDb().select({ id: users.id }).from(users).limit(1).get()
}

/** Единственный аккаунт сервера; `undefined` — его ещё не создали */
export function findOwner() {
  return getDb().select().from(users).limit(1).get()
}

/**
 * Аккаунт на сервере один — владелец, он создаётся при первом запуске.
 * Остальные смотрят через профили этого аккаунта; первый профиль создаётся
 * вместе с ним. Проверка и вставка идут
 * в одной синхронной транзакции, поэтому две одновременные отправки формы
 * не создадут два аккаунта.
 */
export function createOwner(values: NewUser) {
  return getDb().transaction((tx) => {
    if (tx.select({ id: users.id }).from(users).limit(1).get())
      throw new SetupDoneError()

    const owner = tx.insert(users).values(values).returning().get()

    // Первый профиль — с именем владельца: витрине сразу есть, чей прогресс писать
    if (!tx.select({ id: profiles.id }).from(profiles).limit(1).get()) {
      tx.insert(profiles)
        .values({ name: owner.username, color: 'violet', position: 0 })
        .run()
    }

    // После аккаунта панель ведёт владельца по остальным шагам мастера
    startWizard()

    return owner
  })
}

const nextSessionVersion = sql`${users.sessionVersion} + 1`

/** Аккаунт, которому разрешено входить: есть, не удалён, не заблокирован и включён */
export function findActiveUser(userId: string) {
  const user = getDb().select().from(users).where(eq(users.id, userId)).get()

  if (!user || !user.isActive || user.isBanned || user.isDeleted)
    return undefined

  return user
}

/**
 * Новый пароль выкидывает все сессии аккаунта: версия сессий растёт.
 * Возвращает обновлённый аккаунт — по нему текущей сессии выдаются новые токены.
 */
export function updatePassword(userId: string, passwordHash: string) {
  return getDb()
    .update(users)
    .set({ passwordHash, sessionVersion: nextSessionVersion })
    .where(eq(users.id, userId))
    .returning()
    .get()
}

/** Имя пользователя — логин аккаунта, поэтому его смена тоже выкидывает прочие сессии */
export function updateUsername(userId: string, username: string) {
  return getDb()
    .update(users)
    .set({ username, sessionVersion: nextSessionVersion })
    .where(eq(users.id, userId))
    .returning()
    .get()
}

/**
 * Сброс пароля владельца командой на сервере (`torsher reset-password`):
 * писем нет, другого способа вернуть доступ к единственному аккаунту тоже.
 * `undefined` — аккаунта ещё нет.
 */
export function resetOwnerPassword(passwordHash: string) {
  const owner = findOwner()

  return owner && updatePassword(owner.id, passwordHash)
}
