import { describe, expect, it } from 'vitest'
import { toLoadError } from './loadError.ts'

describe('toLoadError', () => {
  it.each([
    [401, 'unauthorized'],
    [404, 'notFound'],
    [502, 'unavailable'],
    [503, 'notConfigured'],
    [500, 'unknown'],
    [undefined, 'unknown'],
  ] as const)('%s → %s', (status, kind) => {
    expect(toLoadError(status)).toBe(kind)
  })
})
