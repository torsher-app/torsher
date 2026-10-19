/**
 * Создаёт dev-пользователя с известными кредами для локальной разработки и e2e.
 *
 * Идемпотентно: повторный запуск не создаёт дубликат. Заблокировано в проде,
 * чтобы известный пароль никогда не попал в боевую базу — это seed для
 * разработки, а не бэкдор.
 *
 * Креды берутся из SEED_USER_EMAIL / SEED_USER_PASSWORD (см. .env.example).
 */
import process from 'node:process'
import { eq } from 'drizzle-orm'
import { config } from '../src/config.ts'
import { getDb, migrateDb } from '../src/db/index.ts'
import { users } from '../src/db/schema.ts'
import { normalizeEmail } from '../src/utils/email.ts'
import { hashPassword } from '../src/utils/password.ts'

if (config.isProduction) {
  console.error('seed запрещён в production')
  process.exit(1)
}

const email = normalizeEmail(process.env.SEED_USER_EMAIL ?? 'dev@example.com')
const password = process.env.SEED_USER_PASSWORD ?? 'devpassword'

migrateDb()

const db = getDb()
const existing = db.select().from(users).where(eq(users.email, email)).get()

if (existing) {
  console.log(`Пользователь уже существует: ${email}`)
}
else {
  db.insert(users)
    .values({
      name: 'Dev User',
      email,
      passwordHash: await hashPassword(password),
    })
    .run()
  console.log(`Создан dev-пользователь: ${email} / ${password}`)
}
