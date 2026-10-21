import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from './app.ts'

const root = mkdtempSync(join(tmpdir(), 'torsher-clients-'))
const dirs = { tv: join(root, 'tv'), panel: join(root, 'panel') }

function file(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

file(join(dirs.tv, 'index.html'), '<title>tv</title>')
file(join(dirs.tv, 'assets/index-abc123.js'), 'console.log("tv")')
file(join(dirs.panel, 'index.html'), '<title>panel</title>')
file(join(dirs.panel, '_nuxt/entry.abc123.js'), 'console.log("panel")')
file(join(dirs.panel, '_nuxt/builds/latest.json'), '{}')
file(join(dirs.panel, 'favicon.ico'), 'icon')

const app = createApp({}, dirs)

afterAll(async () => {
  await app.close()
  rmSync(root, { recursive: true, force: true })
})

describe('витрина', () => {
  it('отдаёт index.html на / без кэша', async () => {
    const res = await app.inject({ url: '/' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.body).toContain('tv')
  })

  it('кэширует ассеты с хешем навсегда', async () => {
    const res = await app.inject({ url: '/assets/index-abc123.js' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    )
  })

  it('отвечает 404 на неизвестный файл', async () => {
    const res = await app.inject({ url: '/assets/missing.js' })

    expect(res.statusCode).toBe(404)
  })
})

describe('панель', () => {
  it('перенаправляет /panel на /panel/', async () => {
    const res = await app.inject({ url: '/panel' })

    expect(res.statusCode).toBe(302)
    expect(res.headers.location).toBe('/panel/')
  })

  it('отдаёт index.html на /panel/', async () => {
    const res = await app.inject({ url: '/panel/' })

    expect(res.statusCode).toBe(200)
    expect(res.headers['cache-control']).toBe('no-cache')
    expect(res.body).toContain('panel')
  })

  it.each(['/panel/sources', '/panel/settings/about?tab=1'])(
    'отдаёт index.html на маршрут %s',
    async (url) => {
      const res = await app.inject({ url })

      expect(res.statusCode).toBe(200)
      expect(res.headers['content-type']).toContain('text/html')
      expect(res.headers['cache-control']).toBe('no-cache')
      expect(res.body).toContain('panel')
    },
  )

  it('кэширует ассеты Nuxt навсегда, а манифест сборки — нет', async () => {
    const asset = await app.inject({ url: '/panel/_nuxt/entry.abc123.js' })
    const manifest = await app.inject({
      url: '/panel/_nuxt/builds/latest.json',
    })
    const favicon = await app.inject({ url: '/panel/favicon.ico' })

    expect(asset.headers['cache-control']).toBe(
      'public, max-age=31536000, immutable',
    )
    expect(manifest.headers['cache-control']).toBe('no-cache')
    expect(favicon.headers['cache-control']).toBe('no-cache')
  })

  it('отвечает 404 на потерянный ассет, а не index.html', async () => {
    const res = await app.inject({ url: '/panel/_nuxt/missing.js' })

    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ message: 'Not Found' })
  })
})

describe('api', () => {
  it('не перехватывается раздачей клиентов', async () => {
    const res = await app.inject({ url: '/api/health' })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ status: 'ok' })
  })

  it('отвечает JSON 404 на неизвестный роут', async () => {
    const res = await app.inject({ url: '/api/missing' })

    expect(res.statusCode).toBe(404)
    expect(res.headers['content-type']).toContain('application/json')
  })
})
