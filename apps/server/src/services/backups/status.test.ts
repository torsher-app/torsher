import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// config читает DATABASE_PATH при импорте: модули — после подмены окружения
let dataDir: string
let backups: typeof import('./index.ts')
let state: typeof import('./restore-state.ts')

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'torsher-status-'))
  vi.stubEnv('DATABASE_PATH', join(dataDir, 'torsher.db'))
  vi.resetModules()

  const db = await import('../../db/index.ts')

  await db.migrateDb()
  backups = await import('./index.ts')
  state = await import('./restore-state.ts')
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
})
