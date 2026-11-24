import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { serverSettings } from '../../db/schema.ts'
import { markMoving, unmarkMoving } from '../storage/moving.ts'
import {
  getTorrentSettings,
  pendingRestartKeys,
  resetLaunched,
  saveTorrentSettings,
} from '../torrents/settings.ts'
import { recoverableNetwork } from './fixtures/index.ts'
import { createEngine, restartEngine } from './index.ts'
import { createEngineSupervisor } from './supervisor.ts'

vi.mock('./supervisor.ts', () => ({
  createEngineSupervisor: vi.fn(),
}))

const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
const createSupervisor = vi.mocked(createEngineSupervisor)

beforeAll(() => migrateDb())

afterEach(() => {
  getDb().delete(serverSettings).run()
  resetLaunched()
  vi.unstubAllEnvs()
})

it('сохраняет применённую сеть при автоматических запусках и применяет ручной снимок', () => {
  const temp = mkdtempSync(join(tmpdir(), 'torsher-engine-settings-'))
  vi.stubEnv('DOWNLOADS_PATH', temp)
  const restart = vi.fn<ReturnType<typeof createEngineSupervisor>['restart']>()
  createSupervisor.mockReturnValue({
    status: 'ready',
    start: vi.fn(),
    stop: vi.fn(),
    restart,
    kill: vi.fn(),
    recentCrashes: () => 0,
  })

  try {
    saveTorrentSettings({ bindInterface: 'wg0', peerPort: 51413 })
    createEngine(log)
    const options = createSupervisor.mock.calls.at(-1)![0]
    expect(options.args(40000)).toContain('wg0')

    saveTorrentSettings({
      bindInterface: '',
      peerPort: 51414,
      downloadLimit: 123,
    })
    const automatic = options.args(40001)
    expect(automatic).toEqual(
      expect.arrayContaining(['--bind-interface', 'wg0', '51413', '123']),
    )
    expect(automatic).not.toContain('51414')
    expect(pendingRestartKeys(getTorrentSettings())).toEqual([
      'peerPort',
      'bindInterface',
    ])

    expect(options.network?.restartAllowed(recoverableNetwork)).toBe(true)
    markMoving('another-torrent')
    expect(options.network?.restartAllowed(recoverableNetwork)).toBe(false)
    unmarkMoving('another-torrent')
    expect(
      options.network?.restartAllowed({
        ...recoverableNetwork,
        bindInterface: 'vpn0',
      }),
    ).toBe(false)

    restart.mockReturnValueOnce(false)
    expect(restartEngine({ graceful: true, applySettings: true })).toBe(false)
    expect(options.args(40002)).toContain('wg0')

    restart.mockReturnValue(true)
    expect(restartEngine()).toBe(true)
    expect(options.args(40003)).toContain('wg0')

    expect(restartEngine({ graceful: true, applySettings: true })).toBe(true)
    // Сохранение на уже начавшемся перезапуске не попадает в подтверждённый снимок.
    saveTorrentSettings({ bindInterface: 'vpn0' })
    expect(options.args(40004)).not.toContain('--bind-interface')
    expect(options.args(40005)).toContain('51414')
    expect(pendingRestartKeys(getTorrentSettings())).toEqual(['bindInterface'])
  }
  finally {
    unmarkMoving('another-torrent')
    rmSync(temp, { recursive: true, force: true })
  }
})
