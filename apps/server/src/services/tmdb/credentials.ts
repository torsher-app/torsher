import { readFileSync } from 'node:fs'
import { config } from '../../config.ts'
import { decryptSecret, encryptSecret, SecretError } from '../secrets/index.ts'
import { deleteSetting, getSetting, setSetting } from '../settings/index.ts'

const SETTING_KEY = 'tmdb'

interface StoredTmdbSettings {
  // Шифртекст ключа владельца
  key: string
}

/** Ключ без своего ключа из панели: `env` — из окружения, `app` — ключ приложения */
export type TmdbDefaultKey = 'env' | 'app'

/** `custom` — ключ владельца из панели, `none` — ключа нет */
export type TmdbKeySource = 'custom' | TmdbDefaultKey | 'none'

// undefined — ещё не читали из базы
let stored: string | null | undefined
// TMDB не принял ключ сервера в последнем запросе с ним
let rejected = false
// Файл ключа приложения не меняется, пока процесс жив; путь — для тестов
let appKey: { path: string, value: string | undefined } | undefined

function storedCiphertext() {
  if (stored === undefined)
    stored = getSetting<StoredTmdbSettings>(SETTING_KEY)?.key ?? null

  return stored
}

function readAppKey() {
  const path = config.tmdbAppKeyPath

  if (appKey?.path !== path) {
    let value: string | undefined

    try {
      value = readFileSync(path, 'utf8').trim() || undefined
    }
    catch (err) {
      // Без файла образ собран без ключа приложения
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        throw err
    }

    appKey = { path, value }
  }

  return appKey.value
}

/** Ключ, которым сервер ходит в TMDB без своего ключа из панели */
export function tmdbDefaultKey(): TmdbDefaultKey | null {
  if (config.tmdbAccessToken)
    return 'env'

  return readAppKey() ? 'app' : null
}

export function tmdbKeySource(): TmdbKeySource {
  if (storedCiphertext())
    return 'custom'

  return tmdbDefaultKey() ?? 'none'
}

/**
 * Ключ запросов: свой ключ из панели, затем ключ из окружения, затем ключ
 * приложения — TMDB вправе отозвать ключ приложения. Нерасшифровываемый ключ
 * бросает `SecretError`.
 */
export function currentTmdbKey() {
  const ciphertext = storedCiphertext()

  if (ciphertext)
    return decryptSecret(ciphertext)

  return config.tmdbAccessToken ?? readAppKey()
}

/** `null` — убрать свой ключ: дальше работает ключ из окружения или приложения */
export function saveTmdbKey(key: string | null) {
  if (key) {
    setSetting(SETTING_KEY, {
      key: encryptSecret(key),
    } satisfies StoredTmdbSettings)
  }
  else {
    deleteSetting(SETTING_KEY)
  }

  stored = undefined
  rejected = false
}

/**
 * Итог последнего запроса к TMDB с ключом сервера: его пишет клиент TMDB.
 * `true` — состояние ключа изменилось
 */
export function markTmdbKeyRejected(value: boolean) {
  const changed = rejected !== value

  rejected = value
  return changed
}

/**
 * Можно ли ходить в TMDB с ключом сервера: `missing` — ключа нет,
 * `unreadable` — ключ владельца не расшифровывается, `rejected` — TMDB
 * не принял ключ в последнем запросе. Сеть не трогает.
 */
export function tmdbKeyStatus(): 'ok' | 'missing' | 'unreadable' | 'rejected' {
  let key

  try {
    key = currentTmdbKey()
  }
  catch (err) {
    if (!(err instanceof SecretError))
      throw err

    return 'unreadable'
  }

  if (!key)
    return 'missing'

  return rejected ? 'rejected' : 'ok'
}

// Ключ API v3 — 32 hex-символа и идёт параметром; токен чтения v4 — Bearer
const V3_KEY = /^[0-9a-f]{32}$/i

export function tmdbAuth(key: string): {
  headers: Record<string, string>
  params: Record<string, string>
} {
  return V3_KEY.test(key)
    ? { headers: {}, params: { api_key: key } }
    : { headers: { Authorization: `Bearer ${key}` }, params: {} }
}
