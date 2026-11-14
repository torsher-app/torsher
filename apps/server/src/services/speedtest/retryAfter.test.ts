import { describe, expect, it } from 'vitest'
import { parseRetryAfter } from './retryAfter.ts'

describe('provider Retry-After', () => {
  const now = Date.parse('2026-11-14T10:00:00.000Z')
  it('converts integer seconds to an absolute timestamp', () => {
    expect(parseRetryAfter(' 120 ', now)).toBe('2026-11-14T10:02:00.000Z')
    expect(parseRetryAfter('0', now)).toBe('2026-11-14T10:00:00.000Z')
  })
  it.each([
    'Sat, 14 Nov 2026 10:02:00 GMT',
    'Saturday, 14-Nov-26 10:02:00 GMT',
    'Sat Nov 14 10:02:00 2026',
  ])('accepts HTTP-date %s', (header) => {
    expect(parseRetryAfter(header, now)).toBe('2026-11-14T10:02:00.000Z')
  })
  it.each([
    null,
    '',
    '-1',
    '1.5',
    'Infinity',
    '1e4',
    '9999999999999999999999999',
    'tomorrow',
    '2026-11-14',
    'Sat, 31 Feb 2026 10:02:00 GMT',
    'Sat, 14 Nov 99999 10:02:00 GMT',
    'Sat, 14 Nov 2026 99:02:00 GMT',
  ])('ignores missing, invalid or extreme value %s', (header) => {
    expect(parseRetryAfter(header, now)).toBeUndefined()
  })
})
