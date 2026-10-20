import type { Language, Messages } from '@torsher/i18n'
import {
  defaultLocale,
  fallbackLocale,
  messages,
  pluralRules,
} from '@torsher/i18n'
import { createI18n } from 'vue-i18n'

export const i18n = createI18n<[Messages], Language, false>({
  legacy: false,
  locale: defaultLocale,
  fallbackLocale,
  messages,
  pluralRules,
})
