import { expect, it } from 'vitest'
import { networkCounters, trafficRates } from './monitor.ts'

const ns = 'net:[4026533001]'
function snapshot(rx: number, tx: number, name = 'eth0') {
  return `lo: 9000000 0 0 0 0 0 0 0 9000000 0 0 0 0 0 0 0\n${name}: ${rx} 0 0 0 0 0 0 0 ${tx} 0 0 0 0 0 0 0`
}
it('measures non-loopback bytes per second and preserves idle zeros', () => {
  const first = networkCounters(snapshot(100, 500), ns)
  const last = networkCounters(snapshot(10100, 50500), ns)
  expect(trafficRates(first, last, 5000)).toEqual({
    receiveBps: 2000,
    sendBps: 10000,
  })
  expect(trafficRates(last, last, 5000)).toEqual({ receiveBps: 0, sendBps: 0 })
})
it('leaves gaps on counter resets, interface replacement, missing samples and host networking', () => {
  const a = networkCounters(snapshot(5000, 1000), ns)
  for (const b of [
    networkCounters(snapshot(1, 2000), ns),
    networkCounters(snapshot(6000, 2000, 'eth1'), ns),
    null,
  ])
    expect(trafficRates(a, b, 5000).receiveBps).toBeNull()
  expect(trafficRates(a, a, 30_000).sendBps).toBeNull()
  expect(networkCounters(snapshot(5, 5), 'net:[4026531833]')).toBeNull()
})
