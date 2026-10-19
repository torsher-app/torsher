import type { Language } from './language.ts'
import enUS from './locales/en_US/ui.json' with { type: 'json' }
import ruRU from './locales/ru_RU/ui.json' with { type: 'json' }

export type { Language } from './language.ts'
export { language, resolveLanguage } from './language.ts'

/** Схему строк задаёт en_US: остальные локали обязаны совпадать с ней по ключам. */
export type Messages = typeof enUS

export const messages: Record<Language, Messages> = {
  en_US: enUS,
  ru_RU: ruRU,
}

export const defaultLocale: Language = 'en_US'
export const fallbackLocale: Language = 'en_US'
