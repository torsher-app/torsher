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

  // Собранные витрина и панель: в монорепо и в образе лежат по одним путям
  clients: {
    tv: join(import.meta.dirname, '../../tv/dist'),
    panel: join(import.meta.dirname, '../../web/.output/public'),
  },

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

  // Бинарник движка. В разработке его собирает `engine:build` в каталог данных,
  // образ передаёт свой путь
  get enginePath() {
    return process.env.ENGINE_PATH || undefined
  },

  // Порт для входящих соединений пиров; 0 — любой свободный
  get enginePeerPort() {
    return Number(process.env.ENGINE_PEER_PORT || 0)
  },

  get downloadsPath() {
    return process.env.DOWNLOADS_PATH || join(this.dataDir, 'downloads')
  },

  // Прокси из окружения (`HTTPS_PROXY`, `HTTP_PROXY`, исключения — `NO_PROXY`):
  // им ходит маршрут по умолчанию, пока его не настроили в «Сети»
  get envProxy() {
    const env = process.env

    // Строчные важнее заглавных, как у undici
    return Boolean(
      (env.https_proxy ?? env.HTTPS_PROXY)
      || (env.http_proxy ?? env.HTTP_PROXY),
    )
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
// Токен устройства, подключённого по коду: открывает только API витрины
export const DEVICE_TOKEN_COOKIE = `${cookiePrefix}_device_token`
// Профиль, выбранный на витрине в сессии владельца (у устройства он в базе)
export const PROFILE_COOKIE = `${cookiePrefix}_profile`

/**
 * Общие атрибуты сессионных cookie. Токены живут только в httpOnly.
 * `secure: 'auto'` ставит Secure только на HTTPS-соединении: в локальной сети
 * сервер открывают по http://<адрес>:<порт>, и cookie с Secure браузер бы
 * не сохранил.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  secure: 'auto',
  sameSite: 'lax',
  path: '/',
} as const

/**
 * Cookie устройства живёт дольше сессии: ТВ подключают один раз. Chromium
 * не хранит cookie дольше 400 дней, поэтому сервер продлевает её, пока
 * устройством пользуются.
 */
export const deviceCookieOptions = {
  ...sessionCookieOptions,
  maxAge: 400 * 24 * 60 * 60,
} as const
