import { once } from 'node:events'
import { get as httpGet } from 'node:http'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, DEVICE_TOKEN_COOKIE } from '../config.ts'
import { migrateDb } from '../db/index.ts'
import {
  confirmPairing,
  pollPairing,
  revokeDevice,
  startPairing,
} from '../services/devices/index.ts'
import {
  cancel,
  limits,
  shutdownSpeedtests,
  speedtestDeps,
  startLocal,
} from '../services/speedtest/index.ts'
import { createOwner } from '../services/users/index.ts'
import { signToken } from '../utils/token.ts'
import { speedtestLimiter } from './speedtest.ts'

const app = createApp()
let owner: Record<string, string>
let device: Record<string, string>
let ownerId: string
let deviceId: string
beforeAll(async () => {
  await migrateDb()
  const user = createOwner({ username: 'Owner', passwordHash: 'x' })
  ownerId = user.id
  owner = { [ACCESS_TOKEN_COOKIE]: signToken(user.id, 'user_access') }
  const pairing = startPairing({ type: 'tv' })
  confirmPairing({ code: pairing.code, name: 'Test TV', userId: user.id })
  const poll = pollPairing(pairing.secret)
  if (poll?.status !== 'approved')
    throw new Error('pairing failed')
  deviceId = poll.device.id
  device = { [DEVICE_TOKEN_COOKIE]: poll.token }
  await app.ready()
})
beforeEach(() => {
  speedtestLimiter.reset()
  vi.spyOn(speedtestDeps, 'fetch').mockRejectedValue(
    new Error('External network forbidden in route tests'),
  )
})
afterEach(async () => {
  await shutdownSpeedtests()
  vi.restoreAllMocks()
})
afterAll(() => app.close())
function newViewer(name: string) {
  const pairing = startPairing({ type: 'tv' })
  confirmPairing({ code: pairing.code, name, userId: ownerId })
  const poll = pollPairing(pairing.secret)
  if (poll?.status !== 'approved')
    throw new Error('pairing failed')
  return { id: poll.device.id, cookies: { [DEVICE_TOKEN_COOKIE]: poll.token } }
}
function post(path: string, cookies = owner, headers = {}) {
  return app.inject({
    method: 'POST',
    url: `/api/speedtest/${path}`,
    cookies,
    headers,
    payload: {},
  })
}
describe('authenticated speedtest routes', () => {
  it('requires authentication while keeping network settings owner-only', async () => {
    expect((await post('local', {})).statusCode).toBe(401)
    expect((await post('internet', {})).statusCode).toBe(401)
    expect((await post('internet', device)).statusCode).toBe(201)
    expect(
      (await app.inject({ url: '/api/net/routes', cookies: device }))
        .statusCode,
    ).toBe(401)
  })
  it('rejects viewer cross-site start/cancel without widening other viewer policy', async () => {
    const crossSite = {
      'sec-fetch-site': 'same-site',
      'origin': 'http://other.example',
    }
    expect((await post('local', device, crossSite)).statusCode).toBe(403)
    const local = (await post('local', device)).json()
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/speedtest/local/${local.id}`,
          cookies: device,
          headers: crossSite,
        })
      ).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          url: `/api/speedtest/local/${local.id}/latency`,
          cookies: owner,
        })
      ).statusCode,
    ).toBe(404)
    expect((await post('local')).statusCode).toBe(409)
  })
  it('validates finite download query and HEAD does not consume the session', async () => {
    const before = limits.localBytes
    limits.localBytes = 65536
    try {
      const local = (await post('local')).json()
      const path = `/api/speedtest/local/${local.id}/download?bytes=65536&seq=0`
      expect(
        (await app.inject({ method: 'HEAD', url: path, cookies: owner }))
          .statusCode,
      ).toBe(404)
      const response = await app.inject({ url: path, cookies: owner })
      expect(response.statusCode, response.body).toBe(200)
      expect(response.rawPayload.length).toBe(65536)
      expect(
        (
          await app.inject({
            url: `/api/speedtest/local/${local.id}/download?bytes=1&seq=1`,
            cookies: owner,
          })
        ).statusCode,
      ).toBe(409)
      expect([404, 409]).toContain(
        (await app.inject({ url: path, cookies: owner })).statusCode,
      )
    }
    finally {
      limits.localBytes = before
    }
  })
  it('keeps the same job across two normal EOF responses and rejects replay and extra query fields', async () => {
    const local = (await post('local')).json()
    const path = `/api/speedtest/local/${local.id}/download`
    expect(
      (
        await app.inject({
          url: `${path}?bytes=16384&seq=0&extra=1`,
          cookies: owner,
        })
      ).statusCode,
    ).toBe(400)
    for (let seq = 0; seq < 2; seq++) {
      const response = await app.inject({
        url: `${path}?bytes=16384&seq=${seq}`,
        cookies: owner,
      })
      expect(response.statusCode).toBe(200)
      expect(response.rawPayload.byteLength).toBe(16384)
      // inject resolves before the producer close tick; real sockets below need no delay between EOFs.
      await new Promise(resolve => setImmediate(resolve))
    }
    expect(
      (await app.inject({ url: `${path}?bytes=16384&seq=0`, cookies: owner }))
        .statusCode,
    ).toBe(409)
    expect((await post('local')).statusCode).toBe(409)
    await app.inject({
      method: 'DELETE',
      url: `/api/speedtest/local/${local.id}`,
      cookies: owner,
    })
    expect((await post('local')).statusCode).toBe(201)
  })
  it('allows repeated owner starts without a frequency quota', async () => {
    for (let i = 0; i < 5; i++) {
      const local = await post('local')
      expect(local.statusCode).toBe(201)
      await app.inject({
        method: 'DELETE',
        url: `/api/speedtest/local/${local.json().id}`,
        cookies: owner,
      })
    }
  })
  it('limits successful viewer starts but not busy or invalid attempts', async () => {
    const active = await post('local')
    for (let i = 0; i < 4; i++)
      expect((await post('local', device)).statusCode).toBe(409)
    await app.inject({
      method: 'DELETE',
      url: `/api/speedtest/local/${active.json().id}`,
      cookies: owner,
    })
    for (let i = 0; i < 4; i++) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/speedtest/local',
            cookies: device,
            payload: { invalid: true },
          })
        ).statusCode,
      ).toBe(400)
    }
    for (let i = 0; i < 3; i++) {
      const local = await post('local', device)
      expect(local.statusCode).toBe(201)
      await app.inject({
        method: 'DELETE',
        url: `/api/speedtest/local/${local.json().id}`,
        cookies: device,
      })
    }
    const limited = await post('local', device)
    expect(limited.statusCode).toBe(429)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
  })
  it('rejects unsupported parameters before starting a test', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/speedtest/internet',
      cookies: owner,
      payload: { url: 'https://other.example' },
    })
    expect(response.statusCode).toBe(400)
    expect(speedtestDeps.fetch).not.toHaveBeenCalled()
  })
  it('binds all internet operations to the viewer subject, including requests carrying both cookies', async () => {
    const cookies = { ...owner, ...device }
    vi.mocked(speedtestDeps.fetch).mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('aborted'))),
        ),
    )
    const started = await post('internet', cookies)
    expect(started.statusCode).toBe(201)
    const path = `/api/speedtest/internet/${started.json().id}`
    expect((await app.inject({ url: path, cookies })).statusCode).toBe(200)
    expect((await app.inject({ url: path, cookies: owner })).statusCode).toBe(
      404,
    )
    expect(
      (await post(`internet/${started.json().id}/heartbeat`, cookies))
        .statusCode,
    ).toBe(200)
    expect(
      (await post(`internet/${started.json().id}/heartbeat`, owner)).statusCode,
    ).toBe(404)
    await app.inject({ method: 'DELETE', url: path, cookies: owner })
    expect((await post('local')).statusCode).toBe(409)
    await app.inject({ method: 'DELETE', url: path, cookies })
    expect((await post('local')).statusCode).toBe(201)
  })
  it('rejects cross-site internet mutations for devices and scopes retained results to their initiator', async () => {
    const crossSite = {
      'sec-fetch-site': 'same-site',
      'origin': 'http://other.example',
    }
    expect((await post('internet', device, crossSite)).statusCode).toBe(403)
    const started = await post('internet', device)
    const id = started.json().id
    const other = newViewer('Other TV')
    expect(
      (
        await app.inject({
          url: `/api/speedtest/internet/${id}`,
          cookies: other.cookies,
        })
      ).statusCode,
    ).toBe(404)
    expect(
      (
        await app.inject({
          url: `/api/speedtest/internet/${id}`,
          cookies: device,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await post(`internet/${id}/heartbeat`, device, crossSite)).statusCode,
    ).toBe(403)
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/speedtest/internet/${id}`,
          cookies: device,
          headers: crossSite,
        })
      ).statusCode,
    ).toBe(403)
  })
  it('shares the three-successful-start device quota across local and internet checks', async () => {
    for (const kind of ['local', 'internet', 'local']) {
      const started = await post(kind, device)
      expect(started.statusCode).toBe(201)
      await app.inject({
        method: 'DELETE',
        url: `/api/speedtest/${kind}/${started.json().id}`,
        cookies: device,
      })
    }
    const limited = await post('internet', device)
    expect(limited.statusCode).toBe(429)
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0)
    expect((await post('internet')).statusCode).toBe(201)
  })
  it('serializes only the safe provider HTTP status without a rejected response body', async () => {
    vi.mocked(speedtestDeps.fetch).mockResolvedValue(
      new Response('private provider response body', {
        status: 413,
        headers: { 'Content-Type': 'text/html' },
      }),
    )
    const started = await post('internet', device)
    const response = await app.inject({
      url: `/api/speedtest/internet/${started.json().id}`,
      cookies: device,
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      state: 'error',
      reason: 'provider_http_error',
      providerHttpStatus: 413,
    })
    expect(response.body).not.toContain('private provider response body')
    expect(speedtestDeps.fetch).toHaveBeenCalledTimes(1)
  })
  it('aborts a device internet upload immediately after that device is revoked', async () => {
    const viewer = newViewer('Upload TV')
    let now = 0
    let aborted = false
    let announce!: () => void
    const uploading = new Promise<void>((resolve) => {
      announce = resolve
    })
    vi.spyOn(speedtestDeps, 'now').mockImplementation(() => now)
    vi.mocked(speedtestDeps.fetch).mockImplementation(async (url, init) => {
      const bytes = Number(new URL(url).searchParams.get('bytes'))
      if (init?.method === 'POST') {
        for await (const _chunk of init.body as unknown as AsyncIterable<Uint8Array>) {
          /* bounded warmup upload */
        }
        announce()
        return new Promise((_resolve, reject) =>
          init.signal?.addEventListener('abort', () => {
            aborted = true
            reject(new Error('aborted'))
          }),
        )
      }
      now += bytes ? 1000 : 10
      return new Response(new Uint8Array(bytes), {
        headers: { 'Content-Type': 'application/octet-stream' },
      })
    })
    const started = await post('internet', viewer.cookies)
    await uploading
    expect(
      (
        await app.inject({
          url: `/api/speedtest/internet/${started.json().id}`,
          cookies: viewer.cookies,
        })
      ).json().phase,
    ).toBe('upload')
    revokeDevice(viewer.id)
    await Promise.resolve()
    expect(aborted).toBe(true)
    expect(
      (
        await app.inject({
          url: `/api/speedtest/internet/${started.json().id}`,
          cookies: viewer.cookies,
        })
      ).statusCode,
    ).toBe(401)
  })
  it('revoking a device stops its pending test and invalidates all operations', async () => {
    const local = (await post('local', device)).json()
    revokeDevice(deviceId)
    expect(
      (
        await app.inject({
          url: `/api/speedtest/local/${local.id}/latency`,
          cookies: device,
        })
      ).statusCode,
    ).toBe(401)
    const next = await post('local')
    expect(next.statusCode).toBe(201)
  })
})

// Real socket assertions: inject() alone buffers the response and cannot prove backpressure.
describe('local socket streaming', () => {
  it('streams incrementally, honors backpressure and frees the mutex after disconnect', async () => {
    const server = createApp()
    await server.listen({ host: '127.0.0.1', port: 0 })
    const address = server.server.address()
    if (!address || typeof address === 'string')
      throw new Error('missing socket')
    const local = startLocal('socket-owner')
    // Direct service stream uses the same producer as the authenticated route.
    await cancel(local.id, 'socket-owner', 'local')
    const started = (
      await server.inject({
        method: 'POST',
        url: '/api/speedtest/local',
        payload: {},
        cookies: owner,
      })
    ).json()
    for (let seq = 0; seq < 2; seq++) {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/speedtest/local/${started.id}/download?bytes=16384&seq=${seq}`,
        {
          headers: {
            cookie: `${ACCESS_TOKEN_COOKIE}=${owner[ACCESS_TOKEN_COOKIE]}`,
          },
        },
      )
      expect(response.status).toBe(200)
      expect((await response.arrayBuffer()).byteLength).toBe(16384)
    }
    const request = httpGet(
      `http://127.0.0.1:${address.port}/api/speedtest/local/${started.id}/download?bytes=67108864&seq=2`,
      {
        headers: {
          cookie: `${ACCESS_TOKEN_COOKIE}=${owner[ACCESS_TOKEN_COOKIE]}`,
        },
      },
    )
    try {
      const [response] = await once(request, 'response')
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain(
        'application/octet-stream',
      )
      expect(response.headers['content-encoding']).toBeUndefined()
      expect(response.headers['cache-control']).toBe('no-store, no-transform')
      expect(response.headers['x-torsher-speedtest-id']).toBe(started.id)
      expect(response.headers['x-torsher-speedtest-seq']).toBe('2')
      expect(response.headers['x-torsher-speedtest-bytes']).toBe('67108864')
      const [chunk] = await once(response, 'data')
      expect(chunk.length).toBeGreaterThan(0)
      response.pause()
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(response.readableLength).toBeLessThan(256 * 1024)
      expect((await post('local')).statusCode).toBe(409)
      response.destroy()
      await new Promise(resolve => setTimeout(resolve, 30))
      speedtestLimiter.reset()
      expect((await post('local')).statusCode).toBe(201)
    }
    finally {
      request.destroy()
      await server.close()
    }
  })
  it('preClose aborts a backpressured live socket instead of waiting for onClose', async () => {
    speedtestLimiter.reset()
    const server = createApp()
    await server.listen({ host: '127.0.0.1', port: 0 })
    const address = server.server.address()
    if (!address || typeof address === 'string')
      throw new Error('missing socket')
    const started = (
      await server.inject({
        method: 'POST',
        url: '/api/speedtest/local',
        payload: {},
        cookies: owner,
      })
    ).json()
    const request = httpGet(
      `http://127.0.0.1:${address.port}/api/speedtest/local/${started.id}/download?bytes=67108864&seq=0`,
      {
        headers: {
          cookie: `${ACCESS_TOKEN_COOKIE}=${owner[ACCESS_TOKEN_COOKIE]}`,
        },
      },
    )
    try {
      const [response] = await once(request, 'response')
      response.pause()
      const before = performance.now()
      await server.close()
      expect(performance.now() - before).toBeLessThan(1000)
    }
    finally {
      request.destroy()
      await server.close()
    }
  })
})
