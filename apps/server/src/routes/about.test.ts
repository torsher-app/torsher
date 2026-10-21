import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'

const app = createApp()

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
    })
  })

  it('берёт адрес исходников из окружения', async () => {
    vi.stubEnv('TORSHER_SOURCE_URL', 'https://example.com/fork')

    const res = await app.inject({ url: '/api/about' })

    expect(res.json()).toMatchObject({ sourceUrl: 'https://example.com/fork' })
    expect(res.json()).not.toHaveProperty('commit')
  })
})
