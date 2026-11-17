import { describe, expect, it } from 'vitest'
import { toLoadError } from './loadError.ts'

describe('toLoadError', () => {
  it('requires an explicit catalog configuration failure', () => {
    expect(toLoadError(503, 'config')).toBe('notConfigured')
    expect(toLoadError(503, 'unknown')).toBe('unavailable')
    expect(toLoadError(502, 'config')).toBe('unavailable')
    expect(toLoadError(404, 'config')).toBe('notFound')
  })

  it.each([
    [401, 'unauthorized'],
    [404, 'notFound'],
    [502, 'unavailable'],
    [503, 'unavailable'],
    [500, 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%s → %s', (status, kind) => {
    expect(toLoadError(status)).toBe(kind)
  })
})
