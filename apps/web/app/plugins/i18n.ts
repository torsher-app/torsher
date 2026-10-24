import type { Language, Messages } from '@torsher/i18n'
import { fallbackLocale, messages, pluralRules } from '@torsher/i18n'
import { pseudoLocalize } from '@torsher/i18n/pseudo'
import { createI18n } from 'vue-i18n'
import { languageOf, readPreference } from '~/lib/panelLanguage'

export default defineNuxtPlugin((nuxtApp) => {
  // `?pseudo` в адресе dev-сервера — проверка вёрстки на длинных строках;
  // читается один раз при старте, переходы внутри панели его не теряют
  const pseudo
    = import.meta.dev && new URLSearchParams(location.search).has('pseudo')

  const i18n = createI18n<[Messages], Language, false>({
    legacy: false,
    locale: languageOf(readPreference()),
    fallbackLocale,
    messages: pseudo ? pseudoLocalize(messages) : messages,
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
