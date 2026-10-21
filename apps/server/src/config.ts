import { dirname, join } from 'node:path'
import process from 'node:process'

function required(name: 'SECRET_KEY') {
  const value = process.env[name]

  if (!value)
    throw new Error(`Не задана обязательная переменная окружения: ${name}`)

  return value
}

export const config = {
  port: Number(process.env.API_PORT ?? 3001),
  host: process.env.API_HOST ?? '0.0.0.0',
  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:3000',
  databasePath: process.env.DATABASE_PATH ?? '.data/torsher.db',
  isProduction: process.env.NODE_ENV === 'production',

  // Секрет читается лениво: приложение можно поднять в памяти
  // (например, чтобы выгрузить OpenAPI-спеку) без настроенного окружения
  get secretKey() {
    return required('SECRET_KEY')
  },

  // Ключ шифрования секретов в базе (API-ключи индексаторов и т. п.).
  // Без него ключ берётся из файла рядом с базой (services/secrets)
  get torsherSecret() {
    return process.env.TORSHER_SECRET || undefined
  },

  get secretKeyPath() {
    const databasePath = this.databasePath

    return databasePath === ':memory:'
      ? undefined
      : join(dirname(databasePath), 'secret.key')
  },

  // Каталог данных сервера: рядом с базой лежат движок, его сессия и загрузки
  get dataDir() {
    return this.databasePath === ':memory:'
      ? '.data'
      : dirname(this.databasePath)
  },

  // Бинарник движка. По умолчанию его кладёт `engine:install` в каталог данных,
  // образ передаёт свой путь
  get rqbitPath() {
    return process.env.RQBIT_PATH || undefined
  },

  get downloadsPath() {
    return process.env.DOWNLOADS_PATH || join(this.dataDir, 'downloads')
  },

  // Без токена сервер работает, а каталог отвечает понятной ошибкой
  get tmdbAccessToken() {
    return process.env.TMDB_ACCESS_TOKEN || undefined
  },

  // Коммит сборки передаёт образ при сборке; в разработке его нет
  get commit() {
    return process.env.TORSHER_COMMIT || undefined
  },

  // AGPL требует дать пользователям исходники именно запущенной версии:
  // изменённая сборка указывает свой репозиторий
  get sourceUrl() {
    return (
      process.env.TORSHER_SOURCE_URL || 'https://github.com/torsher-app/torsher'
    )
  },
}

const cookiePrefix = process.env.COOKIE_PREFIX ?? 'torsher'

export const ACCESS_TOKEN_COOKIE = `${cookiePrefix}_access_token`
export const REFRESH_TOKEN_COOKIE = `${cookiePrefix}_refresh_token`

/** Общие атрибуты сессионных cookie. Токены живут только в httpOnly. */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: config.isProduction,
  sameSite: 'lax',
  path: '/',
} as const
