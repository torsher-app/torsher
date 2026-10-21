import type { Language, Messages } from '@torsher/i18n'
import { fallbackLocale, messages, pluralRules } from '@torsher/i18n'
import { createI18n } from 'vue-i18n'
import { deviceLocale } from './lib/language.ts'

export const i18n = createI18n<[Messages], Language, false>({
  legacy: false,
  // До профилей — язык устройства; потом его заменит язык профиля
  locale: deviceLocale(
    navigator.languages?.length ? navigator.languages : [navigator.language],
  ),
  fallbackLocale,
  messages,
  pluralRules,
})
