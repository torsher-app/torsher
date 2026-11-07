import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import { migrateDb } from '../db/index.ts'

const app = createApp()

beforeAll(async () => {
  await migrateDb()
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('get /api/about', () => {
  it('отдаёт версию, лицензию и исходники без авторизации', async () => {
    vi.stubEnv('TORSHER_COMMIT', 'abc1234')

    const res = await app.inject({ url: '/api/about' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      version: expect.any(String),
      commit: 'abc1234',
      license: 'AGPL-3.0-only',
      sourceUrl: 'https://github.com/torsher-app/torsher',
      imdbAttribution: false,
    })
  })

  it.each([undefined, '0', 'true'])(
    'hides stand metadata without explicit opt-in (%s)',
    async (flag) => {
      vi.stubEnv('TORSHER_DEV_STAND', flag)
      vi.stubEnv('TORSHER_BUILD_BRANCH', 'fix/example')
      vi.stubEnv('TORSHER_STAND_NAME', 'test-stand')
      const res = await app.inject({ url: '/api/about' })
      expect(res.json()).not.toHaveProperty('devStand')
    },
  )

  it('exposes only configured build metadata on an explicit stand', async () => {
    vi.stubEnv('TORSHER_DEV_STAND', '1')
    vi.stubEnv('TORSHER_STAND_NAME', 'test-stand')
    vi.stubEnv('TORSHER_BUILD_BRANCH', 'fix/example')
    vi.stubEnv('TORSHER_BUILD_SNAPSHOT', 'abc123')
    vi.stubEnv('TORSHER_BUILD_TIME', '2026-11-06T12:00:00Z')
    vi.stubEnv('TORSHER_BUILD_DIRTY', '0')
    const res = await app.inject({ url: '/api/about' })
    expect(res.json().devStand).toEqual({
      name: 'test-stand',
      branch: 'fix/example',
      snapshot: 'abc123',
      builtAt: '2026-11-06T12:00:00Z',
      dirty: false,
    })
    vi.stubEnv('TORSHER_BUILD_DIRTY', '1')
    expect(
      (await app.inject({ url: '/api/about' })).json().devStand.dirty,
    ).toBe(true)
  })

  it('берёт версию образа из окружения', async () => {
    vi.stubEnv('TORSHER_VERSION', '1.4.0-beta.2')

    const res = await app.inject({ url: '/api/about' })

    expect(res.json()).toMatchObject({ version: '1.4.0-beta.2' })
  })

  it('берёт адрес исходников из окружения', async () => {
    vi.stubEnv('TORSHER_SOURCE_URL', 'https://example.com/fork')

    const res = await app.inject({ url: '/api/about' })

    expect(res.json()).toMatchObject({ sourceUrl: 'https://example.com/fork' })
    expect(res.json()).not.toHaveProperty('commit')
  })
})
