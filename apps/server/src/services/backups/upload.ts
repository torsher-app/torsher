import type { Readable } from 'node:stream'
import type { BackupItem } from './list.ts'
import { Buffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import {
  chmod,
  copyFile,
  mkdir,
  open,
  rename,
  rm,
  stat,
} from 'node:fs/promises'
import { join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { writableBackupDir } from './context.ts'
import { freeBackupName } from './create.ts'
import { ENC_HEADER_BYTES, isEncHeader } from './crypto.ts'
import { BackupError, toBackupError } from './errors.ts'
import { syncDir, tryChmod } from './files.ts'
import { parseBackupName } from './names.ts'
import { getBackupSettings } from './settings.ts'
import { needsSetup } from '../users/index.ts'
import { backupDeps, SPACE_MARGIN } from './space.ts'

/**
 * Предел размера и простой без данных; тесты подменяют их, чтобы не гонять
 * гигабайты и не ждать
 */
export const uploadLimits = { maxBytes: 2 * 1024 ** 3, idleMs: 30_000 }

// Разрешение без входа перепроверяется не чаще раза в секунду: это запрос к базе
const ALLOWED_CHECK_MS = 1000

/**
 * Поток загрузки с ограничениями: длиннее предела — `too_large`, нет данных
 * дольше `idleMs` — обрыв, `allowed` перестал пускать (появился аккаунт) —
 * `account_created`. Временный файл удаляет вызывающий.
 */
function guardStream(allowed?: () => boolean) {
  let total = 0
  let checkedAt = 0
  let idle: ReturnType<typeof setTimeout> | undefined

  const stream: Transform = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      total += chunk.length
      armIdle()

      if (total > uploadLimits.maxBytes) {
        callback(
          new BackupError('too_large', { limit: uploadLimits.maxBytes }),
        )
        return
      }

      const now = Date.now()

      if (allowed && now - checkedAt >= ALLOWED_CHECK_MS) {
        checkedAt = now

        if (!allowed()) {
          callback(new BackupError('account_created'))
          return
        }
      }

      callback(null, chunk)
    },
    destroy(err, callback) {
      clearTimeout(idle)
      callback(err)
    },
    flush(callback) {
      clearTimeout(idle)
      callback()
    },
  })

  function armIdle() {
    clearTimeout(idle)
    idle = setTimeout(
      () =>
        stream.destroy(new BackupError('io', { code: 'UPLOAD_IDLE_TIMEOUT' })),
      uploadLimits.idleMs,
    )
  }

  armIdle()

  return stream
}

/**
 * Тело запроса — в файл. При отказе запрос не уничтожается, а дочитывается
 * вхолостую: иначе соединение оборвётся раньше ответа и клиент не увидит 413.
 */
async function receive(body: Readable, path: string, allowed?: () => boolean) {
  const limiter = guardStream(allowed)
  const writing = pipeline(
    limiter,
    createWriteStream(path, { mode: 0o600, flush: true }),
  )
  const abort = (err?: Error) =>
    limiter.destroy(err ?? new Error('Upload was interrupted'))
  const onClose = () => {
    if (!body.readableEnded)
      abort()
  }

  body.once('error', abort)
  body.once('close', onClose)
  body.pipe(limiter)

  try {
    await writing
  }
  catch (err) {
    body.unpipe(limiter)
    body.resume()
    throw err
  }
  finally {
    body.off('error', abort)
    body.off('close', onClose)
    body.unpipe(limiter)
  }
}

/**
 * Хватит ли места до приёма: файл ляжет во временный каталог, а с другого
 * тома ещё и копией в каталог копий
 */
async function checkUploadSpace(bytes: number, dirs: string[]) {
  const need = bytes + SPACE_MARGIN

  for (const dir of dirs) {
    const { free } = await backupDeps.diskUsage(dir)

    if (free < need)
      throw new BackupError('no_space', { need, free })
  }
}

/** Копия Torsher по первым байтам: gzip или заголовок копии под паролем */
async function encryptedOf(path: string) {
  const handle = await open(path, 'r')

  try {
    const head = Buffer.alloc(ENC_HEADER_BYTES)
    const { bytesRead } = await handle.read(head, 0, ENC_HEADER_BYTES, 0)
    const bytes = head.subarray(0, bytesRead)

    if (bytes[0] === 0x1F && bytes[1] === 0x8B)
      return false

    if (isEncHeader(bytes))
      return true

    throw new BackupError('not_torsher')
  }
  finally {
    await handle.close()
  }
}

/** Rename, а между томами (каталог копий на NAS) — копия рядом и rename */
async function moveInto(source: string, dir: string, name: string) {
  const target = join(dir, name)

  try {
    await rename(source, target)
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV')
      throw err

    const partial = `${target}.tmp`

    try {
      await copyFile(source, partial)
      await rename(partial, target)
    }
    catch (copyErr) {
      await rm(partial, { force: true }).catch(() => {})
      throw copyErr
    }
  }

  await chmod(target, 0o600).catch(() => {})
  syncDir(dir)
}

/** Одна загрузка за раз: две копии по гигабайту разом легко съедят диск */
let uploading = false

// Копия, загруженная без входа, лежит во временном каталоге (его чистит
// старт сервера) и в каталог копий не попадает: после восстановления она
// не нужна, а неудачная попытка не оставляет на диске ничего. Имена — в
// памяти: восстановить без входа можно только их
const firstRunUploads = new Map<string, string>()

/** Путь копии, загруженной без входа в этом запуске; иначе `undefined` */
export function firstRunUploadPath(name: string) {
  return firstRunUploads.get(name)
}

/**
 * Загруженная копия: поток — во временный файл каталога данных (не больше
 * предела), проверка первых байтов, затем в каталог копий с причиной
 * `uploaded`. Время и версию даёт исходное имя, если оно по шаблону копии и
 * не из будущего. Полная проверка файла — при восстановлении. `firstRun` —
 * загрузка без входа на пустом сервере: копия одна (новая заменяет
 * прежнюю) и остаётся во временном каталоге, а появившийся аккаунт
 * обрывает загрузку.
 */
export async function saveUploadedBackup(input: {
  body: Readable
  tmpDir: string
  defaultDir: string
  originalName?: string
  declaredBytes?: number
  firstRun?: boolean
  now?: Date
}): Promise<Omit<BackupItem, 'path'>> {
  if (uploading)
    throw new BackupError('busy')

  uploading = true

  const partPath = join(
    input.tmpDir,
    `upload-${randomBytes(6).toString('hex')}.part`,
  )
  const allowed = input.firstRun ? needsSetup : undefined

  try {
    const dir = input.firstRun
      ? { path: input.tmpDir }
      : await writableBackupDir(getBackupSettings(), input.defaultDir, {
          fallback: false,
        })

    await mkdir(input.tmpDir, { recursive: true, mode: 0o700 })
    await tryChmod(input.tmpDir, 0o700)

    if (input.declaredBytes) {
      await checkUploadSpace(input.declaredBytes, [
        ...new Set([input.tmpDir, dir.path]),
      ])
    }

    await receive(input.body, partPath, allowed)

    // Последний кусок мог прийти уже после создания аккаунта
    if (allowed && !allowed())
      throw new BackupError('account_created')

    const encrypted = await encryptedOf(partPath)
    const now = input.now ?? new Date()
    const original = input.originalName
      ? parseBackupName(input.originalName)
      : undefined
    const createdAt
      = original && original.createdAt <= now ? original.createdAt : now
    const version = original?.version ?? '0'
    const named = freeBackupName(
      dir.path,
      { reason: 'uploaded', version, encrypted },
      createdAt,
    )
    const { size } = await stat(partPath)

    await moveInto(partPath, dir.path, named.name)

    if (input.firstRun) {
      for (const path of firstRunUploads.values())
        await rm(path, { force: true }).catch(() => {})

      firstRunUploads.clear()
      firstRunUploads.set(named.name, join(dir.path, named.name))
    }

    return {
      name: named.name,
      reason: 'uploaded',
      createdAt: named.createdAt,
      version,
      encrypted,
      size,
      dirKind: 'main',
    }
  }
  catch (err) {
    throw toBackupError(err)
  }
  finally {
    uploading = false
    await rm(partPath, { force: true }).catch(() => {})
  }
}
