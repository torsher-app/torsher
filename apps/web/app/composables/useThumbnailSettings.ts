import type { ThumbnailSettings } from '@torsher/api-client'
import { api } from '~/services/api'

export function useThumbnailSettings() {
  const settings = shallowRef<ThumbnailSettings | null>(null)
  const failed = ref(false)
  const busy = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  function apply(value: ThumbnailSettings) {
    settings.value = value
    clearTimeout(timer)
    if (value.running && !disposed)
      timer = setTimeout(load, 1500)
  }
  async function load() {
    try {
      apply(
        await withErrorMode('silent', () =>
          api.settings.getThumbnailSettings()),
      )
      failed.value = false
    }
    catch {
      failed.value = true
      if (settings.value?.running && !disposed)
        timer = setTimeout(load, 3000)
    }
  }
  async function toggle(automatic: boolean) {
    busy.value = true
    try {
      apply(await api.settings.putThumbnailSettings({ automatic }))
    }
    catch {
      /* API wrapper shows the error; retain the saved value. */
    }
    finally {
      busy.value = false
    }
  }
  async function regenerate() {
    busy.value = true
    try {
      apply(await api.settings.postThumbnailRegenerate())
    }
    catch {
      /* API wrapper shows the error. */
    }
    finally {
      busy.value = false
    }
  }
  onMounted(load)
  onBeforeUnmount(() => {
    disposed = true
    clearTimeout(timer)
  })
  return { settings, failed, busy, load, toggle, regenerate }
}
