import { describe, expect, it } from 'vitest'
import { diagnosticEvent } from '../../../server/src/dto/diagnostics.ts'
import { events, rules } from './schema.ts'
import { sanitizeEvent } from './sanitize.ts'

function sample(index: number, key = ''): unknown {
  const rule = rules[index]!
  if ('const' in rule)
    return rule.const
  if (rule.enum)
    return rule.enum[0]
  if (rule.anyOf)
    return sample(rule.anyOf[0]!, key)
  if (rule.type === 'object') {
    return Object.fromEntries(
      (rule.required ?? []).map(key => [
        key,
        sample(rule.properties![key]!, key),
      ]),
    )
  }
  if (rule.type === 'array')
    return []
  if (rule.type === 'null')
    return null
  if (rule.type === 'boolean')
    return false
  if (rule.type === 'integer' || rule.type === 'number')
    return rule.minimum ?? 0
  if (key === 'clientTime')
    return '2026-11-05T00:00:00.000Z'
  if (key === 'eventId')
    return 'session-001:1'
  if (key === 'clientSessionId')
    return 'session-001'
  return 'valid-id-001'
}
describe('generated diagnostic schema parity', () => {
  it.each(Object.keys(events))(
    '%s round-trips through the authoritative strict DTO',
    (event) => {
      const input = { ...(sample(events[event]!) as object), event }
      const sanitized = sanitizeEvent(input)
      expect(sanitized).toBeDefined()
      expect(diagnosticEvent.safeParse(sanitized).success).toBe(true)
      for (const key of rules[events[event]!]!.required ?? []) {
        expect(sanitizeEvent({ ...input, [key]: undefined })).toBeUndefined()
      }
    },
  )
})
