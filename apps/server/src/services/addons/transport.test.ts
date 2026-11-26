import type { AddressInfo } from 'node:net'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { config } from '../../config.ts'
import { migrateDb } from '../../db/index.ts'
import { netResolveDeps } from '../net/index.ts'
import {
  addonRequestHeaders,
  addonTransportDeps,
  addonUrl,
  guardedAddonFetch,
  previewAddonAddress,
} from './transport.ts'

beforeAll(() => migrateDb())
afterEach(() => vi.restoreAllMocks())

describe('hTTP add-on network policy', () => {
  it('falls back to the reachable family within the pinned address set', async () => {
    const server = createServer((request, response) => {
      response.end(request.headers.host)
    })
    try {
      server.listen({ port: 0, host: '::1', ipv6Only: true })
      await once(server, 'listening')
      const { port } = server.address() as AddressInfo
      const url = addonUrl(`http://addon.example:${port}/manifest.json`)
      const request = () => ({
        method: 'GET' as const,
        headers: new Headers(),
        signal: AbortSignal.timeout(2000),
      })

      // At this level the connector receives only already approved addresses.
      const result = await addonTransportDeps.send(
        url,
        ['127.0.0.1', '::1'],
        request(),
      )
      try {
        expect(result.response.status).toBe(200)
        await expect(result.response.text()).resolves.toBe(url.host)
      }
      finally {
        await result.destroy()
      }

      await expect(
        addonTransportDeps.send(url, ['127.0.0.1'], request()),
      ).rejects.toThrow('fetch failed')
    }
    finally {
      if (server.listening)
        await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })

  it('rejects reserved addresses and mixed DNS answers before dispatch', async () => {
    const send = vi.spyOn(addonTransportDeps, 'send')
    const dns = vi.spyOn(netResolveDeps, 'routeAddresses')
    const url = addonUrl('https://addon.example/manifest.json')
    for (const blocked of [
      '::ffff:127.0.0.1',
      '0.0.0.0',
      '100.64.0.1',
      'fe80::1',
      'fd00:ec2::254',
      '2001:db8::1',
      '192.168.10.3',
    ]) {
      dns.mockResolvedValueOnce(['8.8.4.4', blocked])
      await expect(
        guardedAddonFetch(
          url,
          { origin: url.origin, lanAddresses: [] },
          {
            kind: 'json',
          },
        ),
      ).rejects.toMatchObject({ kind: 'blocked_address' })
    }
    expect(send).not.toHaveBeenCalled()
  })

  it('requires a scoped approval and rejects changed addresses on a later hop', async () => {
    const url = addonUrl('http://addon.example:8000/configured/manifest.json')
    const policy = { origin: url.origin, lanAddresses: ['192.168.10.12'] }
    const dns = vi
      .spyOn(netResolveDeps, 'routeAddresses')
      .mockResolvedValue(['::ffff:c0a8:a0c'])
    const send = vi.spyOn(addonTransportDeps, 'send').mockResolvedValue({
      response: new Response(null, {
        status: 302,
        headers: { location: '/second/manifest.json' },
      }),
      destroy: async () => {},
    })

    await expect(previewAddonAddress(url)).resolves.toEqual({
      private: true,
      addresses: ['192.168.10.12'],
    })
    expect(send).not.toHaveBeenCalled()

    await expect(
      guardedAddonFetch(url, { ...policy, lanAddresses: [] }, { kind: 'json' }),
    ).rejects.toMatchObject({ kind: 'needs_confirmation' })
    dns
      .mockResolvedValueOnce(['192.168.10.12'])
      .mockResolvedValueOnce(['192.168.10.13'])
    await expect(
      guardedAddonFetch(url, policy, { kind: 'json' }),
    ).rejects.toMatchObject({ kind: 'address_changed' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[1]).toEqual(['192.168.10.12'])
  })

  it('coalesces IPv6 address spellings and never falls back from an environment proxy', async () => {
    const url = addonUrl('https://addon.example/manifest.json')
    vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue([
      '2606:4700:4700:0000:0000:0000:0000:1001',
      '2606:4700:4700::1001',
    ])
    await expect(previewAddonAddress(url)).resolves.toEqual({
      private: false,
      addresses: ['2606:4700:4700::1001'],
    })
    vi.spyOn(config, 'envProxy', 'get').mockReturnValue(true)
    await expect(previewAddonAddress(url)).rejects.toMatchObject({
      kind: 'unsupported_route',
    })
    await expect(
      previewAddonAddress(addonUrl('https://8.8.4.4/manifest.json')),
    ).rejects.toMatchObject({ kind: 'unsupported_route' })
  })

  it('strips provider headers on cross-origin redirects and retains Torsher Range', async () => {
    vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
    const destroy = vi.fn(async () => {})
    const send = vi
      .spyOn(addonTransportDeps, 'send')
      .mockResolvedValueOnce({
        response: new Response(null, {
          status: 302,
          headers: {
            location: 'https://cdn.example/file?own=token',
          },
        }),
        destroy,
      })
      .mockResolvedValueOnce({
        response: new Response('first bytes', { status: 206 }),
        destroy,
      })
    const url = addonUrl('https://addon.example/file?key=secret-value')
    const headers = addonRequestHeaders({
      'Authorization': 'Bearer test-authorization',
      'Cookie': 'access=test-cookie',
      'Referer': 'https://addon.example/',
      'User-Agent': 'Test agent',
    })
    headers.set('range', 'bytes=0-10')
    const result = await guardedAddonFetch(
      url,
      { origin: url.origin, lanAddresses: [] },
      {
        kind: 'media',
        headers,
      },
    )
    expect(send.mock.calls[0]?.[2].headers.get('cookie')).toBe(
      'access=test-cookie',
    )
    expect(send.mock.calls[1]?.[0].href).toBe(
      'https://cdn.example/file?own=token',
    )
    expect(Object.fromEntries(send.mock.calls[1]![2].headers)).toEqual({
      'accept-encoding': 'identity',
      'range': 'bytes=0-10',
    })
    await expect(result.response.text()).resolves.toBe('first bytes')
    await result.close()
    expect(destroy).toHaveBeenCalledTimes(2)
  })

  it('clears the header deadline while the media body is active', async () => {
    vi.useFakeTimers()
    try {
      vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
      let stream!: ReadableStreamDefaultController<Uint8Array>
      const send = vi.spyOn(addonTransportDeps, 'send').mockResolvedValue({
        response: new Response(
          new ReadableStream<Uint8Array>({
            start: (controller) => {
              stream = controller
            },
          }),
          { status: 206 },
        ),
        destroy: async () => {},
      })
      const url = addonUrl('https://addon.example/file')
      const result = await guardedAddonFetch(
        url,
        { origin: url.origin, lanAddresses: [] },
        { kind: 'media' },
      )
      await vi.advanceTimersByTimeAsync(9000)
      const signal = send.mock.calls[0]![2].signal
      expect(signal.aborted).toBe(false)
      stream.enqueue(new TextEncoder().encode('media'))
      stream.close()
      expect(await result.response.text()).toBe('media')
      await result.close()
      expect(signal.aborted).toBe(true)
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('rejects metadata redirects and unsafe request headers', async () => {
    vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
    const send = vi.spyOn(addonTransportDeps, 'send').mockResolvedValue({
      response: new Response(null, {
        status: 302,
        headers: { location: 'https://cdn.example/manifest.json' },
      }),
      destroy: async () => {},
    })
    const url = addonUrl('https://addon.example/manifest.json')
    await expect(
      guardedAddonFetch(
        url,
        { origin: url.origin, lanAddresses: [] },
        { kind: 'json' },
      ),
    ).rejects.toMatchObject({ kind: 'blocked_address' })
    expect(send).toHaveBeenCalledTimes(1)
    expect(() => addonRequestHeaders({ Host: 'test.example' })).toThrow(
      'bad_response',
    )
    expect(() => addonRequestHeaders({ Referer: 'file:///synthetic' })).toThrow(
      'invalid_url',
    )
  })
})
