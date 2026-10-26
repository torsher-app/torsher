import type { CliIo, CliPaths } from './cli.ts'
import { Buffer } from 'node:buffer'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { generatePassword, runCli } from './cli.ts'
import { getDb, migrateDb } from './db/index.ts'
import { users } from './db/schema.ts'
import { createBackup } from './services/backups/create.ts'
import { deriveKeyMaterial } from './services/backups/crypto.ts'
import {
  createFileDb,
  seedData,
  tempDataDir,
} from './services/backups/fixtures/index.ts'
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

beforeAll(async () => {
  await migrateDb()
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

describe('копии из командной строки', () => {
  let paths: CliPaths
  let backups: string

  beforeAll(() => {
    const dataDir = tempDataDir()
    const { db, dbPath } = createFileDb(dataDir)

    seedData(db)
    db.close()
    paths = { databasePath: dbPath, dataDir }
    backups = join(dataDir, 'backups')
  })

  afterAll(() => {
    rmSync(paths.dataDir, { recursive: true, force: true })
  })

  it('torsher backup — ручная копия, имя и размер', async () => {
    const { io, out } = fakeIo()

    expect(await runCli(['backup'], io, paths)).toBe(0)

    const [name] = readdirSync(backups)

    expect(name).toMatch(/-manual-v.+\.db\.gz$/)
    expect(out.join('\n')).toContain(`Backup created: ${name} (`)
  })

  it('torsher backups — имя, причина, версия, размер', async () => {
    const { io, out } = fakeIo()

    expect(await runCli(['backups'], io, paths)).toBe(0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatch(
      /^torsher-backup-\S+\.db\.gz {2}manual {2}v\S+ {2}[\d.]+ (?:B|KB|MB)$/,
    )
  })

  it('torsher restore --password-stdin: проверка и ожидание перезапуска', async () => {
    const material = await deriveKeyMaterial('backup password')
    const created = await createBackup({
      dbPath: paths.databasePath,
      tmpDir: join(paths.dataDir, 'backups-tmp'),
      dir: backups,
      reason: 'scheduled',
      version: '1.0.0',
      secretKey: Buffer.alloc(32, 5),
      keyMaterial: material,
      now: new Date('2026-10-01T04:00:00Z'),
    })

    const wrong = fakeIo('nope\n')

    expect(
      await runCli(
        ['restore', created.name, '--password-stdin'],
        wrong.io,
        paths,
      ),
    ).toBe(1)
    expect(wrong.err.join('\n')).toContain('Wrong password')

    const missing = fakeIo()

    expect(await runCli(['restore', created.name], missing.io, paths)).toBe(1)
    expect(missing.err.join('\n')).toContain('--password-stdin')

    const { io, out } = fakeIo('backup password\n')

    expect(
      await runCli(['restore', created.name, '--password-stdin'], io, paths),
    ).toBe(0)
    expect(out.join('\n')).toContain('docker restart torsher')
    expect(
      JSON.parse(readFileSync(join(paths.dataDir, 'restore.json'), 'utf8')),
    ).toMatchObject({
      state: 'pending',
      backup: created.name,
    })
    expect(existsSync(join(paths.dataDir, 'restore-pending.db'))).toBe(true)
    expect(
      readdirSync(backups).some(name => name.includes('-pre-restore-')),
    ).toBe(true)
  })

  it('torsher restore работает, когда текущая база не открывается', async () => {
    const dataDir = tempDataDir()
    const broken = { databasePath: join(dataDir, 'torsher.db'), dataDir }
    const [manual] = readdirSync(backups).filter(name =>
      name.includes('-manual-'),
    )

    try {
      mkdirSync(join(dataDir, 'backups'))
      writeFileSync(broken.databasePath, 'definitely not a database')

      const { io, out, err } = fakeIo()

      expect(
        await runCli(['restore', join(backups, manual!)], io, broken),
      ).toBe(0)
      expect(err.join('\n')).toContain('could not be backed up')
      expect(out.join('\n')).toContain('docker restart torsher')
      expect(
        JSON.parse(readFileSync(join(dataDir, 'restore.json'), 'utf8')),
      ).toMatchObject({
        state: 'pending',
        backup: manual,
      })
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('копии подписаны версией, с которой работала база, а не версией команды', async () => {
    const dataDir = tempDataDir()
    const { db, dbPath } = createFileDb(dataDir)
    const newer = { databasePath: dbPath, dataDir }
    const [manual] = readdirSync(backups).filter(name =>
      name.includes('-manual-'),
    )

    try {
      seedData(db)
      db.prepare(
        'INSERT INTO server_versions (version, started_at) VALUES (?, ?), (?, ?)',
      ).run('0.9.1', 0, '0.9.2', 0)
      db.close()

      expect(await runCli(['backup'], fakeIo().io, newer)).toBe(0)

      const { io, out } = fakeIo()

      expect(await runCli(['restore', join(backups, manual!)], io, newer)).toBe(
        0,
      )
      expect(out.join('\n')).toContain('docker compose up -d')

      const names = readdirSync(join(dataDir, 'backups'))

      expect(names.find(name => name.includes('-manual-'))).toMatch(
        /-manual-v0\.9\.2\.db\.gz$/,
      )
      expect(names.find(name => name.includes('-pre-restore-'))).toMatch(
        /-pre-restore-v0\.9\.2\.db\.gz$/,
      )
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('неизвестная копия — понятная ошибка', async () => {
    const { io, err } = fakeIo()

    expect(
      await runCli(
        ['restore', 'torsher-backup-20200101T000000Z-manual-v1.0.0.db.gz'],
        io,
        paths,
      ),
    ).toBe(1)
    expect(err.join('\n')).toContain('Backup not found')
  })
  it('ключ из пароля не расшифровывается — key_unavailable понятным текстом', async () => {
    const dataDir = tempDataDir()
    const { db, dbPath } = createFileDb(dataDir)

    try {
      seedData(db)
      db.prepare(
        'INSERT INTO server_settings (key, value, updated_at) VALUES (?, ?, ?)',
      ).run(
        'backups',
        JSON.stringify({
          encryption: { mode: 'password', keyMaterial: 'v1:bad:bad:bad' },
        }),
        0,
      )
      db.close()

      const { io, err } = fakeIo()

      expect(
        await runCli(['backup'], io, { databasePath: dbPath, dataDir }),
      ).toBe(1)
      expect(err.join('\n')).toContain('backup password cannot be read')
    }
    finally {
      rmSync(dataDir, { recursive: true, force: true })
    }
  })

  it('битый файл ключа секретов — причина без стека, код 1', async () => {
    const dataDir = tempDataDir()
    const { db, dbPath } = createFileDb(dataDir)

    db.close()
    writeFileSync(join(dataDir, 'secret.key'), 'broken')
    vi.stubEnv('TORSHER_SECRET', '')

    try {
      const { io, err } = fakeIo()

      expect(
        await runCli(['backup'], io, { databasePath: dbPath, dataDir }),
      ).toBe(1)
      expect(err).toEqual(['Secret key file is corrupted'])
    }
    finally {
      vi.unstubAllEnvs()
      rmSync(dataDir, { recursive: true, force: true })
    }
  })
})

describe('перенос данных из командной строки', () => {
  const dir = join(tempDataDir(), 'transfer')

  beforeAll(() => {
    mkdirSync(dir, { recursive: true })
  })

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('torsher export пишет файл, torsher import --dry-run показывает сводку', async () => {
    const file = join(dir, 'export.json')
    const exported = fakeIo()

    expect(await runCli(['export', '--out', file], exported.io)).toBe(0)

    const document = JSON.parse(readFileSync(file, 'utf8'))

    expect(document).toMatchObject({
      format: 'torsher-export',
      scope: 'server',
    })

    const imported = fakeIo()

    expect(await runCli(['import', file, '--dry-run'], imported.io)).toBe(0)
    expect(imported.out.join('\n')).toContain('positions +0')
  })

  it('torsher import: не экспорт — понятная ошибка', async () => {
    const file = join(dir, 'other.json')

    writeFileSync(file, '{"hello":"world"}')

    const { io, err } = fakeIo()

    expect(await runCli(['import', file], io)).toBe(1)
    expect(err.join('\n')).toContain('not a Torsher export')
  })

  it('torsher import сливает и печатает копию перед импортом', async () => {
    const { serverImportDeps }
      = await import('./services/transfer/serverImport.ts')

    vi.spyOn(serverImportDeps, 'backup').mockResolvedValue('pre-import-copy')

    const file = join(dir, 'export.json')
    const { io, out } = fakeIo()

    expect(await runCli(['import', file], io)).toBe(0)
    expect(out.join('\n')).toContain(
      'Backup before the import: pre-import-copy',
    )
  })
})
