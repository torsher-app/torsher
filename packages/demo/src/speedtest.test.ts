import type { LocalSpeedtest } from '@torsher/api-client'
import { readLocalSpeedtest } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { handle, match } from './router.ts'
import './speedtest.ts'

const url = (path: string) => new URL(path, 'http://demo')
describe('fictional speedtest demo transport', () => {
  it('covers raw streams separately and returns tiny fixtures without external traffic', async () => {
    const started = await handle(
      url('/api/speedtest/local'),
      { method: 'POST', body: '{}' },
      'unavailable',
    )
    const session = (await started.json()) as LocalSpeedtest
    expect(
      match('GET', `/api/speedtest/local/${session.id}/latency`),
    ).toBeDefined()
    expect(
      match('GET', `/api/speedtest/local/${session.id}/download`),
    ).toBeDefined()
    let calls = 0
    const fixture = await readLocalSpeedtest(
      session,
      new AbortController().signal,
      () => {},
      {
        demo: true,
        fetch: async (path, init) => {
          const target = url(String(path))
          expect(target.origin).toBe('http://demo')
          const response = await handle(target, init ?? {}, 'unavailable')
          const text = await response.clone().text()
          expect(text.length).toBeLessThan(10_000)
          calls++
          return response
        },
      },
    )
    expect(calls).toBe(7)
    expect(fixture.bytesPerSecond).toBe(10_000_000)
    await handle(
      url(`/api/speedtest/local/${session.id}`),
      { method: 'DELETE' },
      'unavailable',
    )
    const internet = await handle(
      url('/api/speedtest/internet'),
      { method: 'POST', body: '{}' },
      'unavailable',
    )
    expect((await internet.json()).provider).toBe('Cloudflare')
    const final = await handle(
      url(`/api/speedtest/internet/${session.id}`),
      {},
      'unavailable',
    )
    expect((await final.json()).state).toBe('complete')
  })
})
