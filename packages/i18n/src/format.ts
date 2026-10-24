import type { Language } from './language.ts'
import type { Messages } from './index.ts'
import { pluralRules } from './plural.ts'

export type MessageParams = Record<string, string | number | undefined>

/** Правило vue-i18n по умолчанию: `ноль | один | много` или `один | много` */
function defaultRule(choice: number, choicesLength: number) {
  const value = Math.abs(choice)

  if (choicesLength === 2)
    return value === 1 ? 0 : 1

  return value ? Math.min(value, 2) : 0
}

function lookup(messages: Messages, key: string): string | undefined {
  let node: unknown = messages

  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object')
      return undefined

    node = (node as Record<string, unknown>)[part]
  }

  return typeof node === 'string' ? node : undefined
}

/**
 * Строка по ключу вне Vue — для сообщений, которые собирает сервер. Формы
 * через ` | ` и подстановки `{name}` — как у vue-i18n в клиентах, `{n}` —
 * число из `count`. Нет ключа в языке — английская строка, нет и её — ключ.
 */
export function translate(
  catalog: Record<Language, Messages>,
  language: Language,
  key: string,
  params: MessageParams = {},
  count?: number,
) {
  let message
    = lookup(catalog[language], key) ?? lookup(catalog.en_US, key) ?? key

  if (count !== undefined) {
    const forms = message.split(' | ')
    const rule = pluralRules[language] ?? defaultRule

    message = forms[rule(count, forms.length)] ?? forms.at(-1)!
  }

  const values: MessageParams
    = count === undefined ? params : { n: count, ...params }

  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values[name]

    return value === undefined ? match : String(value)
  })
}
