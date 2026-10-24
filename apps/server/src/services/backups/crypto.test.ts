import { Buffer } from 'node:buffer'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { MIGRATIONS_DIR } from '../../db/index.ts'
import { createBackup } from './create.ts'
import {
  deriveKeyMaterial,
  ENC_HEADER_BYTES,
  parseEncHeader,
} from './crypto.ts'
import {
  count,
  createFileDb,
  seedData,
  tempDataDir,
} from './fixtures/index.ts'
import { openBackupFile, verifyBackupFile } from './restore-request.ts'

const secretKey = Buffer.alloc(32, 3)
let dataDir: string
let dir: string
let dbPath: string
let plain: string
let encrypted: string
let material: Awaited<ReturnType<typeof deriveKeyMaterial>>

function verifyOptions() {
  return {
    tmpDir: join(dataDir, 'backups-tmp'),
    dataDir,
    migrationsFolder: MIGRATIONS_DIR,
  }
}

async function verify(path: string, secret = {}) {
  const opened = await openBackupFile(path, secret)

  return verifyBackupFile(path, opened, verifyOptions())
}

/** Копия файла с изменённым байтом */
function corrupt(path: string, offset: number) {
  const bytes = readFileSync(path)
  const target = join(dir, `corrupt-${offset}-${Math.random()}.db.gz.enc`)
  const index = offset < 0 ? bytes.length + offset : offset

  bytes[index] = bytes[index]! ^ 0xFF
  writeFileSync(target, bytes)

  return target
}

beforeAll(async () => {
  dataDir = tempDataDir()

  const created = createFileDb(dataDir)

  dbPath = created.dbPath
  seedData(created.db)
  created.db.close()
  dir = join(dataDir, 'backups')
  mkdirSync(dir)
  material = await deriveKeyMaterial('correct horse battery staple')

  const options = {
    dbPath,
    tmpDir: join(dataDir, 'backups-tmp'),
    dir,
    reason: 'manual' as const,
    version: '1.0.0',
    secretKey,
  }

  plain = join(dir, (await createBackup(options)).name)
  encrypted = join(
    dir,
    (
      await createBackup({
        ...options,
        keyMaterial: material,
        now: new Date(Date.now() + 5000),
      })
    ).name,
  )
})

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true })
})

function readSnapshot(path: string) {
  const db = new Database(path, { readonly: true })
  const users = count(db, 'users')

  db.close()

  return users
}

describe('формат копии', () => {
  it('gzip: распаковывается и проходит проверку, ключ секретов из манифеста', async () => {
    const verified = await verify(plain)

    expect(readSnapshot(verified.snapshotPath)).toBe(1)
    expect(verified.secretKey?.equals(secretKey)).toBe(true)
    expect(verified.manifest?.version).toBe('1.0.0')
  })

  it('.enc: имя с .enc, расшифровывается паролем и сохранённым ключом', async () => {
    expect(encrypted.endsWith('.db.gz.enc')).toBe(true)
    expect(readFileSync(encrypted).subarray(0, 9).toString()).toBe('TORSHERBK')

    const byPassword = await verify(encrypted, {
      password: 'correct horse battery staple',
    })
    const byMaterial = await verify(encrypted, { keyMaterial: material })

    expect(readSnapshot(byPassword.snapshotPath)).toBe(1)
    expect(readSnapshot(byMaterial.snapshotPath)).toBe(1)
    expect(byMaterial.secretKey?.equals(secretKey)).toBe(true)
  })

  it('неверный пароль или его нет — wrong_password по проверке ключа', async () => {
    await expect(
      openBackupFile(encrypted, { password: 'wrong' }),
    ).rejects.toMatchObject({
      kind: 'wrong_password',
    })
    await expect(openBackupFile(encrypted)).rejects.toMatchObject({
      kind: 'wrong_password',
    })
  })

  it('порча байта тела или тега — corrupt', async () => {
    await expect(
      verify(corrupt(encrypted, ENC_HEADER_BYTES + 10), {
        keyMaterial: material,
      }),
    ).rejects.toMatchObject({ kind: 'corrupt' })
    await expect(
      verify(corrupt(encrypted, -1), { keyMaterial: material }),
    ).rejects.toMatchObject({ kind: 'corrupt' })
  })

  it('порча заголовка (nonce, версия формата) — corrupt', async () => {
    await expect(
      verify(corrupt(encrypted, ENC_HEADER_BYTES - 1), {
        keyMaterial: material,
      }),
    ).rejects.toMatchObject({ kind: 'corrupt' })
    await expect(
      verify(corrupt(encrypted, 9), { keyMaterial: material }),
    ).rejects.toMatchObject({ kind: 'corrupt' })
  })

  it('битый gzip — corrupt, чужой файл — not_torsher', async () => {
    const bytes = readFileSync(plain)
    const truncated = join(dir, 'truncated.db.gz')
    const foreign = join(dir, 'foreign.db')

    writeFileSync(truncated, bytes.subarray(0, Math.floor(bytes.length / 2)))
    writeFileSync(foreign, 'hello')

    await expect(verify(truncated)).rejects.toMatchObject({ kind: 'corrupt' })
    await expect(verify(foreign)).rejects.toMatchObject({
      kind: 'not_torsher',
    })
    await expect(verify(join(dir, 'missing.db.gz'))).rejects.toMatchObject({
      kind: 'not_found',
    })
  })
  it('параметры scrypt из заголовка ограничены: память и работа', () => {
    const header = readFileSync(encrypted).subarray(0, ENC_HEADER_BYTES)
    const withParams = (log2N: number, r: number, p: number) => {
      const copy = Buffer.from(header)

      copy[10] = log2N
      copy[11] = r
      copy[12] = p

      return copy
    }

    expect(() => parseEncHeader(withParams(16, 8, 1))).not.toThrow()
    expect(() => parseEncHeader(withParams(16, 8, 5))).toThrow(
      expect.objectContaining({ kind: 'corrupt' }),
    )
    expect(() => parseEncHeader(withParams(20, 32, 1))).toThrow(
      expect.objectContaining({ kind: 'corrupt' }),
    )
    expect(() => parseEncHeader(withParams(18, 8, 4))).toThrow(
      expect.objectContaining({ kind: 'corrupt' }),
    )
  })
})
