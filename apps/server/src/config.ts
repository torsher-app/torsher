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
