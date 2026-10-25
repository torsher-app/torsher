import { Buffer } from 'node:buffer'
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { open, rm } from 'node:fs/promises'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import { BackupError, toBackupError } from './errors.ts'

/**
 * Формат `.enc`: заголовок, поток AES-256-GCM и 16-байтный тег в конце.
 * Заголовок — `TORSHERBK`, версия формата, log2(N), r, p, соль, проверка
 * ключа и nonce — целиком идёт в AAD: подмена любого байта ломает тег.
 */
const MAGIC = Buffer.from('TORSHERBK', 'ascii')
const FORMAT_VERSION = 1
const SALT_BYTES = 16
const CHECK_BYTES = 16
const NONCE_BYTES = 12
const TAG_BYTES = 16
export const ENC_HEADER_BYTES
  = MAGIC.length + 1 + 3 + SALT_BYTES + CHECK_BYTES + NONCE_BYTES

const DEFAULT_LOG2N = 16
const DEFAULT_R = 8
const DEFAULT_P = 1
const SCRYPT_MAXMEM = 256 * 1024 * 1024
// Работа scrypt из чужого заголовка — не больше вчетверо от своей
const MAX_SCRYPT_WORK = 2 ** DEFAULT_LOG2N * DEFAULT_R * 4
const KEY_CHECK_LABEL = 'torsher-backup-key-check'

// Снимок только для владельца и на диске до записи `pending`: иначе после
// сбоя питания старт подменил бы базу недописанным файлом
const SNAPSHOT_FILE = { mode: 0o600, flush: true }

/** Ключ, выведенный из пароля, и параметры вывода: сервер хранит его для плановых копий */
export interface KeyMaterial {
  salt: string
  log2N: number
  r: number
  p: number
  key64: string
}

export interface EncHeader {
  log2N: number
  r: number
  p: number
  salt: Buffer
  keyCheck: Buffer
  nonce: Buffer
  raw: Buffer
}

function derive(
  password: string,
  salt: Buffer,
  log2N: number,
  r: number,
  p: number,
) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      64,
      { N: 2 ** log2N, r, p, maxmem: SCRYPT_MAXMEM },
      (err, key) => (err ? reject(err) : resolve(key)),
    )
  })
}

export async function deriveKeyMaterial(
  password: string,
  salt = randomBytes(SALT_BYTES),
): Promise<KeyMaterial> {
  const key64 = await derive(
    password,
    salt,
    DEFAULT_LOG2N,
    DEFAULT_R,
    DEFAULT_P,
  )

  return {
    salt: salt.toString('base64'),
    log2N: DEFAULT_LOG2N,
    r: DEFAULT_R,
    p: DEFAULT_P,
    key64: key64.toString('base64'),
  }
}

function keyCheckOf(key64: Buffer) {
  return createHmac('sha256', key64.subarray(32))
    .update(KEY_CHECK_LABEL)
    .digest()
    .subarray(0, CHECK_BYTES)
}

export function isEncHeader(head: Buffer) {
  return (
    head.length >= MAGIC.length && head.subarray(0, MAGIC.length).equals(MAGIC)
  )
}

/**
 * Разбор заголовка. Параметры scrypt ограничены: файл приходит и загрузкой,
 * и чужие N/r/p не должны съесть память сервера.
 */
export function parseEncHeader(head: Buffer): EncHeader {
  if (head.length < ENC_HEADER_BYTES || !isEncHeader(head))
    throw new BackupError('corrupt')

  let offset = MAGIC.length
  const version = head[offset++]!
  const log2N = head[offset++]!
  const r = head[offset++]!
  const p = head[offset++]!

  if (
    version !== FORMAT_VERSION
    || log2N < 10
    || log2N > 20
    || r < 1
    || r > 32
    || p < 1
    || p > 4
    // Память scrypt — 128·N·r: больше предела вывод ключа не выполнится
    || 128 * 2 ** log2N * r > SCRYPT_MAXMEM
    || 2 ** log2N * r * p > MAX_SCRYPT_WORK
  ) {
    throw new BackupError('corrupt')
  }

  const salt = head.subarray(offset, (offset += SALT_BYTES))
  const keyCheck = head.subarray(offset, (offset += CHECK_BYTES))
  const nonce = head.subarray(offset, (offset += NONCE_BYTES))

  return {
    log2N,
    r,
    p,
    salt: Buffer.from(salt),
    keyCheck: Buffer.from(keyCheck),
    nonce: Buffer.from(nonce),
    raw: Buffer.from(head.subarray(0, ENC_HEADER_BYTES)),
  }
}

function headerOf(material: KeyMaterial, nonce: Buffer) {
  const key64 = Buffer.from(material.key64, 'base64')

  return Buffer.concat([
    MAGIC,
    Buffer.from([FORMAT_VERSION, material.log2N, material.r, material.p]),
    Buffer.from(material.salt, 'base64'),
    keyCheckOf(key64),
    nonce,
  ])
}

/** Шифрование потоком: заголовок, шифртекст, тег */
export function createEncryptStream(material: KeyMaterial) {
  const nonce = randomBytes(NONCE_BYTES)
  const header = headerOf(material, nonce)
  const key = Buffer.from(material.key64, 'base64').subarray(0, 32)
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  let started = false

  cipher.setAAD(header)

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const out = cipher.update(chunk)

      if (!started) {
        started = true
        callback(null, Buffer.concat([header, out]))
        return
      }

      callback(null, out)
    },
    flush(callback) {
      const tail = Buffer.concat([cipher.final(), cipher.getAuthTag()])

      callback(null, started ? tail : Buffer.concat([header, tail]))
    },
  })
}

function sameParams(header: EncHeader, material: KeyMaterial) {
  return (
    header.log2N === material.log2N
    && header.r === material.r
    && header.p === material.p
    && header.salt.equals(Buffer.from(material.salt, 'base64'))
  )
}

function matches(header: EncHeader, key64: Buffer) {
  return timingSafeEqual(keyCheckOf(key64), header.keyCheck)
}

/**
 * Ключ для копии: сохранённый на сервере (без scrypt), иначе из пароля —
 * один scrypt и сверка проверки ключа, тело не читается. Не подошёл —
 * `wrong_password`.
 */
export async function checkPassword(
  header: EncHeader,
  secret: { keyMaterial?: KeyMaterial, password?: string },
): Promise<Buffer> {
  const { keyMaterial, password } = secret

  if (keyMaterial && sameParams(header, keyMaterial)) {
    const key64 = Buffer.from(keyMaterial.key64, 'base64')

    if (matches(header, key64))
      return key64
  }

  if (password !== undefined) {
    const key64 = await derive(
      password,
      header.salt,
      header.log2N,
      header.r,
      header.p,
    ).catch((err: unknown) => {
      throw new BackupError('corrupt', {}, { cause: err })
    })

    if (matches(header, key64))
      return key64
  }

  throw new BackupError('wrong_password')
}

export async function readEncHeader(path: string) {
  const handle = await open(path, 'r')

  try {
    const head = Buffer.alloc(ENC_HEADER_BYTES)
    const { bytesRead } = await handle.read(head, 0, ENC_HEADER_BYTES, 0)

    return parseEncHeader(head.subarray(0, bytesRead))
  }
  finally {
    await handle.close()
  }
}

/**
 * Обрывает распаковку, когда снимок перерос предел: сжатая копия бывает
 * загрузкой, и gzip-бомба иначе заняла бы весь диск
 */
function limitBytes(maxBytes: number) {
  let written = 0

  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      written += chunk.length

      if (written > maxBytes) {
        callback(new BackupError('no_space'))
        return
      }

      callback(null, chunk)
    },
  })
}

/**
 * Расшифровка и распаковка во временный файл. Файл годится только после
 * успешной проверки тега в конце: до неё он может быть подменён, поэтому
 * при любой ошибке удаляется.
 */
export async function decryptToFile(
  sourcePath: string,
  targetPath: string,
  header: EncHeader,
  key64: Buffer,
  maxBytes: number,
) {
  const handle = await open(sourcePath, 'r')
  let size: number
  const tag = Buffer.alloc(TAG_BYTES)

  try {
    size = (await handle.stat()).size

    if (size < ENC_HEADER_BYTES + TAG_BYTES)
      throw new BackupError('corrupt')

    await handle.read(tag, 0, TAG_BYTES, size - TAG_BYTES)
  }
  finally {
    await handle.close()
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    key64.subarray(0, 32),
    header.nonce,
  )

  decipher.setAAD(header.raw)
  decipher.setAuthTag(tag)

  try {
    await pipeline(
      createReadStream(sourcePath, {
        start: ENC_HEADER_BYTES,
        end: size - TAG_BYTES - 1,
      }),
      decipher,
      createGunzip(),
      limitBytes(maxBytes),
      createWriteStream(targetPath, SNAPSHOT_FILE),
    )
  }
  catch (err) {
    await rm(targetPath, { force: true })
    throw corruptOr(err)
  }
}

export async function gunzipToFile(
  sourcePath: string,
  targetPath: string,
  maxBytes: number,
) {
  try {
    await pipeline(
      createReadStream(sourcePath),
      createGunzip(),
      limitBytes(maxBytes),
      createWriteStream(targetPath, SNAPSHOT_FILE),
    )
  }
  catch (err) {
    await rm(targetPath, { force: true })
    throw corruptOr(err)
  }
}

/** Ошибка тега или gzip — порча файла; нехватка места и прочее — как есть */
function corruptOr(err: unknown) {
  const mapped = toBackupError(err)

  if (mapped.kind === 'no_space')
    return mapped

  const code = mapped.params.code

  return code === undefined
    || String(code).startsWith('Z_')
    || String(code).startsWith('ERR_')
    ? new BackupError('corrupt', {}, { cause: err })
    : mapped
}
