import { getDb } from '../../db/index.ts'
import { users } from '../../db/schema.ts'

export interface NewUser {
  name: string
  email: string
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

/**
 * Аккаунт на сервере один — владелец, он создаётся при первом запуске.
 * Остальные смотрят через профили этого аккаунта. Проверка и вставка идут
 * в одной синхронной транзакции, поэтому две одновременные отправки формы
 * не создадут два аккаунта.
 */
export function createOwner(values: NewUser) {
  return getDb().transaction((tx) => {
    if (tx.select({ id: users.id }).from(users).limit(1).get())
      throw new SetupDoneError()

    return tx.insert(users).values(values).returning().get()
  })
}
