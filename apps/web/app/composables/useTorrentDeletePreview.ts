import type { TorrentDeletePreview } from '@torsher/api-client'
import type { TorrentErrorKind } from './useTorrents'
import { ref, shallowRef, watch } from 'vue'
import { torrentErrorKind } from './useTorrents'
import { api } from '~/services/api'

/** Оценка привязана к одному открытию диалога, ответы закрытого не переиспользуются. */
export function useTorrentDeletePreview(
  id: () => string | undefined,
  open: () => boolean,
) {
  const preview = shallowRef<TorrentDeletePreview | null>(null)
  const error = ref<TorrentErrorKind | null>(null)

  watch(
    [id, open],
    async ([torrentId, isOpen], _previous, onCleanup) => {
      let current = true
      onCleanup(() => {
        current = false
      })
      preview.value = null
      error.value = null
      if (!isOpen || !torrentId)
        return
      try {
        const result = await withErrorMode('silent', () =>
          api.torrents.getTorrentDeletePreview(torrentId))
        if (current)
          preview.value = result
      }
      catch (cause) {
        const kind = await torrentErrorKind(cause)
        if (current)
          error.value = kind
      }
    },
    { immediate: true },
  )

  return { preview, error }
}
