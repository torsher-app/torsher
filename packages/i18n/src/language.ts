export const language = {
  en_US: 'English',
  ru_RU: 'Русский',
} as const

export type Language = keyof typeof language

export function resolveLanguage(value: unknown): Language {
  return typeof value === 'string' && Object.hasOwn(language, value)
    ? (value as Language)
    : 'en_US'
}
