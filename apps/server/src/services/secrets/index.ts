import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { config } from '../../config.ts'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
// Версия формата шифртекста: смена алгоритма не сломает старые записи
const VERSION = 'v1'

export class SecretError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'SecretError'
  }
}

export interface SecretKeySource {
  /** Значение `TORSHER_SECRET`: любая строка, ключ выводится из неё */
  secret?: string
  /** Файл ключа; создаётся с правами 0600, если его нет */
  filePath?: string
}

/**
 * Ключ шифрования секретов: из `TORSHER_SECRET`, иначе из файла в каталоге
 * данных. Файл создаётся при первом обращении, поэтому ключ переживает
 * перезапуск без настройки окружения.
 */
export function loadSecretKey({ secret, filePath }: SecretKeySource): Buffer {
  if (secret)
    return createHash('sha256').update(secret).digest()

  if (!filePath) {
    throw new SecretError(
      'Secret key is not available: set TORSHER_SECRET or use a file database',
    )
  }

  try {
    return decodeKeyFile(readFileSync(filePath, 'utf8'))
  }
  catch (err) {
    if (!isMissingFile(err))
      throw err
  }

  const key = randomBytes(KEY_BYTES)

  mkdirSync(dirname(filePath), { recursive: true })
  // `wx` не перезапишет ключ, если другой процесс успел создать файл
  writeFileSync(filePath, `${key.toString('base64')}\n`, {
    mode: 0o600,
    flag: 'wx',
  })

  return key
}

function decodeKeyFile(content: string) {
  const key = Buffer.from(content.trim(), 'base64')

  if (key.length !== KEY_BYTES)
    throw new SecretError('Secret key file is corrupted')

  return key
}

function isMissingFile(err: unknown) {
  return (
    typeof err === 'object'
    && err !== null
    && 'code' in err
    && err.code === 'ENOENT'
  )
}

export function encryptWith(key: Buffer, plaintext: string) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key, iv)
  const data = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])

  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':')
}

/** GCM проверяет тег: чужой ключ или испорченный шифртекст дают ошибку, а не мусор */
export function decryptWith(key: Buffer, ciphertext: string) {
  const [version, iv, tag, data] = ciphertext.split(':')

  if (version !== VERSION || !iv || !tag || data === undefined)
    throw new SecretError('Unknown secret format')

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'base64'),
    )

    decipher.setAuthTag(Buffer.from(tag, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }
  catch (err) {
    throw new SecretError('Secret cannot be decrypted with the current key', {
      cause: err,
    })
  }
}

let cachedKey: Buffer | undefined

function key() {
  cachedKey ??= loadSecretKey({
    secret: config.torsherSecret,
    filePath: config.secretKeyPath,
  })

  return cachedKey
}

export function encryptSecret(plaintext: string) {
  return encryptWith(key(), plaintext)
}

export function decryptSecret(ciphertext: string) {
  return decryptWith(key(), ciphertext)
}
