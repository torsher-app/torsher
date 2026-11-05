import { createRequire } from 'node:module'
import { writeFileSync } from 'node:fs'
import { diagnosticEvent } from '../../server/src/dto/diagnostics.ts'

const require = createRequire(
  new URL('../../server/package.json', import.meta.url),
)
const { z } = require('zod')

const schema = z.toJSONSchema(diagnosticEvent)
const rules = []
const byRule = new Map()
const supported = new Set([
  '$schema',
  '$defs',
  '$ref',
  'id',
  'type',
  'enum',
  'const',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'required',
  'properties',
  'items',
  'anyOf',
  'oneOf',
  'additionalProperties',
])
function compile(source) {
  if (source.$ref) {
    const key = source.$ref.replace('#/$defs/', '')
    if (!schema.$defs?.[key])
      throw new Error('Unresolved diagnostic schema reference')
    return compile(schema.$defs[key])
  }
  for (const key of Object.keys(source)) {
    if (!supported.has(key))
      throw new Error(`Unsupported diagnostic schema keyword: ${key}`)
  }
  if (
    source.additionalProperties !== undefined
    && source.additionalProperties !== false
  ) {
    throw new Error('Diagnostic objects must be closed')
  }
  if (source.format && source.format !== 'date-time')
    throw new Error('Unsupported diagnostic format')
  if (
    source.type
    && ![
      'object',
      'array',
      'string',
      'number',
      'integer',
      'null',
      'boolean',
    ].includes(source.type)
  ) {
    throw new Error('Unsupported diagnostic type')
  }
  const rule = {}
  for (const key of [
    'type',
    'enum',
    'const',
    'pattern',
    'minimum',
    'maximum',
    'minLength',
    'maxLength',
    'minItems',
    'maxItems',
    'required',
  ]) {
    if (source[key] !== undefined)
      rule[key] = source[key]
  }
  if (source.properties) {
    rule.properties = Object.fromEntries(
      Object.entries(source.properties).map(([key, value]) => [
        key,
        compile(value),
      ]),
    )
  }
  if (source.items)
    rule.items = compile(source.items)
  if (source.anyOf || source.oneOf)
    rule.anyOf = (source.anyOf || source.oneOf).map(compile)
  const key = JSON.stringify(rule)
  if (byRule.has(key))
    return byRule.get(key)
  const index = rules.length
  rules.push(rule)
  byRule.set(key, index)
  return index
}
const events = {}
const root = schema.$ref
  ? schema.$defs[schema.$ref.replace('#/$defs/', '')]
  : schema
for (const variant of root.oneOf || root.anyOf) {
  const index = compile(variant)
  for (const event of variant.properties.event.enum || [
    variant.properties.event.const,
  ])
    events[event] = index
}
const rootRequire = createRequire(
  new URL('../../../package.json', import.meta.url),
)
const { format } = rootRequire('prettier')
void format(
  `// Generated from the server diagnostic DTO by pnpm generate:api. Do not edit.
import type { Rule } from './sanitize.ts'

export const rules: Rule[] = ${JSON.stringify(rules, null, 2)}
export const events: Record<string, number> = ${JSON.stringify(events, null, 2)}
`,
  {
    parser: 'typescript',
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    printWidth: 80,
  },
).then(text =>
  writeFileSync(new URL('../src/diagnostics/schema.ts', import.meta.url), text),
)
