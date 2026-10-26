import type { NetHost } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { hostStatusView } from './netStatus'

function host(values: Partial<NetHost>): NetHost {
  return {
    id: 'https://api.example',
    host: 'api.example',
    hostname: 'api.example',
    kind: 'tmdb',
    label: 'API',
    route: {
      id: 'default',
      match: '*',
      via: 'direct',
      dns: 'system',
      envProxy: false,
    },
    checking: false,
    status: 'timeout',
    httpStatus: null,
    latencyMs: null,
    dnsSpoofed: true,
    checkedAt: null,
    ...values,
  }
}

describe('hostStatusView', () => {
  it('подмена DNS при системном DNS — причина, DoH поможет', () => {
    expect(hostStatusView(host({})).spoofed).toBe(true)
  })

  it('с DoH хост всё равно не отвечает — дело не в DNS', () => {
    const view = hostStatusView(
      host({ route: { ...host({}).route, dns: 'quad9' } }),
    )

    expect(view).toMatchObject({ state: 'timeout', spoofed: false })
  })

  it('отвечает только через маршрут — предупреждение о подмене', () => {
    const view = hostStatusView(
      host({ status: 'ok', route: { ...host({}).route, dns: 'quad9' } }),
    )

    expect(view).toMatchObject({ state: 'ok', spoofed: true, tone: 'warning' })
  })
})
