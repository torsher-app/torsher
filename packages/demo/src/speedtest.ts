import type {
  InternetSpeedtest,
  LocalMeasurement,
  LocalSpeedtest,
  SpeedtestStartInput,
} from '@torsher/api-client'
import { del, DemoError, get, post } from './router.ts'

const id = '00000000-0000-4000-8000-000000000001'
const measured: LocalMeasurement = {
  bytesPerSecond: 10_000_000,
  latencyMs: 3.4,
  durationMs: 10000,
  payloadBytes: 80_000_000,
  shortened: false,
  startedAt: '2026-01-01T12:00:00.000Z',
  samples: Array.from({ length: 50 }, (_, i) => ({
    seconds: (i + 1) * 0.2,
    bytesPerSecond: i < 3 ? 9_000_000 + i * 300_000 : 10_000_000,
    phase: 'download',
  })),
}
let active = false
function claim() {
  if (active)
    throw new DemoError(409, { message: 'busy' })
  active = true
}
post<LocalSpeedtest, SpeedtestStartInput>('/api/speedtest/local', () => {
  claim()
  return {
    id,
    startedAt: measured.startedAt,
    deadlineMs: 15000,
    durationMs: 10000,
    maxBytes: 68719476736,
    maxRequestBytes: 67108864,
    maxRequests: 4096,
  }
})
get(
  '/api/speedtest/local/:id/latency',
  () =>
    new Response('{}', {
      headers: {
        'X-Torsher-Speedtest-Id': id,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    }),
)
get(
  '/api/speedtest/local/:id/download',
  () =>
    new Response(JSON.stringify(measured), {
      headers: {
        'X-Torsher-Speedtest-Demo': '1',
        'X-Torsher-Speedtest-Id': id,
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json',
      },
    }),
)
del('/api/speedtest/local/:id', () => {
  active = false
  return { message: 'cancelled' }
})
function phase(rate: number) {
  return {
    bytesPerSecond: rate,
    durationMs: 10000,
    payloadBytes: rate * 10,
    confirmedBytes: rate * 10,
    reservedBytes: rate * 10,
    shortened: false,
  }
}
const internet: InternetSpeedtest = {
  id,
  startedAt: measured.startedAt,
  finishedAt: null,
  state: 'running',
  phase: 'download',
  reason: null,
  provider: 'Cloudflare',
  route: 'direct',
  dns: 'system',
  latencyMs: 12.5,
  download: phase(8_000_000),
  upload: phase(4_000_000),
  samples: [
    ...measured.samples.map(p => ({
      ...p,
      bytesPerSecond: p.bytesPerSecond * 0.8,
    })),
    ...measured.samples.map(p => ({
      ...p,
      seconds: p.seconds,
      bytesPerSecond: p.bytesPerSecond * 0.4,
      phase: 'upload' as const,
    })),
  ],
}
post<InternetSpeedtest, SpeedtestStartInput>('/api/speedtest/internet', () => {
  claim()
  return { ...internet }
})
get<InternetSpeedtest>('/api/speedtest/internet/:id', () => {
  active = false
  return {
    ...internet,
    state: 'complete',
    phase: 'finished',
    reason: 'complete',
    finishedAt: '2026-01-01T12:00:17.000Z',
  }
})
post('/api/speedtest/internet/:id/heartbeat', () => ({ message: 'ok' }))
del('/api/speedtest/internet/:id', () => {
  active = false
  return { message: 'cancelled' }
})
