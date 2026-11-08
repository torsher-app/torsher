import { describe, expect, it } from 'vitest'
import { createStudioSelectIntent } from './studioSelectIntent'

describe('explicit studio selection', () => {
  it('rejects auto-highlight, synthetic click and Enter without a highlighted item', () => {
    const intent = createStudioSelectIntent()
    expect(intent.enter('first', false)).toBeUndefined()
    expect(intent.select('First')).toBe(false)
    intent.navigate()
    expect(intent.enter(undefined, false)).toBeUndefined()
    expect(intent.select('First')).toBe(false)
  })
  it('confirms the navigated row immediately without waiting for Reka synthetic click', async () => {
    const intent = createStudioSelectIntent()
    intent.navigate()
    expect(intent.enter('Second', false)).toBe('Second')
    await Promise.resolve()
    expect(intent.select('Second')).toBe(false)
    expect(intent.enter('Second', false)).toBeUndefined()
  })
  it('allows a pointer action only on its row', () => {
    const intent = createStudioSelectIntent()
    intent.pointer('Second')
    expect(intent.select('First')).toBe(false)
    intent.pointer('Second')
    expect(intent.select('Second')).toBe(true)
  })
  it('clears activation on changed query/results, blur, Escape or clearing input', () => {
    const intent = createStudioSelectIntent()
    intent.navigate()
    intent.reset()
    expect(intent.enter('first', false)).toBeUndefined()
    intent.pointer('First')
    intent.reset()
    expect(intent.select('First')).toBe(false)
  })
  it('does not select on IME Enter or reuse pre-composition navigation', () => {
    const intent = createStudioSelectIntent()
    intent.navigate()
    expect(intent.enter('first', true)).toBeUndefined()
    intent.composition(true)
    intent.navigate()
    intent.pointer('First')
    expect(intent.select('First')).toBe(false)
    intent.composition(false)
    expect(intent.enter('first', false)).toBeUndefined()
  })
})
