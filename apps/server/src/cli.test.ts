import type { CliIo } from './cli.ts'
import { beforeAll, describe, expect, it } from 'vitest'
import { generatePassword, runCli } from './cli.ts'
import { getDb, migrateDb } from './db/index.ts'
import { users } from './db/schema.ts'
import { createOwner } from './services/users/index.ts'
import { verifyPassword } from './utils/password.ts'

function fakeIo(stdin = '') {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    out: text => out.push(text),
    err: text => err.push(text),
    readStdin: async () => stdin,
  }

  return { io, out, err }
}

function owner() {
  return getDb().select().from(users).get()!
}

beforeAll(() => {
  migrateDb()
})

describe('torsher reset-password', () => {
  it('без аккаунта отправляет в панель и выходит с ошибкой', async () => {
    const { io, err } = fakeIo()

    expect(await runCli(['reset-password'], io)).toBe(1)
    expect(err.join('\n')).toContain('create the owner account')
  })

  it('ставит случайный пароль, печатает его и выкидывает сессии', async () => {
    createOwner({
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'hash',
    })

    const { io, out } = fakeIo()

    expect(await runCli(['reset-password'], io)).toBe(0)

    const printed = out
      .map(line => line.trim())
      .find(line => /^[a-z0-9-]{23}$/.test(line))

    expect(printed).toBeDefined()
    expect(await verifyPassword(printed!, owner().passwordHash)).toBe(true)
    expect(owner().sessionVersion).toBe(1)
  })

  it('берёт пароль из stdin без перевода строки', async () => {
    const { io, out } = fakeIo('my new password\n')

    expect(await runCli(['reset-password', '--stdin'], io)).toBe(0)
    expect(await verifyPassword('my new password', owner().passwordHash)).toBe(
      true,
    )
    expect(out.join('\n')).not.toContain('my new password')
    expect(owner().sessionVersion).toBe(2)
  })

  it('не принимает короткий пароль из stdin', async () => {
    const before = owner().passwordHash
    const { io, err } = fakeIo('short\n')

    expect(await runCli(['reset-password', '--stdin'], io)).toBe(1)
    expect(err.join('\n')).toContain('at least 8')
    expect(owner().passwordHash).toBe(before)
  })

  it('неизвестная команда — код 2 и справка', async () => {
    const { io, err } = fakeIo()

    expect(await runCli(['drop-database'], io)).toBe(2)
    expect(err.join('\n')).toContain('Usage: torsher')
  })
})

describe('generatePassword', () => {
  it('четыре группы по пять символов без похожих знаков', () => {
    const password = generatePassword()

    expect(password).toMatch(/^[a-z2-9]{5}(?:-[a-z2-9]{5}){3}$/)
    expect(password).not.toMatch(/[01ilo]/)
  })
})
