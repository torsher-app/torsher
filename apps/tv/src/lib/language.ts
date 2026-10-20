import type { Language } from '@torsher/i18n'

/** Локаль интерфейса в формате языка TMDB: en_US → en-US. */
export function toTmdbLanguage(locale: Language) {
  return locale.replace('_', '-')
}
