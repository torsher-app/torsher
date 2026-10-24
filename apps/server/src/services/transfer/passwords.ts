import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
} from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const SALT_BYTES = 16
const IV_BYTES = 12
// Префикс отличает шифр от пароля экспорта от `v1:` ключа сервера
const VERSION = 'p1'
const CHECK_TEXT = 'torsher-export'
// N = 2^15 — около 100 мс на ключ; памяти нужно 128·N·r = 32 МБ, ровно
// предел Node по умолчанию, поэтому `maxmem` с запасом
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }

export class ExportPasswordError extends Error {
  constructor(options?: ErrorOptions) {
    super('Wrong export password', options)
    this.name = 'ExportPasswordError'
  }
}

/** Ключ из пароля экспорта; соль лежит в файле открыто */
export interface PasswordKey {
  key: Buffer
  salt: string
}

export function newPasswordKey(password: string): PasswordKey {
  const salt = randomBytes(SALT_BYTES)

  return {
    key: scryptSync(password.normalize('NFC'), salt, KEY_BYTES, SCRYPT),
    salt: salt.toString('base64'),
  }
}

export function passwordKeyOf(password: string, salt: string): PasswordKey {
  return {
    key: scryptSync(
      password.normalize('NFC'),
      Buffer.from(salt, 'base64'),
      KEY_BYTES,
      SCRYPT,
    ),
    salt,
  }
}

export function encryptWithPassword(key: PasswordKey, plaintext: string) {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv(ALGORITHM, key.key, iv)
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

export function decryptWithPassword(key: PasswordKey, ciphertext: string) {
  const [version, iv, tag, data] = ciphertext.split(':')

  if (version !== VERSION || !iv || !tag || data === undefined)
    throw new ExportPasswordError()

  try {
    const decipher = createDecipheriv(
      ALGORITHM,
      key.key,
      Buffer.from(iv, 'base64'),
    )

    decipher.setAuthTag(Buffer.from(tag, 'base64'))

    return Buffer.concat([
      decipher.update(Buffer.from(data, 'base64')),
      decipher.final(),
    ]).toString('utf8')
  }
  catch (err) {
    throw new ExportPasswordError({ cause: err })
  }
}

/** Проверочное значение в файле: неверный пароль виден до разбора секретов */
export function passwordCheck(key: PasswordKey) {
  return encryptWithPassword(key, CHECK_TEXT)
}

export function verifyPasswordCheck(key: PasswordKey, check: string) {
  return decryptWithPassword(key, check) === CHECK_TEXT
}
