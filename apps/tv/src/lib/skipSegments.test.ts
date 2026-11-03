import type { Playback } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { currentSkip } from './skipSegments.ts'

const segments: Playback['skipSegments'] = [
  { id: 'intro', kind: 'intro', source: 'audio', start: 20, end: 60 },
]
describe('manual skip eligibility', () => {
  it('supports legacy responses and only exposes the active interval', () => {
    expect(currentSkip(undefined, 30, 100)).toBeUndefined()
    expect(currentSkip(segments, 19, 100)).toBeUndefined()
    expect(currentSkip(segments, 20, 100)?.id).toBe('intro')
    expect(currentSkip(segments, 60, 100)).toBeUndefined()
    expect(currentSkip(segments, 30, 100)?.end).toBe(60)
  })
  it('does not jump backwards after duration clamping or accept invalid times', () => {
    expect(currentSkip(segments, 59.8, 60)).toBeUndefined()
    expect(currentSkip(segments, 30, Number.NaN)).toBeUndefined()
    expect(
      currentSkip([{ ...segments![0], end: Number.NaN }], 30, 100),
    ).toBeUndefined()
  })
})
