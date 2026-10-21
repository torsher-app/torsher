#!/usr/bin/env node
/**
 * Команды сервера для того, у кого есть доступ к машине или контейнеру.
 * В образе запускаются обёрткой `torsher`: `docker exec -it torsher torsher reset-password`.
 */
import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import process from 'node:process'
import { text } from 'node:stream/consumers'
import { parseArgs } from 'node:util'
import { config } from './config.ts'
import { migrateDb } from './db/index.ts'
import { newPassword, PASSWORD_MIN_LENGTH } from './dto/auth.ts'
import { needsSetup, resetOwnerPassword } from './services/users/index.ts'
import { hashPassword } from './utils/password.ts'

export interface CliIo {
  out: (text: string) => void
  err: (text: string) => void
  readStdin: () => Promise<string>
}

const USAGE = `Usage: torsher <command>

Commands:
  reset-password           Set a new random owner password and print it
  reset-password --stdin   Read the new owner password from standard input
  help                     Show this help`

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

function hasAccount() {
  // Открытие базы создало бы пустой файл, если команду запустили не с тем
  // окружением, что у сервера
  if (config.databasePath !== ':memory:' && !existsSync(config.databasePath))
    return false

  migrateDb()

  return !needsSetup()
}

async function resetPassword(fromStdin: boolean, io: CliIo) {
  if (!hasAccount()) {
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

export async function runCli(argv: string[], io: CliIo) {
  let parsed

  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: { stdin: { type: 'boolean', default: false } },
    })
  }
  catch (err) {
    io.err((err as Error).message)
    io.err(USAGE)

    return 2
  }

  const [command, ...rest] = parsed.positionals

  if (command === 'reset-password' && rest.length === 0)
    return resetPassword(parsed.values.stdin, io)

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
