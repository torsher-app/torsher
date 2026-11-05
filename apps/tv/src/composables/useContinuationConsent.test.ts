import { describe, expect, it, vi } from 'vitest'
import { useContinuationConsent } from './useContinuationConsent.ts'

describe('prepared playback consent', () => {
  it('does not begin or save until accepted and consumes repeated OK once', async () => {
    const begin = vi.fn()
    const gate = useContinuationConsent(run => run === 1)
    const pending = gate.confirm('SD', 1).then((accepted) => {
      if (accepted)
        begin()
    })
    await Promise.resolve()
    expect(begin).not.toHaveBeenCalled()
    expect(gate.pending.value?.quality).toBe('SD')
    gate.accept()
    gate.accept()
    await pending
    expect(begin).toHaveBeenCalledTimes(1)
    expect(gate.pending.value).toBeNull()
  })
  it('back cancels the prepared launch and late acceptance has no effect', async () => {
    const gate = useContinuationConsent(() => true)
    const pending = gate.confirm('720p', 1)
    gate.cancel()
    gate.accept()
    expect(await pending).toBe(false)
  })
  it('stale responses and consent from a previous source cannot authorize another launch', async () => {
    let current = 1
    const gate = useContinuationConsent(run => run === current)
    const previous = gate.confirm('SD', 1)
    current = 2
    gate.accept()
    expect(await previous).toBe(false)
    expect(await gate.confirm('SD', 1)).toBe(false)
    expect(gate.pending.value).toBeNull()
    const next = gate.confirm('720p', 2)
    expect(gate.pending.value?.quality).toBe('720p')
    gate.cancel()
    expect(await next).toBe(false)
  })
  it('unknown or equal quality proceeds without a dialog', async () => {
    const gate = useContinuationConsent(() => true)
    expect(await gate.confirm(null, 1)).toBe(true)
    expect(gate.pending.value).toBeNull()
  })
})
