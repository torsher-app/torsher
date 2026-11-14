import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { holdSystemScreensaver } from './webos.ts'

class Bridge {
  static instances: Bridge[] = []
  onservicecallback?: (message: string) => void
  call = vi.fn()
  cancel = vi.fn()
  constructor() {
    Bridge.instances.push(this)
  }

  receive(value: unknown) {
    this.onservicecallback?.(JSON.stringify(value))
  }
}
const report = vi.fn()
beforeEach(() => {
  Bridge.instances = []
  report.mockClear()
  vi.stubGlobal('window', { PalmServiceBridge: Bridge })
})
afterEach(() => vi.unstubAllGlobals())
it('observes absence and throwing constructors without throwing', () => {
  vi.stubGlobal('window', {})
  holdSystemScreensaver(report)()
  expect(report).toHaveBeenCalledWith({ kind: 'luna', status: 'unavailable' })
  vi.stubGlobal('window', {
    PalmServiceBridge: class {
      constructor() {
        throw new Error('denied')
      }
    },
  })
  expect(() => holdSystemScreensaver(report)()).not.toThrow()
})
it('distinguishes sent RPC, confirmed registration, and explicit rejection before timestamps', () => {
  holdSystemScreensaver(report)
  const subscription = Bridge.instances[0]!
  expect(report.mock.calls.map(([event]) => event.status)).toEqual([
    'register-sent',
  ])
  subscription.receive({ returnValue: true })
  subscription.receive({
    returnValue: false,
    timestamp: 100,
    errorCode: -1031,
  })
  expect(Bridge.instances).toHaveLength(1)
  expect(report).toHaveBeenCalledWith({ kind: 'luna', status: 'registered' })
  expect(report).toHaveBeenCalledWith({
    kind: 'luna',
    status: 'register-failed',
    code: -1031,
  })
})
it('accepts timestamp zero without state and responds true to late requests after idempotent release', () => {
  const release = holdSystemScreensaver(report)
  const subscription = Bridge.instances[0]!
  subscription.receive({ timestamp: 0 })
  const responder = Bridge.instances[1]!
  expect(JSON.parse(responder.call.mock.calls[0]![1])).toEqual({
    clientName: 'torsher',
    ack: false,
    timestamp: 0,
  })
  release()
  release()
  expect(subscription.cancel).toHaveBeenCalledTimes(1)
  subscription.receive({ timestamp: 1 })
  expect(JSON.parse(responder.call.mock.calls[1]![1]).ack).toBe(true)
})
it('ignores malformed callbacks and observes response errors including synchronous throws', () => {
  holdSystemScreensaver(report)
  const subscription = Bridge.instances[0]!
  for (const message of ['not json', 'null', '[]'])
    subscription.onservicecallback?.(message)
  subscription.receive({ timestamp: { invalid: 'private string' } })
  expect(Bridge.instances).toHaveLength(1)
  subscription.receive({ timestamp: 10 })
  const responder = Bridge.instances[1]!
  responder.receive({
    returnValue: false,
    errorCode: -5,
    errorText: 'must not be logged',
  })
  expect(report).toHaveBeenCalledWith({
    kind: 'luna',
    status: 'response-failed',
    code: -5,
  })
  responder.call.mockImplementation(() => {
    throw new Error('denied')
  })
  expect(() => subscription.receive({ timestamp: 11 })).not.toThrow()
  expect(report.mock.calls.at(-1)?.[0]).toEqual({
    kind: 'luna',
    status: 'response-failed',
  })
  expect(JSON.stringify(report.mock.calls)).not.toContain('private string')
  expect(JSON.stringify(report.mock.calls)).not.toContain('must not be logged')
})
it('returns a safe release when registration or cancellation throws', () => {
  class ThrowingBridge extends Bridge {
    constructor() {
      super()
      this.call.mockImplementation(() => {
        throw new Error('no service')
      })
      this.cancel.mockImplementation(() => {
        throw new Error('closed')
      })
    }
  }
  vi.stubGlobal('window', { WebOSServiceBridge: ThrowingBridge })
  const release = holdSystemScreensaver(report)
  expect(report).toHaveBeenCalledWith({
    kind: 'luna',
    status: 'register-failed',
  })
  expect(() => release()).not.toThrow()
  expect(() => release()).not.toThrow()
})

it('echoes opaque string timestamps unchanged for both veto and late release responses', () => {
  const release = holdSystemScreensaver(report)
  const subscription = Bridge.instances[0]!
  subscription.receive({ timestamp: '1388518297' })
  const responder = Bridge.instances[1]!
  expect(JSON.parse(responder.call.mock.calls[0]![1])).toEqual({
    clientName: 'torsher',
    ack: false,
    timestamp: '1388518297',
  })
  release()
  subscription.receive({ timestamp: 'opaque timestamp' })
  expect(JSON.parse(responder.call.mock.calls[1]![1])).toEqual({
    clientName: 'torsher',
    ack: true,
    timestamp: 'opaque timestamp',
  })
  expect(JSON.stringify(report.mock.calls)).not.toContain('1388518297')
  expect(JSON.stringify(report.mock.calls)).not.toContain('opaque timestamp')
})
