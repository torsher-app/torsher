import { eq } from 'drizzle-orm'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { httpAddons, users } from '../db/schema.ts'
import {
  addonRevisionSignal,
  listEnabledAddons,
  readAddonResource,
} from '../services/addons/index.ts'
import { addonTransportDeps } from '../services/addons/transport.ts'
import { netResolveDeps } from '../services/net/index.ts'
import { decryptSecret } from '../services/secrets/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const root = '/api/sources/http-addons'
const cookies = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'hash' })
    .run()
})
afterEach(() => {
  vi.restoreAllMocks()
  getDb().delete(httpAddons).run()
})
afterAll(() => app.close())

const manifest = {
  id: 'example.remote',
  name: 'Example Add-on',
  version: '1.0.0',
  types: ['movie'],
  resources: ['stream', 'subtitles'],
}

describe('hTTP add-on management', () => {
  it('keeps configuration write-only, checks ownership and invalidates the old revision', async () => {
    const url
      = 'https://addon.example/configured-path/manifest.json?token=fixture-secret'
    vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
    const send = vi
      .spyOn(addonTransportDeps, 'send')
      .mockImplementation(async () => ({
        response: Response.json({
          ...manifest,
          name: 'Name echoes fixture-secret',
        }),
        destroy: async () => {},
      }))
    expect((await app.inject({ method: 'GET', url: root })).statusCode).toBe(
      401,
    )
    expect(
      (
        await app.inject({
          method: 'POST',
          url: root,
          cookies,
          headers: {
            'sec-fetch-site': 'cross-site',
            'origin': 'https://foreign.example',
          },
          payload: { url },
        })
      ).statusCode,
    ).toBe(403)
    expect(send).not.toHaveBeenCalled()

    const installed = await app.inject({
      method: 'POST',
      url: root,
      cookies,
      payload: { url },
    })
    expect(installed.statusCode, installed.body).toBe(201)
    const { id } = installed.json()
    expect(installed.json()).toMatchObject({
      origin: 'https://addon.example',
      capabilities: { name: '', stream: true, subtitles: true },
      selections: { stream: false, subtitles: false, catalogs: [] },
    })
    const row = getDb()
      .select()
      .from(httpAddons)
      .where(eq(httpAddons.id, id))
      .get()!
    expect(row.encryptedUrl).not.toContain('fixture-secret')
    expect(decryptSecret(row.encryptedUrl)).toBe(url)
    expect(listEnabledAddons('stream')).toEqual([])

    const listed = await app.inject({ method: 'GET', url: root, cookies })
    expect(listed.statusCode).toBe(200)
    expect(listed.body).not.toMatch(
      /fixture-secret|configured-path|encryptedUrl/,
    )
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${root}/${id}`,
          cookies,
          payload: {
            selections: { stream: true, subtitles: false, catalogs: [] },
          },
        })
      ).statusCode,
    ).toBe(200)
    const active = listEnabledAddons('stream')[0]!
    const signal = addonRevisionSignal(active)
    expect(signal.aborted).toBe(false)

    send.mockResolvedValueOnce({
      response: new Response('fixture-secret', { status: 502 }),
      destroy: async () => {},
    })
    const replace = await app.inject({
      method: 'PATCH',
      url: `${root}/${id}`,
      cookies,
      payload: {
        url: 'https://replacement.example/manifest.json?token=new-secret',
      },
    })
    expect(replace.statusCode).toBe(502)
    expect(replace.body).not.toMatch(/fixture-secret|new-secret/)
    expect(listEnabledAddons('stream')[0]?.revision).toBe(active.revision)
    expect(signal.aborted).toBe(false)

    expect(
      (await app.inject({ method: 'DELETE', url: `${root}/${id}`, cookies }))
        .statusCode,
    ).toBe(204)
    expect(signal.aborted).toBe(true)
  })

  it('shares concurrent resource reads and backs off from an upstream 429', async () => {
    vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
    const send = vi
      .spyOn(addonTransportDeps, 'send')
      .mockResolvedValueOnce({
        response: Response.json(manifest),
        destroy: async () => {},
      })
      .mockResolvedValueOnce({
        response: Response.json({
          streams: Array.from({ length: 110 }, () => ({})),
        }),
        destroy: async () => {},
      })
      .mockResolvedValueOnce({
        response: new Response('private upstream error', {
          status: 429,
          headers: { 'retry-after': '60' },
        }),
        destroy: async () => {},
      })

    const installed = await app.inject({
      method: 'POST',
      url: root,
      cookies,
      payload: {
        url: 'https://addon.example/manifest.json',
        selections: { stream: true, subtitles: false, catalogs: [] },
      },
    })
    expect(installed.statusCode).toBe(201)
    const addon = listEnabledAddons('stream')[0]!
    const results = await Promise.all([
      readAddonResource(addon, 'stream', 'movie', 'tt100'),
      readAddonResource(addon, 'stream', 'movie', 'tt100'),
    ])
    expect(results).toEqual(
      Array.from({ length: 2 }, () => ({
        streams: Array.from({ length: 100 }, () => ({})),
      })),
    )
    await expect(
      readAddonResource(addon, 'stream', 'movie', 'tt200'),
    ).rejects.toThrow('rate_limited')
    await expect(
      readAddonResource(addon, 'stream', 'movie', 'tt300'),
    ).rejects.toThrow('rate_limited')
    expect(send).toHaveBeenCalledTimes(3)
  })

  it('requires an explicit LAN preview and a new approval after DNS changes', async () => {
    const url = 'http://addon.example:8000/configured/manifest.json'
    const dns = vi
      .spyOn(netResolveDeps, 'routeAddresses')
      .mockResolvedValue(['192.168.10.12'])
    const send = vi
      .spyOn(addonTransportDeps, 'send')
      .mockImplementation(async () => ({
        response: Response.json(manifest),
        destroy: async () => {},
      }))
    const denied = await app.inject({
      method: 'POST',
      url: root,
      cookies,
      payload: { url },
    })
    expect(denied.statusCode).toBe(409)
    expect(denied.json()).toMatchObject({ kind: 'needs_confirmation' })
    const preview = await app.inject({
      method: 'POST',
      url: `${root}/preview`,
      cookies,
      payload: { url },
    })
    expect(preview.statusCode, preview.body).toBe(200)
    const approval = preview.json()
    expect(approval).toMatchObject({
      origin: 'http://addon.example:8000',
      addresses: ['192.168.10.12'],
    })
    expect(send).not.toHaveBeenCalled()

    const installed = await app.inject({
      method: 'POST',
      url: root,
      cookies,
      payload: { url, approvalId: approval.approvalId },
    })
    expect(installed.statusCode, installed.body).toBe(201)
    const { id } = installed.json()
    expect(send).toHaveBeenCalledTimes(1)

    dns.mockResolvedValue(['192.168.10.13'])
    const recheck = await app.inject({
      method: 'POST',
      url: `${root}/${id}/check`,
      cookies,
      payload: {},
    })
    expect(recheck.statusCode, recheck.body).toBe(200)
    expect(recheck.json()).toMatchObject({
      checkError: 'address_changed',
      lanAddresses: ['192.168.10.12'],
    })
    expect(send).toHaveBeenCalledTimes(1)
    const renewed = await app.inject({
      method: 'POST',
      url: `${root}/preview`,
      cookies,
      payload: { id },
    })
    const confirmed = await app.inject({
      method: 'POST',
      url: `${root}/${id}/check`,
      cookies,
      payload: { approvalId: renewed.json().approvalId },
    })
    expect(confirmed.json()).toMatchObject({
      checkError: null,
      lanAddresses: ['192.168.10.13'],
    })
    expect(send).toHaveBeenCalledTimes(2)
  })
})
