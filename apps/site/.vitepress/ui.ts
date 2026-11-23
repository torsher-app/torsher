import messages from '@torsher/i18n/locales/en_US/ui.json' with { type: 'json' }

function raw(key: string): string {
  let value: unknown = messages

  for (const part of key.split('.')) {
    value
      = value && typeof value === 'object'
        ? (value as Record<string, unknown>)[part]
        : undefined
  }

  if (typeof value !== 'string')
    throw new Error(`Unknown interface string "${key}" in @torsher/i18n`)

  return value
}

/**
 * Interface string by its `@torsher/i18n` key. An unknown key throws: the dev
 * server shows it on the page, and `scripts/check.ts` fails on it in CI.
 */
export function label(key: string): string {
  // Plural strings list their forms with "|": a label needs only the first one
  return raw(key).split(' | ')[0]!
}

/** The same string with `{placeholder}` values filled in, for mockups on the landing page */
export function format(
  key: string,
  params: Record<string, string | number>,
): string {
  const forms = raw(key).split(' | ')
  const template
    = forms.length > 1 && typeof params.n === 'number'
      ? params.n === 1
        ? forms[0]!
        : (forms[1] ?? forms[0]!)
      : forms[0]!

  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match)
}
