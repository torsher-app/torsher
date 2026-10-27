/**
 * Создаёт dev-пользователя с известными кредами для локальной разработки и e2e.
 *
 * Идемпотентно: повторный запуск не создаёт дубликат, а на сервере с другим
 * аккаунтом ничего не делает — аккаунт на сервере один. Заблокировано в проде,
 * чтобы известный пароль никогда не попал в боевую базу — это seed для
 * разработки, а не бэкдор.
 *
 * Креды берутся из SEED_USER_NAME / SEED_USER_PASSWORD (см. .env.example).
 */
import process from 'node:process'
import { config } from '../src/config.ts'
import { migrateDb } from '../src/db/index.ts'
import { createOwner, findOwner } from '../src/services/users/index.ts'
import { hashPassword } from '../src/utils/password.ts'
import { normalizeUsername } from '../src/utils/username.ts'

if (config.isProduction) {
  console.error('seed запрещён в production')
  process.exit(1)
}

const username = process.env.SEED_USER_NAME?.trim() || 'dev'
const password = process.env.SEED_USER_PASSWORD ?? 'devpassword'

await migrateDb()

const owner = findOwner()

if (
  owner
  && normalizeUsername(owner.username) === normalizeUsername(username)
) {
  console.log(`Пользователь уже существует: ${owner.username}`)
}
else if (owner) {
  // Аккаунт на сервере один: seed не заводит второй рядом с созданным вручную
  console.log('На сервере уже есть аккаунт, dev-пользователь не создан')
}
else {
  createOwner({ username, passwordHash: await hashPassword(password) })
  console.log(`Создан dev-пользователь: ${username} / ${password}`)
}
