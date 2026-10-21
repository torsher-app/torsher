import type { LanguagePreference } from '~/lib/panelLanguage'
import { useI18n } from 'vue-i18n'
import {
  languageOf,
  readPreference,
  savePreference,
} from '~/lib/panelLanguage'

const preference = ref<LanguagePreference>(readPreference())

/**
 * Язык панели — настройка браузера, а не аккаунта: панелью пользуется
 * один владелец, а на сервере языку делать нечего. Строки, даты и числа
 * переключаются сразу: форматтеры берут тот же `locale`.
 */
export function usePanelLanguage() {
  const { locale } = useI18n()

  const language = computed({
    get: () => preference.value,
    set: (value: LanguagePreference) => {
      preference.value = value
      savePreference(value)
      locale.value = languageOf(value)
    },
  })

  return { language }
}
