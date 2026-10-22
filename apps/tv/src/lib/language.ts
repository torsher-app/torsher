import type { Language } from '@torsher/i18n'
import { defaultLocale, language } from '@torsher/i18n'

/**
 * Язык устройства: первый, для которого есть локаль, по основному тегу
 * (ru-KZ и ru-RU — оба ru_RU), иначе en_US.
 */
export function deviceLocale(languages: readonly string[]): Language {
  const locales = Object.keys(language) as Language[]

  for (const tag of languages) {
    const primary = tag.toLowerCase().split('-')[0]
    const found = locales.find(locale => locale.startsWith(`${primary}_`))
    if (found)
      return found
  }

  return defaultLocale
}

/** Язык витрины: из профиля, у профиля без языка — язык устройства. */
export function localeOf(
  profileLanguage: string | null | undefined,
  languages: readonly string[],
): Language {
  return profileLanguage && profileLanguage in language
    ? (profileLanguage as Language)
    : deviceLocale(languages)
}

/** Локаль интерфейса в формате языка TMDB: en_US → en-US. */
export function toTmdbLanguage(locale: Language) {
  return locale.replace('_', '-')
}
