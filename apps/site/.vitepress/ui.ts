import messages from '@torsher/i18n/locales/en_US/ui.json' with { type: 'json' }

/**
 * Interface string by its `@torsher/i18n` key. An unknown key throws: the dev
 * server shows it on the page, and `scripts/check.ts` fails on it in CI.
 */
export function label(key: string): string {
  let value: unknown = messages

  for (const part of key.split('.')) {
    value
      = value && typeof value === 'object'
        ? (value as Record<string, unknown>)[part]
        : undefined
  }

  if (typeof value !== 'string')
    throw new Error(`Unknown interface string "${key}" in @torsher/i18n`)

  // Plural strings list their forms with "|": a label needs only the first one
  return value.split(' | ')[0]!
}
