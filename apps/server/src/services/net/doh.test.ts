import type { DohSend } from './doh.ts'
import { Buffer } from 'node:buffer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDohResolver,
  decodeAnswer,
  DohError,
  encodeQuery,
} from './doh.ts'
import { dnsAnswer, queryFromUrl, queryType } from './fixtures/dnsMessage.ts'

function answering(
  records: Record<number, { address: string, ttl?: number }[]>,
  rcode = 0,
) {
  return vi.fn<DohSend>(async (url) => {
    const query = queryFromUrl(url)
    const body = dnsAnswer(query, records[queryType(query)] ?? [], rcode)

    return new Response(new Uint8Array(body), {
      headers: { 'content-type': 'application/dns-message' },
    })
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('dns message', () => {
  it('encodes a question and decodes answers with name compression', () => {
    const query = encodeQuery('api.example.org', 1)

    expect(query.readUInt16BE(0)).toBe(0)
    expect(query.readUInt16BE(4)).toBe(1)

    const decoded = decodeAnswer(
      dnsAnswer(query, [
        { address: '203.0.113.7', ttl: 120 },
        { address: '203.0.113.8', ttl: 60 },
      ]),
    )

    expect(decoded.rcode).toBe(0)
    expect(decoded.ttl).toBe(60)
    expect(decoded.addresses).toEqual([
      { address: '203.0.113.7', family: 4 },
      { address: '203.0.113.8', family: 4 },
    ])
  })

  it('decodes AAAA records', () => {
    const query = encodeQuery('example.org', 28)
    const decoded = decodeAnswer(
      dnsAnswer(query, [{ address: '2001:db8:0:0:0:0:0:1' }]),
    )

    expect(decoded.addresses).toEqual([
      { address: '2001:db8:0:0:0:0:0:1', family: 6 },
    ])
  })

  it('throws on a truncated message', () => {
    const message = dnsAnswer(encodeQuery('example.org', 1), [
      { address: '203.0.113.7' },
    ])

    expect(() =>
      decodeAnswer(Buffer.from(message.subarray(0, message.length - 2))),
    ).toThrow()
  })
})

describe('createDohResolver', () => {
  it('asks the provider in wire format and returns A and AAAA', async () => {
    const send = answering({
      1: [{ address: '203.0.113.7' }],
      28: [{ address: '2001:db8:0:0:0:0:0:7' }],
    })
    const resolver = createDohResolver('https://doh.example/dns-query', send)

    expect(await resolver.resolve('api.example.org')).toEqual([
      { address: '203.0.113.7', family: 4 },
      { address: '2001:db8:0:0:0:0:0:7', family: 6 },
    ])

    const [url, init] = send.mock.calls[0]!

    expect(url.startsWith('https://doh.example/dns-query?dns=')).toBe(true)
    expect(init.headers.accept).toBe('application/dns-message')
  })

  it('caches answers for their ttl', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })

    const send = answering({ 1: [{ address: '203.0.113.7', ttl: 60 }] })
    const resolver = createDohResolver('https://doh.example/dns-query', send)

    await resolver.resolve('example.org')
    await resolver.resolve('example.org')
    expect(send).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(61_000)
    await resolver.resolve('example.org')
    expect(send).toHaveBeenCalledTimes(4)
  })

  it('reports an unknown name as not found', async () => {
    const resolver = createDohResolver(
      'https://doh.example/dns-query',
      answering({}, 3),
    )

    await expect(resolver.resolve('missing.example')).rejects.toMatchObject({
      kind: 'not_found',
      code: 'ENOTFOUND',
    })
  })

  it('reports a failing provider as unavailable', async () => {
    const send = vi.fn<DohSend>(
      async () => new Response('busy', { status: 503 }),
    )
    const resolver = createDohResolver('https://doh.example/dns-query', send)

    const error = await resolver.resolve('example.org').catch(err => err)

    expect(error).toBeInstanceOf(DohError)
    expect(error).toMatchObject({
      kind: 'unavailable',
      code: 'EDOHUNAVAILABLE',
    })
  })

  it('serves net.connect lookups with one or all addresses', async () => {
    const resolver = createDohResolver(
      'https://doh.example/dns-query',
      answering({
        1: [{ address: '203.0.113.7' }],
        28: [{ address: '2001:db8:0:0:0:0:0:7' }],
      }),
    )

    const one = await new Promise(resolve =>
      resolver.lookup('example.org', { family: 4 }, (err, address, family) =>
        resolve({ err, address, family })),
    )

    expect(one).toEqual({ err: null, address: '203.0.113.7', family: 4 })

    const all = await new Promise(resolve =>
      resolver.lookup('example.org', { all: true }, (err, addresses) =>
        resolve(err ?? addresses)),
    )

    expect(all).toHaveLength(2)
  })
})
