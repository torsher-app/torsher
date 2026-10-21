import { shell as enUS } from '@torsher/i18n/locales/en_US/ui.json'
import { shell as ruRU } from '@torsher/i18n/locales/ru_RU/ui.json'

export type ShellMessages = typeof enUS

// Обёртке нужен только раздел `shell`: именованный импорт JSON оставляет
// в бандле его одного, без строк витрины и панели
const messages: Record<string, ShellMessages> = { en: enUS, ru: ruRU }

export function resolveMessages(languages: readonly string[]): ShellMessages {
  for (const tag of languages) {
    const found = messages[tag.toLowerCase().split('-')[0]!]
    if (found)
      return found
  }

  return enUS
}

export function format(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in values ? values[name]! : match)
}
