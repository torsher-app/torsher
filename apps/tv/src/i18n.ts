import type { Language, Messages } from '@torsher/i18n'
import { fallbackLocale, messages, pluralRules } from '@torsher/i18n'
import { pseudoLocalize } from '@torsher/i18n/pseudo'
import { createI18n } from 'vue-i18n'
import { localeOf } from './lib/language.ts'

function deviceLanguages() {
  return navigator.languages?.length
    ? navigator.languages
    : [navigator.language]
}

// `?pseudo` в адресе dev-сервера — проверка вёрстки на длинных строках любого
// языка; в сборке условие ложно, и псевдолокаль вырезается
const pseudo
  = import.meta.env.DEV && new URLSearchParams(location.search).has('pseudo')

export const i18n = createI18n<[Messages], Language, false>({
  legacy: false,
  // До выбора профиля — язык устройства
  locale: localeOf(null, deviceLanguages()),
  fallbackLocale,
  messages: pseudo ? pseudoLocalize(messages) : messages,
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
