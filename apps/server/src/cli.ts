#!/usr/bin/env node
/**
 * Команды сервера для того, у кого есть доступ к машине или контейнеру.
 * В образе запускаются обёрткой `torsher`: `docker exec -it torsher torsher reset-password`.
 */
import type { BackupSettings } from './services/backups/settings.ts'
import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import process from 'node:process'
import { text } from 'node:stream/consumers'
import { parseArgs } from 'node:util'
import { gunzipSync } from 'node:zlib'
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
import { backupErrorText, formatSize } from './services/backups/messages.ts'
import { parseBackupName } from './services/backups/names.ts'
import { backupPathsFor } from './services/backups/paths.ts'
import {
  openBackupFile,
  prepareRestore,
} from './services/backups/restore-request.ts'
import { dataVersionOf } from './services/backups/schema-version.ts'
import { parseBackupSettings } from './services/backups/settings.ts'
import { listProfiles } from './services/profiles/index.ts'
import { SecretError } from './services/secrets/index.ts'
import {
  DocumentError,
  parseExportDocument,
} from './services/transfer/document.ts'
import { buildExport } from './services/transfer/export.ts'
import {
  applyServerImport,
  previewServerImport,
} from './services/transfer/serverImport.ts'
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
  export [--profile <name>] [--libraries] [--settings] [--password-stdin] [--out <file>]
                                     Export viewer data to a file (stdout without --out);
                                     with --password-stdin keys and passwords are included
  import <file> [--profile <name>] [--dry-run] [--password-stdin]
                                     Merge an export into this server
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
    io.out(`The password for ${owner.username} has been reset.`)
  }
  else {
    io.out(`The password for ${owner.username} has been reset. New password:`)
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

/** Чтение прямо из файла базы: команда работает и при сервере, который не стартует */
function readFromDb<T>(
  paths: CliPaths,
  read: (db: Database.Database) => T,
  fallback: T,
): T {
  if (!existsSync(paths.databasePath))
    return fallback

  try {
    const db = new Database(paths.databasePath, {
      readonly: true,
      fileMustExist: true,
    })

    try {
      return read(db)
    }
    finally {
      db.close()
    }
  }
  catch {
    return fallback
  }
}

function readSettings(paths: CliPaths): BackupSettings {
  return readFromDb(
    paths,
    readBackupSettingsFrom,
    parseBackupSettings(undefined),
  )
}

/** Команду могут запустить образом другой версии, чем та, что писала базу */
function readDataVersion(paths: CliPaths) {
  return readFromDb(paths, dataVersionOf, { version: '' })
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
    ...readDataVersion(paths),
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
    io.err(`The backups folder ${dir.path} is unavailable.`)

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
          ...readDataVersion(paths),
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
  io.out(
    'If you changed the image in docker-compose.yml, run docker compose up -d instead.',
  )

  return 0
}

interface TransferFlags {
  'profile'?: string
  'out'?: string
  'libraries': boolean
  'settings': boolean
  'dry-run': boolean
  'password-stdin': boolean
}

async function readSecret(io: CliIo) {
  return (await io.readStdin()).replace(/\r?\n$/, '')
}

function profileNamed(name: string) {
  const key = name.normalize('NFC').trim().toLocaleLowerCase()

  return listProfiles().find(
    profile =>
      profile.name.normalize('NFC').trim().toLocaleLowerCase() === key,
  )
}

async function exportCommand(flags: TransferFlags, io: CliIo) {
  if (!(await hasAccount())) {
    io.err(NO_ACCOUNT)

    return 1
  }

  const profile = flags.profile ? profileNamed(flags.profile) : undefined

  if (flags.profile && !profile) {
    io.err(`No profile named "${flags.profile}".`)

    return 1
  }

  const password = flags['password-stdin'] ? await readSecret(io) : undefined

  if (password !== undefined && !newPassword.safeParse(password).success) {
    io.err(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`)

    return 1
  }

  const document = buildExport(
    profile
      ? { scope: 'profile', profileId: profile.id }
      : {
          scope: 'server',
          include: {
            collections: true,
            libraries: flags.libraries,
            settings: flags.settings || password !== undefined,
          },
          password,
        },
  )
  const json = JSON.stringify(document, null, 2)

  if (!flags.out) {
    io.out(json)

    return 0
  }

  await writeFile(resolve(flags.out), `${json}\n`, { mode: 0o600 })
  io.err(`Exported to ${resolve(flags.out)}`)

  return 0
}

function countsLine(
  name: string,
  counts: Awaited<
    ReturnType<typeof previewServerImport>
  >['profiles'][number]['counts'],
) {
  return (
    `  ${name}: positions +${counts.progress.new} ~${counts.progress.updated}, `
    + `ratings +${counts.ratings.new} (${counts.ratings.conflicts} conflicts), `
    + `watchlist +${counts.watchlist.new}, favorites +${counts.favorites.new}, `
    + `dropped +${counts.dropped.new}`
  )
}

async function importCommand(file: string, flags: TransferFlags, io: CliIo) {
  if (!(await hasAccount())) {
    io.err(NO_ACCOUNT)

    return 1
  }

  let document

  try {
    const raw = await readFile(resolve(file))

    document = parseExportDocument(
      (raw[0] === 0x1F && raw[1] === 0x8B ? gunzipSync(raw) : raw).toString(
        'utf8',
      ),
    )
  }
  catch (err) {
    if (err instanceof DocumentError) {
      io.err(
        err.kind === 'newerVersion'
          ? 'The file comes from a newer Torsher version. Update this server first.'
          : 'The file is not a Torsher export.',
      )

      return 1
    }

    throw err
  }

  const target = flags.profile ? profileNamed(flags.profile) : undefined

  if (flags.profile && !target) {
    io.err(`No profile named "${flags.profile}".`)

    return 1
  }

  if (target && document.profiles.length !== 1) {
    io.err('--profile works with an export of one profile.')

    return 1
  }

  const password = flags['password-stdin'] ? await readSecret(io) : undefined
  const preview = await previewServerImport(document, password)

  if (preview.secrets === 'wrong') {
    io.err('Wrong export password: keys and passwords will not be imported.')
  }
  else if (preview.secrets === 'locked') {
    io.err(
      'The file has keys and passwords: pass --password-stdin to import them.',
    )
  }

  const mapping: Record<string, string> = {}

  for (const profile of preview.profiles) {
    mapping[profile.key] = target
      ? target.id
      : profile.target.kind === 'existing'
        ? profile.target.id
        : 'new'
    io.out(countsLine(profile.name, profile.counts))
  }

  if (flags['dry-run'])
    return 0

  const result = await applyServerImport(preview.token, {
    mapping,
    conflicts: 'newer',
    scan: false,
  })

  io.out(
    `Imported: ${result.profiles.created} profiles created, `
    + `${result.profiles.merged} merged, ${result.profiles.changed} changes.`,
  )

  if (result.backup)
    io.out(`Backup before the import: ${result.backup}`)

  if (result.settings || result.folders) {
    io.out(
      'Restart the container to apply settings and scan new folders: docker restart torsher',
    )
  }

  return 0
}

function defaultPaths(): CliPaths {
  return { databasePath: config.databasePath, dataDir: config.dataDir }
}

async function runCommand(
  command: string | undefined,
  rest: string[],
  values: { stdin: boolean } & TransferFlags,
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

  if (command === 'export' && rest.length === 0)
    return exportCommand(values, io)

  if (command === 'import' && rest.length === 1)
    return importCommand(rest[0]!, values, io)

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
        'profile': { type: 'string' },
        'out': { type: 'string' },
        'libraries': { type: 'boolean', default: false },
        'settings': { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
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
