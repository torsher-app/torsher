import type { PersonDetails } from '@torsher/api-client'
import type { Ref } from 'vue'
import { computed } from 'vue'
import { api } from '../api.ts'
import { useCatalogLanguage } from './useCatalogLanguage.ts'
import { useResource } from './useResource.ts'

/** Персона и фильмография по ролям на языке каталога. */
export function useCatalogPerson(id: Ref<string>) {
  const language = useCatalogLanguage()
  const key = computed(() => `${id.value}:${language.value}`)
  const { data, ...rest } = useResource<PersonDetails>(key, (_, signal) =>
    api.catalog.getCatalogPerson(
      id.value,
      { language: language.value },
      { signal },
    ))

  return { person: data, ...rest }
}
