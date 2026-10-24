import type { Buffer } from 'node:buffer'
import type { EncHeader, KeyMaterial } from './crypto.ts'
import type { SnapshotFacts } from './snapshot.worker.ts'
import type { BackupPaths } from './paths.ts'
import { Buffer as NodeBuffer } from 'node:buffer'
import { randomBytes } from 'node:crypto'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  checkPassword,
  decryptToFile,
  ENC_HEADER_BYTES,
  gunzipToFile,
  isEncHeader,
  parseEncHeader,
} from './crypto.ts'
import { BackupError, toBackupError } from './errors.ts'
import { fsyncFile, syncDir, tryChmod, writeKeyFile } from './files.ts'
import { acquireFileLock } from './lock.ts'
import { MANIFEST_FORMAT, MANIFEST_TABLE } from './manifest.ts'
import { writeRestoreState } from './restore-state.ts'
import { compareSchema, readJournal } from './schema-version.ts'
import { inspectInWorker } from './snapshot.ts'
import { backupDeps, SPACE_MARGIN } from './space.ts'

const SQLITE_HEADER = NodeBuffer.from('SQLite format 3\0', 'latin1')

export interface BackupSecret {
  password?: string
  keyMaterial?: KeyMaterial
}

export type OpenedBackup
  = { kind: 'gzip' } | { kind: 'enc', header: EncHeader, key64: Buffer }

/**
 * Дешёвая проверка до долгой: файл есть, это копия Torsher, пароль подходит.
 * Тело не читается.
 */
export async function openBackupFile(
  path: string,
  secret: BackupSecret = {},
): Promise<OpenedBackup> {
  let handle

  try {
    handle = await open(path, 'r')
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
      throw new BackupError('not_found')

    throw toBackupError(err)
  }

  let head: Buffer

  try {
    head = NodeBuffer.alloc(ENC_HEADER_BYTES)
    const { bytesRead } = await handle.read(head, 0, ENC_HEADER_BYTES, 0)

    head = head.subarray(0, bytesRead)
  }
  finally {
    await handle.close()
  }

  if (head[0] === 0x1F && head[1] === 0x8B)
    return { kind: 'gzip' }

  if (!isEncHeader(head))
    throw new BackupError('not_torsher')

  const header = parseEncHeader(head)

  return { kind: 'enc', header, key64: await checkPassword(header, secret) }
}

export interface VerifiedBackup {
  /** Распакованный проверенный снимок во временном каталоге */
  snapshotPath: string
  size: number
  manifest?: Record<string, string>
  secretKey?: Buffer
}

async function startsWithSqliteHeader(path: string) {
  const handle = await open(path, 'r')

  try {
    const head = NodeBuffer.alloc(SQLITE_HEADER.length)
    const { bytesRead } = await handle.read(head, 0, head.length, 0)

    return bytesRead === head.length && head.equals(SQLITE_HEADER)
  }
  finally {
    await handle.close()
  }
}

/**
 * Решение по фактам о снимке (их собирает рабочий поток): целостность,
 * таблицы Torsher и аккаунт, версия манифеста и схема не новее сборки.
 */
export function judgeSnapshot(facts: SnapshotFacts, migrationsFolder: string) {
  if (facts.integrity !== 'ok')
    throw new BackupError('corrupt')

  if (!facts.hasMigrations || !facts.hasUsers || facts.lastApplied === null)
    throw new BackupError('not_torsher')

  // Копия, снятая до создания аккаунта, восстановит пустой сервер
  if (facts.users === 0)
    throw new BackupError('not_torsher')

  const version = facts.manifest?.version ?? ''

  if (facts.manifest && Number(facts.manifest.format) > Number(MANIFEST_FORMAT))
    throw new BackupError('newer_version', { version })

  const { lastWhen } = readJournal(migrationsFolder)

  // Миграции копии от более новой версии: эта сборка их не знает
  if (compareSchema(facts.lastApplied, lastWhen) === 'ahead')
    throw new BackupError('newer_version', { version })

  return facts.manifest
}

/**
 * Полная проверка копии, текущая база не трогается: распаковка (и
 * расшифровка) во временный файл, заголовок SQLite, `integrity_check`,
 * таблицы Torsher, схема не новее сборки. Копия без манифеста (снятая
 * руками) принимается — без ключа секретов.
 */
export async function verifyBackupFile(
  path: string,
  opened: OpenedBackup,
  options: { tmpDir: string, dataDir: string, migrationsFolder: string },
): Promise<VerifiedBackup> {
  await mkdir(options.tmpDir, { recursive: true, mode: 0o700 })
  await tryChmod(options.tmpDir, 0o700)

  const snapshotPath = join(
    options.tmpDir,
    `restore-${randomBytes(6).toString('hex')}.db`,
  )

  try {
    if (opened.kind === 'enc')
      await decryptToFile(path, snapshotPath, opened.header, opened.key64)
    else await gunzipToFile(path, snapshotPath)

    const size = (await stat(snapshotPath)).size
    // Распакованная копия уже на диске: ещё столько же нужно копии текущей базы
    const { free } = await backupDeps.diskUsage(options.dataDir)

    if (free < size + SPACE_MARGIN) {
      throw new BackupError('no_space', {
        need: 2 * size + SPACE_MARGIN,
        free: free + size,
      })
    }

    if (!(await startsWithSqliteHeader(snapshotPath)))
      throw new BackupError('not_torsher')

    const manifest = judgeSnapshot(
      await inspectInWorker({
        path: snapshotPath,
        manifestTable: MANIFEST_TABLE,
      }),
      options.migrationsFolder,
    )
    const secretKey = manifest?.secretKey
      ? NodeBuffer.from(manifest.secretKey, 'base64')
      : undefined

    return { snapshotPath, size, manifest, secretKey }
  }
  catch (err) {
    await rm(snapshotPath, { force: true }).catch(() => {})
    throw toBackupError(err)
  }
}

/**
 * Подготовка восстановления до перезапуска: проверка, проверенный снимок —
 * в `restore-pending.db`, ключ секретов копии — рядом (права 0600, не в
 * JSON состояния), копия текущей базы (`preRestore`), и последним —
 * `restore.json` в состоянии `pending`: без него старт ничего не подменит.
 */
export async function prepareRestore(input: {
  path: string
  backupName: string
  opened: OpenedBackup
  paths: BackupPaths
  preRestore: () => Promise<unknown>
}) {
  const { paths } = input
  const release = acquireFileLock(paths.restoreLockPath)

  try {
    const verified = await verifyBackupFile(input.path, input.opened, paths)

    try {
      await rm(paths.pendingPath, { force: true })
      await rename(verified.snapshotPath, paths.pendingPath)
      // Снимок на диске раньше, чем `pending`: после сбоя питания старт не
      // подменит базу недописанным файлом
      fsyncFile(paths.pendingPath)
      syncDir(dirname(paths.pendingPath))

      await rm(paths.pendingKeyPath, { force: true })

      if (verified.secretKey)
        writeKeyFile(paths.pendingKeyPath, verified.secretKey)

      await input.preRestore()

      writeRestoreState(paths.statePath, {
        state: 'pending',
        backup: input.backupName,
        requestedAt: new Date().toISOString(),
      })
    }
    catch (err) {
      await rm(verified.snapshotPath, { force: true }).catch(() => {})
      await rm(paths.pendingPath, { force: true }).catch(() => {})
      await rm(paths.pendingKeyPath, { force: true }).catch(() => {})
      throw toBackupError(err)
    }

    return { manifest: verified.manifest }
  }
  finally {
    release()
  }
}
