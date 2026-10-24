#!/usr/bin/env node
/**
 * Команды сервера для того, у кого есть доступ к машине или контейнеру.
 * В образе запускаются обёрткой `torsher`: `docker exec -it torsher torsher reset-password`.
 */
import type { BackupSettings } from './services/backups/settings.ts'
import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { text } from 'node:stream/consumers'
import { parseArgs } from 'node:util'
import Database from 'better-sqlite3'
import { config } from './config.ts'
import { DowngradeError, migrateDb, PreUpdateBackupError } from './db/index.ts'
import { newPassword, PASSWORD_MIN_LENGTH } from './dto/auth.ts'
import {
  fileSecretKey,
  keyMaterialFrom,
  readBackupSettingsFrom,
  writableBackupDir,
} from './services/backups/context.ts'
import { createBackup } from './services/backups/create.ts'
import { backupDirOf } from './services/backups/dir.ts'
import { BackupError, toBackupError } from './services/backups/errors.ts'
import { listBackupsIn } from './services/backups/list.ts'
import { parseBackupName } from './services/backups/names.ts'
import { backupPathsFor } from './services/backups/paths.ts'
import {
  openBackupFile,
  prepareRestore,
} from './services/backups/restore-request.ts'
import { parseBackupSettings } from './services/backups/settings.ts'
import { SecretError } from './services/secrets/index.ts'
import { needsSetup, resetOwnerPassword } from './services/users/index.ts'
import { hashPassword } from './utils/password.ts'

export interface CliIo {
  out: (text: string) => void
  err: (text: string) => void
  readStdin: () => Promise<string>
}

/** База и каталог данных: по умолчанию из окружения сервера */
export interface CliPaths {
  databasePath: string
  dataDir: string
}

const USAGE = `Usage: torsher <command>

Commands:
  reset-password                     Set a new random owner password and print it
  reset-password --stdin             Read the new owner password from standard input
  backup                             Back up the database now
  backups                            List backups
  restore <name|file>                Check a backup and restore it on the next start
  restore <name|file> --password-stdin
                                     Read the backup password from standard input
  help                               Show this help`

// Без похожих символов (0/o, 1/l/i): пароль переписывают с экрана руками
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

/** Четыре группы по пять символов — около 99 бит */
export function generatePassword() {
  const groups = Array.from({ length: 4 }, () =>
    Array.from(
      { length: 5 },
      () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)],
    ).join(''))

  return groups.join('-')
}

async function readPassword(io: CliIo) {
  // Перевод строки в конце добавляют echo и большинство менеджеров паролей
  const password = (await io.readStdin()).replace(/\r?\n$/, '')

  return newPassword.safeParse(password).success ? password : undefined
}

const NO_ACCOUNT
  = 'The server has no account yet. Open the panel in a browser and create the owner account there.'

async function hasAccount() {
  // Открытие базы создало бы пустой файл, если команду запустили не с тем
  // окружением, что у сервера
  if (config.databasePath !== ':memory:' && !existsSync(config.databasePath))
    return false

  await migrateDb()

  return !needsSetup()
}

async function resetPassword(fromStdin: boolean, io: CliIo) {
  if (!(await hasAccount())) {
    io.err(NO_ACCOUNT)

    return 1
  }

  const password = fromStdin ? await readPassword(io) : generatePassword()

  if (!password) {
    io.err(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`)

    return 1
  }

  const owner = resetOwnerPassword(await hashPassword(password))

  if (!owner) {
    io.err(NO_ACCOUNT)

    return 1
  }

  if (fromStdin) {
    io.out(`The password for ${owner.email} has been reset.`)
  }
  else {
    io.out(`The password for ${owner.email} has been reset. New password:`)
    io.out('')
    io.out(`  ${password}`)
    io.out('')
    io.out('Sign in to the panel and change it in Settings > Account.')
  }

  io.out(
    'All browsers and devices signed in to the panel have been signed out.',
  )

  return 0
}

const NO_DATABASE
  = 'No database found. Run the command with the same environment as the server (DATABASE_PATH).'

function formatSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unit = 0

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
}

function backupErrorText(err: BackupError, encrypted = false) {
  const { params } = err

  switch (err.kind) {
    case 'no_space':
      return `Not enough disk space: ${formatSize(Number(params.need))} needed, ${formatSize(Number(params.free))} free.`
    case 'integrity':
      return 'The database failed the integrity check, so the backup was not saved.'
    case 'dir_unavailable':
      return `The backups folder is unavailable: ${params.path}`
    case 'busy':
      return 'Another backup or restore is in progress. Try again later.'
    case 'not_found':
      return 'Backup not found. Run "torsher backups" to see the list.'
    case 'not_torsher':
      return 'This file is not a Torsher backup.'
    case 'corrupt':
      return 'The backup file is damaged.'
    case 'wrong_password':
      return encrypted
        ? 'Wrong password for this backup.'
        : 'This backup is encrypted. Pass its password with --password-stdin.'
    case 'key_unavailable':
      return 'The backup password cannot be read with the current secret key. Set the backup password again in Settings > Backups.'
    case 'newer_version':
      return `This backup was made by a newer version of Torsher${params.version ? ` (v${params.version})` : ''}. Update the server, then restore.`
    default:
      return `The operation failed${params.code ? ` (${params.code})` : ''}.`
  }
}

/** Настройки копий прямо из файла базы: команда работает и при сервере, который не стартует */
function readSettings(paths: CliPaths): BackupSettings {
  if (!existsSync(paths.databasePath))
    return parseBackupSettings(undefined)

  try {
    const db = new Database(paths.databasePath, {
      readonly: true,
      fileMustExist: true,
    })

    try {
      return readBackupSettingsFrom(db)
    }
    finally {
      db.close()
    }
  }
  catch {
    return parseBackupSettings(undefined)
  }
}

function pathsOf(paths: CliPaths) {
  return backupPathsFor(paths.databasePath, paths.dataDir)
}

function keyMaterialOrNothing(settings: BackupSettings, keyPath: string) {
  try {
    return keyMaterialFrom(settings, fileSecretKey(keyPath))
  }
  catch {
    return undefined
  }
}

async function backup(io: CliIo, paths: CliPaths) {
  if (!existsSync(paths.databasePath)) {
    io.err(NO_DATABASE)

    return 1
  }

  const settings = readSettings(paths)
  const secretKey = fileSecretKey(pathsOf(paths).keyPath)
  const dir = await writableBackupDir(settings, pathsOf(paths).defaultDir, {
    fallback: false,
  })
  const created = await createBackup({
    dbPath: paths.databasePath,
    tmpDir: pathsOf(paths).tmpDir,
    dir: dir.path,
    reason: 'manual',
    version: config.version,
    commit: config.commit,
    secretKey,
    keyMaterial: keyMaterialFrom(settings, secretKey),
  })

  io.out(`Backup created: ${created.name} (${formatSize(created.size)})`)
  io.out(`Folder: ${dir.path}`)

  return 0
}

async function listCommand(io: CliIo, paths: CliPaths) {
  const settings = readSettings(paths)
  const dir = backupDirOf(settings, pathsOf(paths).defaultDir)
  const { items, available } = await listBackupsIn(
    dir.path,
    pathsOf(paths).defaultDir,
  )

  if (!available)
    io.err(`The backups folder is unavailable: ${dir.path}`)

  if (!items.length) {
    io.out(`No backups in ${dir.path}`)

    return available ? 0 : 1
  }

  for (const item of items) {
    io.out(
      [
        item.name,
        item.reason,
        `v${item.version}`,
        formatSize(item.size),
        ...(item.dirKind === 'fallback' ? [pathsOf(paths).defaultDir] : []),
      ].join('  '),
    )
  }

  return 0
}

/** Имя копии ищется в каталоге копий и каталоге по умолчанию, иначе это путь к файлу */
async function backupFile(target: string, paths: CliPaths) {
  if (parseBackupName(target)) {
    const settings = readSettings(paths)
    const dir = backupDirOf(settings, pathsOf(paths).defaultDir)
    const { items } = await listBackupsIn(dir.path, pathsOf(paths).defaultDir)
    const item = items.find(candidate => candidate.name === target)

    if (item)
      return item.path
  }

  return resolve(target)
}

async function restore(
  target: string,
  passwordFromStdin: boolean,
  io: CliIo,
  paths: CliPaths,
) {
  const path = await backupFile(target, paths)
  const password = passwordFromStdin
    ? (await io.readStdin()).replace(/\r?\n$/, '')
    : undefined
  const settings = readSettings(paths)
  let opened

  try {
    opened = await openBackupFile(path, {
      password,
      keyMaterial: keyMaterialOrNothing(settings, pathsOf(paths).keyPath),
    })
  }
  catch (err) {
    if (err instanceof BackupError) {
      io.err(backupErrorText(err, password !== undefined))

      return 1
    }

    throw err
  }

  const restorePaths = pathsOf(paths)

  await prepareRestore({
    path,
    backupName: basename(path),
    opened,
    paths: restorePaths,
    // Без копии текущей базы восстанавливаем, только если её не прочитать:
    // команда и нужна, когда сервер с этой базой не стартует
    preRestore: async () => {
      if (!existsSync(paths.databasePath))
        return

      try {
        const secretKey = fileSecretKey(pathsOf(paths).keyPath)
        const dir = await writableBackupDir(
          settings,
          pathsOf(paths).defaultDir,
          {
            fallback: true,
          },
        )

        await createBackup({
          dbPath: paths.databasePath,
          tmpDir: restorePaths.tmpDir,
          dir: dir.path,
          reason: 'pre-restore',
          version: config.version,
          commit: config.commit,
          secretKey,
          keyMaterial: keyMaterialOrNothing(settings, pathsOf(paths).keyPath),
        })
      }
      catch (err) {
        const error = toBackupError(err)

        if (
          error.kind === 'no_space'
          || error.kind === 'busy'
          || error.kind === 'dir_unavailable'
        ) {
          throw error
        }

        io.err(
          `Warning: the current database could not be backed up (${error.kind}). Continuing without a copy.`,
        )
      }
    },
  })

  io.out(
    `Backup ${basename(path)} is checked and will be restored on the next start.`,
  )
  io.out('Restart the container to apply: docker restart torsher')

  return 0
}

function defaultPaths(): CliPaths {
  return { databasePath: config.databasePath, dataDir: config.dataDir }
}

async function runCommand(
  command: string | undefined,
  rest: string[],
  values: { 'stdin': boolean, 'password-stdin': boolean },
  io: CliIo,
  paths: CliPaths,
) {
  if (command === 'reset-password' && rest.length === 0)
    return resetPassword(values.stdin, io)

  if (command === 'backup' && rest.length === 0)
    return backup(io, paths)

  if (command === 'backups' && rest.length === 0)
    return listCommand(io, paths)

  if (command === 'restore' && rest.length === 1)
    return restore(rest[0]!, values['password-stdin'], io, paths)

  return undefined
}

export async function runCli(
  argv: string[],
  io: CliIo,
  paths: CliPaths = defaultPaths(),
) {
  let parsed

  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        'stdin': { type: 'boolean', default: false },
        'password-stdin': { type: 'boolean', default: false },
      },
    })
  }
  catch (err) {
    io.err((err as Error).message)
    io.err(USAGE)

    return 2
  }

  const [command, ...rest] = parsed.positionals

  try {
    const code = await runCommand(command, rest, parsed.values, io, paths)

    if (code !== undefined)
      return code
  }
  catch (err) {
    if (err instanceof BackupError) {
      io.err(backupErrorText(err))

      return 1
    }

    // Ключ секретов не читается (битый secret.key): причина без стека
    if (
      err instanceof DowngradeError
      || err instanceof PreUpdateBackupError
      || err instanceof SecretError
    ) {
      io.err(err.message)

      return 1
    }

    throw err
  }

  if (command === undefined || command === 'help') {
    io.out(USAGE)

    return 0
  }

  io.err(`Unknown command: ${parsed.positionals.join(' ')}`)
  io.err(USAGE)

  return 2
}

if (import.meta.main) {
  process.exitCode = await runCli(process.argv.slice(2), {
    out: text => process.stdout.write(`${text}\n`),
    err: text => process.stderr.write(`${text}\n`),
    readStdin: () => text(process.stdin),
  })
}
