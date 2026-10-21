import { describe, expect, it, vi } from 'vitest'
import {
  checkServer,
  displayAddress,
  healthUrl,
  normalizeAddress,
  showcaseUrl,
} from './server.ts'

describe('normalizeAddress', () => {
  it.each([
    ['192.168.1.10:8080', 'http://192.168.1.10:8080'],
    ['  192.168.1.10:8080/  ', 'http://192.168.1.10:8080'],
    ['http://torsher.local', 'http://torsher.local'],
    ['HTTPS://media.example/torsher//', 'https://media.example/torsher'],
    ['http://192.168.1.10:8080/?x=1#/home', 'http://192.168.1.10:8080'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeAddress(input)).toBe(expected)
  })

  it.each(['', '   ', 'ftp://192.168.1.10', 'http://', '192.168.1.10:99999'])(
    'отклоняет %j',
    (input) => {
      expect(normalizeAddress(input)).toBeNull()
    },
  )
})

describe('адреса сервера', () => {
  it('прячет http:// в подписи, https:// оставляет', () => {
    expect(displayAddress('http://192.168.1.10:8080')).toBe(
      '192.168.1.10:8080',
    )
    expect(displayAddress('https://media.example')).toBe(
      'https://media.example',
    )
  })

  it('строит адреса health и витрины от базового', () => {
    expect(healthUrl('http://192.168.1.10:8080')).toBe(
      'http://192.168.1.10:8080/api/health',
    )
    expect(showcaseUrl('https://media.example/torsher', 0)).toBe(
      'https://media.example/torsher/?platform=tv&shell=0',
    )
  })
})

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status }))
}

describe('checkServer', () => {
  const base = 'http://192.168.1.10:8080'

  it('ok на 200 и { status: "ok" }', async () => {
    const fetchImpl = respond(200, { status: 'ok' })

    expect(await checkServer(base, fetchImpl)).toBe('ok')
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://192.168.1.10:8080/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('notTorsher на чужой ответ', async () => {
    expect(await checkServer(base, respond(404, {}))).toBe('notTorsher')
    expect(await checkServer(base, respond(200, { ok: true }))).toBe(
      'notTorsher',
    )
    expect(
      await checkServer(
        base,
        vi.fn(async () => new Response('<html>', { status: 200 })),
      ),
    ).toBe('notTorsher')
  })

  it('unreachable, если запрос упал', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch')
    })

    expect(await checkServer(base, fetchImpl)).toBe('unreachable')
  })

  it('timeout, если сервер молчит дольше срока', async () => {
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')))
        }),
    )

    expect(await checkServer(base, fetchImpl, 10)).toBe('timeout')
  })
})
