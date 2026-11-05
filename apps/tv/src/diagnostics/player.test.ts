import { describe, expect, it } from 'vitest'
import { upNextGate } from './player.ts'

const visible = {
  hasTarget: true,
  available: true,
  displayed: true,
  dismissed: false,
  playing: true,
  restarting: false,
  error: false,
  panel: false,
  credits: false,
  ended: false,
  duration: 1200,
}
describe('observed up next gate', () => {
  it('distinguishes never requested/no target from an unavailable target', () => {
    expect(
      upNextGate({
        ...visible,
        hasTarget: false,
        available: false,
        displayed: false,
      }),
    ).toBe('no_target')
    expect(upNextGate({ ...visible, available: false, displayed: false })).toBe(
      'no_sources_or_library',
    )
  })
  it('reports actual visibility before the countdown and credits separately', () => {
    expect(upNextGate(visible)).toBe('remaining')
    expect(upNextGate({ ...visible, credits: true })).toBe('credits')
    expect(upNextGate({ ...visible, ended: true })).toBe('ended')
    expect(upNextGate({ ...visible, displayed: false })).toBe(
      'before_threshold',
    )
  })
  it.each(['panel', 'restarting', 'error', 'dismissed'] as const)(
    'reports %s hiding an available next',
    (gate) => {
      expect(upNextGate({ ...visible, displayed: false, [gate]: true })).toBe(
        gate,
      )
    },
  )
})
