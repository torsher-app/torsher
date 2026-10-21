import { chmod, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { serverSettings, storagePolicy, users } from '../db/schema.ts'
import {
  candidateUrls,
  defaultGateway,
  DISCOVER_TIMEOUT_MS,
  discoverDeps,
} from '../services/setup/discover.ts'
import { checkStorage } from '../services/setup/storage.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'

const GIB = 1024 ** 3
const disk = vi.hoisted(() => ({ total: 0, free: 0 }))

vi.mock('../services/storage/disk.ts', () => ({
  diskUsage: async () => ({ ...disk }),
}))

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()
let owner = {}
let root = ''

function inject(method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) {
  return app.inject({ method, url, payload, cookies: owner })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

beforeAll(async () => {
  migrateDb()
  root = await mkdtemp(join(tmpdir(), 'torsher-setup-'))
})

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(discoverDeps, 'gateway').mockResolvedValue(null)
  getDb().delete(storagePolicy).run()
  disk.total = 1000 * GIB
  disk.free = 800 * GIB
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('setup wizard', () => {
  it('server with an account from before the wizard is already set up', async () => {
    getDb()
      .insert(users)
      .values({
        id: 'old-owner',
        name: 'Old',
        email: 'old@example.com',
        passwordHash: 'x',
      })
      .run()
    owner = { [ACCESS_TOKEN_COOKIE]: signToken('old-owner', 'user_access') }

    const res = await inject('GET', '/api/setup/wizard')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ active: false, completedAt: null })

    getDb().delete(users).run()
    getDb().delete(serverSettings).run()
  })

  it('new account starts the wizard at storage', async () => {
    const { id } = createOwner({
      name: 'Owner',
      email: 'owner@example.com',
      passwordHash: 'x',
    })

    owner = { [ACCESS_TOKEN_COOKIE]: signToken(id, 'user_access') }

    expect((await inject('GET', '/api/setup/wizard')).json()).toEqual({
      active: true,
      step: 'storage',
      skipped: [],
      completedAt: null,
    })
  })

  it('remembers the step and skipped steps until completed', async () => {
    const step = await inject('PUT', '/api/setup/wizard', {
      step: 'sources',
      skipped: ['network', 'network'],
      completed: false,
    })

    expect(step.json()).toMatchObject({
      active: true,
      step: 'sources',
      skipped: ['network'],
    })

    const done = await inject('PUT', '/api/setup/wizard', {
      step: 'done',
      skipped: ['network'],
      completed: true,
    })
    const completedAt = done.json().completedAt

    expect(done.json()).toMatchObject({ active: false, step: 'done' })
    expect(completedAt).toEqual(expect.any(String))

    // Повторное «Готово» не сдвигает время завершения
    const again = await inject('PUT', '/api/setup/wizard', {
      step: 'done',
      skipped: ['network'],
      completed: true,
    })

    expect(again.json().completedAt).toBe(completedAt)
  })

  it('rejects an unknown step', async () => {
    const res = await inject('PUT', '/api/setup/wizard', {
      step: 'account',
      skipped: [],
      completed: false,
    })

    expect(res.statusCode).toBe(400)
  })

  it('requires the owner session', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/setup/wizard' })

    expect(res.statusCode).toBe(401)
  })
})

describe('storage check', () => {
  it('reports writable directories and a missing one by its parent', async () => {
    const data = join(root, 'db')
    await mkdir(data)

    const result = await checkStorage({
      dataDir: data,
      downloadsDir: join(root, 'torrents', 'nested'),
    })

    expect(result.data).toEqual({ path: data, exists: true, writable: true })
    expect(result.downloads).toMatchObject({ exists: false, writable: true })
    expect(result.sameFilesystem).toBe(true)
    expect(result.space).toEqual({
      total: 1000 * GIB,
      free: 800 * GIB,
      status: 'ok',
    })
  })

  // root пишет в любой каталог, проверка прав под ним ничего не скажет
  it.skipIf(process.getuid?.() === 0)(
    'reports a directory without write access',
    async () => {
      const locked = join(root, 'locked')
      await mkdir(locked)
      await chmod(locked, 0o500)

      try {
        const result = await checkStorage({
          dataDir: root,
          downloadsDir: locked,
        })

        expect(result.downloads).toEqual({
          path: locked,
          exists: true,
          writable: false,
        })
        expect(result.data.writable).toBe(true)
      }
      finally {
        await chmod(locked, 0o700)
      }
    },
  )

  it('warns when the cache does not fit and fails below the reserve', async () => {
    const paths = { dataDir: root, downloadsDir: root }

    // По умолчанию на 1000 ГБ: кэш 200 ГБ, запас 20 ГБ
    disk.free = 150 * GIB
    expect((await checkStorage(paths)).space.status).toBe('low')

    disk.free = 10 * GIB
    expect((await checkStorage(paths)).space.status).toBe('critical')
  })

  it('answers through the route', async () => {
    const res = await inject('GET', '/api/setup/storage-check')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      data: { writable: expect.any(Boolean) },
      downloads: { path: expect.any(String) },
      space: { status: 'ok' },
    })
  })
})

describe('manager discovery', () => {
  it('reads the default gateway from the Linux route table', async () => {
    const table = [
      'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask',
      'eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000',
      'eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF',
    ].join('\n')

    expect(await defaultGateway(async () => table)).toBe('172.18.0.1')
    expect(
      await defaultGateway(async () => {
        throw new Error('ENOENT')
      }),
    ).toBeNull()
  })

  it('probes service names, the docker host, the gateway and this machine', () => {
    expect(candidateUrls('172.18.0.1').map(item => item.url)).toEqual([
      'http://prowlarr:9696',
      'http://host.docker.internal:9696',
      'http://172.18.0.1:9696',
      'http://127.0.0.1:9696',
      'http://jackett:9117',
      'http://host.docker.internal:9117',
      'http://172.18.0.1:9117',
      'http://127.0.0.1:9117',
    ])
  })

  it('finds Prowlarr and Jackett by their anonymous health routes', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))

      if (url.host === 'prowlarr:9696' && url.pathname === '/ping')
        return json({ status: 'OK' })

      // Тот же Jackett виден и по адресу хоста: берётся первый по порядку
      if (
        url.port === '9117'
        && url.pathname === '/health'
        && ['host.docker.internal', '127.0.0.1'].includes(url.hostname)
      ) {
        return json({ status: 'OK' })
      }

      throw new TypeError('fetch failed')
    })

    const res = await inject('POST', '/api/setup/discover-managers')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({
      items: [
        { kind: 'prowlarr', url: 'http://prowlarr:9696' },
        { kind: 'jackett', url: 'http://host.docker.internal:9117' },
      ],
    })
  })

  it('does not mistake another service on the port for a manager', async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = new URL(String(input))

      // Prowlarr на чужой путь отдаёт страницу интерфейса
      if (url.pathname === '/health') {
        return new Response('<html></html>', {
          headers: { 'Content-Type': 'text/html' },
        })
      }

      return json({ status: 'Error' }, url.pathname === '/ping' ? 500 : 404)
    })

    expect(
      (await inject('POST', '/api/setup/discover-managers')).json(),
    ).toEqual({
      items: [],
    })
  })

  it('gives up on silent addresses after a short timeout', async () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason))
        }),
    )

    const startedAt = Date.now()
    const res = await inject('POST', '/api/setup/discover-managers')

    expect(res.json()).toEqual({ items: [] })
    expect(Date.now() - startedAt).toBeLessThan(DISCOVER_TIMEOUT_MS + 1500)
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })
})
