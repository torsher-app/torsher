import type { Language, Messages } from '@torsher/i18n'
import { fallbackLocale, messages, pluralRules } from '@torsher/i18n'
import { createI18n } from 'vue-i18n'
import { languageOf, readPreference } from '~/lib/panelLanguage'

export default defineNuxtPlugin((nuxtApp) => {
  const i18n = createI18n<[Messages], Language, false>({
    legacy: false,
    locale: languageOf(readPreference()),
    fallbackLocale,
    messages,
    pluralRules,
  })

  nuxtApp.vueApp.use(i18n)

  // Скринридер и переносы слов читают язык страницы из <html lang>
  watch(
    i18n.global.locale,
    (locale) => {
      document.documentElement.lang = locale.split('_')[0]!
    },
    { immediate: true },
  )
})
