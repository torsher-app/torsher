import type { DiagnosticEvent } from '@torsher/api-client'
import { events, rules } from './schema.ts'

/** Only the closed subset emitted by generateDiagnostics; unsupported schema fails at build time. */
export interface Rule {
  type?: string | string[]
  enum?: unknown[]
  const?: unknown
  pattern?: string
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  required?: string[]
  properties?: Record<string, number>
  items?: number
  anyOf?: number[]
}
const invalid = Symbol('invalid diagnostic')
function clean(value: unknown, index: number): unknown {
  const rule = rules[index]!
  if (rule.anyOf) {
    for (const child of rule.anyOf) {
      const result = clean(value, child)
      if (result !== invalid)
        return result
    }
    return invalid
  }
  if ('const' in rule && value !== rule.const)
    return invalid
  if (rule.enum && !rule.enum.includes(value))
    return invalid
  if (rule.type === 'null')
    return value === null ? null : invalid
  if (rule.type === 'boolean')
    return typeof value === 'boolean' ? value : invalid
  if (rule.type === 'string') {
    if (
      typeof value !== 'string'
      || (rule.pattern && !new RegExp(rule.pattern).test(value))
      || (rule.minLength !== undefined && value.length < rule.minLength)
      || (rule.maxLength !== undefined && value.length > rule.maxLength)
    ) {
      return invalid
    }
  }
  if (rule.type === 'integer' || rule.type === 'number') {
    if (
      typeof value !== 'number'
      || !Number.isFinite(value)
      || (rule.type === 'integer' && !Number.isInteger(value))
      || (rule.minimum !== undefined && value < rule.minimum)
      || (rule.maximum !== undefined && value > rule.maximum)
    ) {
      return invalid
    }
  }
  if (rule.type === 'array') {
    if (
      !Array.isArray(value)
      || (rule.minItems !== undefined && value.length < rule.minItems)
      || (rule.maxItems !== undefined && value.length > rule.maxItems)
      || rule.items === undefined
    ) {
      return invalid
    }
    const result = value.map(item => clean(item, rule.items!))
    return result.includes(invalid) ? invalid : result
  }
  if (rule.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return invalid
    const input = value as Record<string, unknown>
    if (rule.required?.some(key => input[key] === undefined))
      return invalid
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(rule.properties ?? {})) {
      if (input[key] === undefined)
        continue
      const field = clean(input[key], child)
      if (field === invalid)
        return invalid
      result[key] = field
    }
    return result
  }
  return value
}

/** Rebuild, validate, then persist: arbitrary caller properties never reach any sink. */
export function sanitizeEvent(input: unknown): DiagnosticEvent | undefined {
  if (!input || typeof input !== 'object')
    return undefined
  const event = (input as { event?: unknown }).event
  if (typeof event !== 'string' || typeof events[event] !== 'number')
    return undefined
  const result = clean(input, events[event]!)
  if (result === invalid)
    return undefined
  const parsed = result as DiagnosticEvent
  if (
    parsed.eventId !== `${parsed.clientSessionId}:${parsed.clientSeq}`
    || JSON.stringify(parsed).length > 4096
  ) {
    return undefined
  }
  return parsed
}
