import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// config читает DATABASE_PATH при импорте: модули — после подмены окружения
let dataDir: string
let backups: typeof import('./index.ts')
let state: typeof import('./restore-state.ts')
let stateModule: typeof import('./state.ts')

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'torsher-status-'))
  vi.stubEnv('DATABASE_PATH', join(dataDir, 'torsher.db'))
  vi.resetModules()

  const db = await import('../../db/index.ts')

  await db.migrateDb()
  backups = await import('./index.ts')
  state = await import('./restore-state.ts')
  stateModule = await import('./state.ts')
})

afterAll(() => {
  vi.unstubAllEnvs()
  rmSync(dataDir, { recursive: true, force: true })
})

describe('состояние восстановления для панели', () => {
  it('pending из restore.json (команда в контейнере) — «ожидает перезапуска»', () => {
    state.writeRestoreState(join(dataDir, 'restore.json'), {
      state: 'pending',
      backup: 'torsher-backup-20261024T040000Z-manual-v1.0.0.db.gz',
      requestedAt: '2026-10-24T05:00:00.000Z',
    })

    expect(backups.restoreStatus()).toEqual({
      state: 'pending',
      backup: 'torsher-backup-20261024T040000Z-manual-v1.0.0.db.gz',
      at: '2026-10-24T05:00:00.000Z',
      warnings: [],
    })
    rmSync(join(dataDir, 'restore.json'))
  })

  it('два запроса подряд: второй сразу busy, отказ первого снимает занятость', async () => {
    const missing = {
      path: join(dataDir, 'missing.db.gz'),
      backupName: 'missing.db.gz',
    }
    const first = backups.requestRestore(missing)
    const second = backups.requestRestore(missing)

    await expect(second).rejects.toMatchObject({ kind: 'busy' })
    await expect(first).rejects.toMatchObject({ kind: 'not_found' })
    expect(backups.restoreStatus()).toBeUndefined()

    await expect(backups.requestRestore(missing)).rejects.toMatchObject({
      kind: 'not_found',
    })
  })

  it('восстановление применилось — давность копии считается заново', () => {
    const { getBackupState, updateBackupState } = stateModule

    updateBackupState({ watchSince: '2020-01-01T00:00:00.000Z' })
    state.writeRestoreState(join(dataDir, 'restore.json'), {
      state: 'verified',
      backup: 'torsher-backup-20261024T040000Z-manual-v1.0.0.db.gz',
      at: new Date().toISOString(),
      warnings: [],
    })

    backups.finalizeRestoreNow()

    expect(Date.parse(getBackupState().watchSince!)).toBeGreaterThan(
      Date.now() - 60_000,
    )
    expect(state.readRestoreState(join(dataDir, 'restore.json'))?.state).toBe(
      'done',
    )
    rmSync(join(dataDir, 'restore.json'))
  })

  it('замок занят другим снимком — busy без ошибки в журнале', async () => {
    const { acquireBackupLock } = await import('./lock.ts')
    const { default: pino } = await import('pino')
    const { installLogger } = await import('../logs/index.ts')
    const lines: string[] = []
    const dir = join(dataDir, 'backups')

    mkdirSync(dir, { recursive: true })
    installLogger(
      pino({ level: 'debug' }, { write: (line: string) => lines.push(line) }),
    )

    const release = acquireBackupLock(dir)

    try {
      await expect(backups.createBackupNow('scheduled')).rejects.toMatchObject({
        kind: 'busy',
      })
    }
    finally {
      release()
      installLogger(pino({ level: 'silent' }))
    }

    const entries = lines.map(line => JSON.parse(line) as { level: number })

    expect(entries.some(entry => entry.level >= 50)).toBe(false)
    expect(entries.some(entry => entry.level === 20)).toBe(true)
  })
})
