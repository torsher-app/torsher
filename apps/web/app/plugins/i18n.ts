import type { Language, Messages } from '@torsher/i18n'
import {
  defaultLocale,
  fallbackLocale,
  language,
  messages,
  pluralRules,
} from '@torsher/i18n'
import { createI18n } from 'vue-i18n'

// Язык браузера по основному тегу: ru-KZ и ru-RU оба дают ru_RU
function browserLanguage(): Language {
  const primary = navigator.language.split('-')[0]
  const languages = Object.keys(language) as Language[]

  return (
    languages.find(item => item.startsWith(`${primary}_`)) ?? defaultLocale
  )
}

export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.vueApp.use(
    createI18n<[Messages], Language, false>({
      legacy: false,
      locale: browserLanguage(),
      fallbackLocale,
      messages,
      pluralRules,
    }),
  )
})
