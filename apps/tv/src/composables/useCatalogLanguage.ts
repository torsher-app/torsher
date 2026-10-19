import { computed } from 'vue'
import { i18n } from '../i18n.ts'
import { toTmdbLanguage } from '../lib/language.ts'

/** Язык метаданных каталога следует за языком интерфейса. */
export function useCatalogLanguage() {
  return computed(() => toTmdbLanguage(i18n.global.locale.value))
}
