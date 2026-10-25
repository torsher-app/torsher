import type { Language } from './language.ts'
import enUS from './locales/en_US/ui.json' with { type: 'json' }
import ruRU from './locales/ru_RU/ui.json' with { type: 'json' }

export { attentionMessage } from './attention.ts'
export type { AttentionMessage, AttentionMessageInput } from './attention.ts'
export {
  followNotificationKinds,
  followNotificationText,
  formatFollowUntil,
  isFollowNotification,
} from './follow.ts'
export type {
  FollowNotificationKind,
  FollowNotificationParams,
  FollowReleaseFacts,
} from './follow.ts'
export { translate } from './format.ts'
export type { MessageParams } from './format.ts'
export type { Language } from './language.ts'
export { language, resolveLanguage } from './language.ts'
export { pluralRules } from './plural.ts'
export type { PluralRule } from './plural.ts'

/** Схему строк задаёт en_US: остальные локали обязаны совпадать с ней по ключам. */
export type Messages = typeof enUS

export const messages: Record<Language, Messages> = {
  en_US: enUS,
  ru_RU: ruRU,
}

export const defaultLocale: Language = 'en_US'
export const fallbackLocale: Language = 'en_US'
