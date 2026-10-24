import type { Buffer } from 'node:buffer'
import type { Transform } from 'node:stream'
import type { KeyMaterial } from './crypto.ts'
import type { BackupReason } from './names.ts'
import { randomBytes } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGzip } from 'node:zlib'
import { TMDB_ALIAS_KINDS } from '../sources/aliases.ts'
import { createEncryptStream } from './crypto.ts'
import { BackupError, toBackupError } from './errors.ts'
import { syncDir, tryChmod } from './files.ts'
import { acquireBackupLock } from './lock.ts'
import { MANIFEST_TABLE, manifestOf } from './manifest.ts'
import { formatBackupName } from './names.ts'
import { takeSnapshot } from './snapshot.ts'
import { backupDeps, checkBackupSpace } from './space.ts'

export interface CreateBackupOptions {
  dbPath: string
  /** Временный каталог снимка — всегда на локальном диске данных */
  tmpDir: string
  dir: string
  reason: BackupReason
  version: string
  commit?: string
  /** Ключ секретов: кладётся в манифест, чтобы копия восстанавливалась целиком */
  secretKey: Buffer
  /** Есть — копия шифруется паролем владельца */
  keyMaterial?: KeyMaterial
  now?: Date
  signal?: AbortSignal
}

export interface CreatedBackup {
  name: string
  size: number
  createdAt: Date
}

/** Имя свободно: две копии одной причины в одну секунду получают соседние секунды */
export function freeBackupName(
  dir: string,
  input: { reason: BackupReason, version: string, encrypted: boolean },
  now: Date,
) {
  const createdAt = new Date(Math.floor(now.getTime() / 1000) * 1000)

  for (;;) {
    const name = formatBackupName({ ...input, createdAt })

    if (!existsSync(join(dir, name)))
      return { name, createdAt }

    createdAt.setTime(createdAt.getTime() + 1000)
  }
}

/**
 * Копия базы: проверка места, замок, снимок в рабочем потоке, gzip (и
 * шифрование) потоком в `<имя>.tmp`, fsync, rename. Любая ошибка удаляет
 * временные файлы и приходит как `BackupError`.
 */
export async function createBackup(
  options: CreateBackupOptions,
): Promise<CreatedBackup> {
  if (options.dbPath === ':memory:')
    throw new BackupError('io', { code: 'MEMORY_DATABASE' })

  const snapshotPath = join(
    options.tmpDir,
    `snapshot-${randomBytes(6).toString('hex')}.db`,
  )
  let tmpPath: string | undefined
  let release: (() => void) | undefined

  try {
    // Снимок не сжат и не зашифрован: временный каталог только для владельца
    await mkdir(options.tmpDir, { recursive: true, mode: 0o700 })
    await tryChmod(options.tmpDir, 0o700)
    await checkBackupSpace(options)
    release = acquireBackupLock(options.dir)

    const { name, createdAt } = freeBackupName(
      options.dir,
      {
        reason: options.reason,
        version: options.version,
        encrypted: Boolean(options.keyMaterial),
      },
      options.now ?? new Date(),
    )

    await takeSnapshot(
      {
        sourcePath: options.dbPath,
        targetPath: snapshotPath,
        tmdbAliasKinds: [...TMDB_ALIAS_KINDS],
        manifestTable: MANIFEST_TABLE,
        manifest: manifestOf({ ...options, createdAt }),
      },
      options.signal,
    )

    tmpPath = join(options.dir, `${name}.tmp`)

    const stages: Transform[] = [createGzip()]

    if (options.keyMaterial)
      stages.push(createEncryptStream(options.keyMaterial))

    await pipeline(
      [
        createReadStream(snapshotPath),
        ...stages,
        // `flush` — fsync перед закрытием: rename не опередит данные на диске
        backupDeps.createWriteStream(tmpPath, { flush: true, mode: 0o600 }),
      ],
      { signal: options.signal },
    )

    const finalPath = join(options.dir, name)

    await rename(tmpPath, finalPath)
    tmpPath = undefined
    syncDir(options.dir)

    return { name, size: (await stat(finalPath)).size, createdAt }
  }
  catch (err) {
    if (options.signal?.aborted)
      throw new BackupError('io', { code: 'ABORTED' }, { cause: err })

    throw toBackupError(err)
  }
  finally {
    // Снимок с журналом SQLite, если поток оборвали посреди записи
    for (const suffix of ['', '-journal', '-wal', '-shm'])
      await rm(`${snapshotPath}${suffix}`, { force: true }).catch(() => {})

    if (tmpPath)
      await rm(tmpPath, { force: true }).catch(() => {})

    release?.()
  }
}
