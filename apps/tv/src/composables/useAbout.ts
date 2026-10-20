import type { AboutResponse } from '@torsher/api-client'
import { ref, shallowRef } from 'vue'
import { api } from '../api.ts'

export type AboutStatus = 'loading' | 'ready' | 'error'

/** Сведения о сервере. Атрибуция на экране от них не зависит и видна всегда. */
export function useAbout() {
  const status = ref<AboutStatus>('loading')
  const about = shallowRef<AboutResponse>()

  api.about.getAbout().then(
    (value) => {
      about.value = value
      status.value = 'ready'
    },
    () => {
      status.value = 'error'
    },
  )

  return { status, about }
}
