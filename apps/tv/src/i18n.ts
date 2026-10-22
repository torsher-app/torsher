import type { Language, Messages } from '@torsher/i18n'
import { fallbackLocale, messages, pluralRules } from '@torsher/i18n'
import { createI18n } from 'vue-i18n'
import { localeOf } from './lib/language.ts'

function deviceLanguages() {
  return navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
}

export const i18n = createI18n<[Messages], Language, false>({
  legacy: false,
  // До выбора профиля — язык устройства
  locale: localeOf(null, deviceLanguages()),
  fallbackLocale,
  messages,
  pluralRules,
})

/**
 * Язык интерфейса и метаданных: из профиля, без него — язык устройства.
 * Загрузки держат язык в ключе и сами перезапрашивают данные.
 */
export function applyLanguage(profileLanguage: string | null | undefined) {
  const locale = localeOf(profileLanguage, deviceLanguages())

  i18n.global.locale.value = locale
  document.documentElement.lang = locale.slice(0, 2)
}

applyLanguage(null)
