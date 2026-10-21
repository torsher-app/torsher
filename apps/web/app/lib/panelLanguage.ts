import type { Language } from '@torsher/i18n'
import { defaultLocale, language } from '@torsher/i18n'

/** Выбор в меню аккаунта: язык или «как в браузере» */
export type LanguagePreference = Language | 'browser'

const STORAGE_KEY = 'torsher.panel.language'

const languages = Object.keys(language) as Language[]

function isLanguage(value: unknown): value is Language {
  return languages.includes(value as Language)
}

// Язык браузера по основному тегу: ru-KZ и ru-RU оба дают ru_RU
function browserLanguage(): Language {
  const primary = navigator.language.split('-')[0]

  return (
    languages.find(item => item.startsWith(`${primary}_`)) ?? defaultLocale
  )
}

// Хранилище может быть недоступно (приватный режим, запрет cookie сайта):
// тогда язык — как в браузере и выбор живёт до перезагрузки
export function readPreference(): LanguagePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)

    return isLanguage(stored) ? stored : 'browser'
  }
  catch {
    return 'browser'
  }
}

export function savePreference(value: LanguagePreference) {
  try {
    if (value === 'browser')
      localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, value)
  }
  catch {}
}

export function languageOf(preference: LanguagePreference): Language {
  return preference === 'browser' ? browserLanguage() : preference
}
