import type { Torrent } from '@torsher/api-client'
import { ref, watch } from 'vue'
import { videoIndexes } from '~/lib/torrents'

/** Черновик файлов карточки: polling обновляет только нетронутый выбор. */
export function useDownloadSelection(
  source: () => Torrent | null,
  preselect: () => boolean | undefined,
) {
  const selection = ref(new Set<number>())
  const draftPriorities = ref(
    new Map<number, Torrent['files'][number]['priority']>(),
  )

  function selectedIndexes(torrent: Torrent) {
    return torrent.files
      .filter(file => file.selected)
      .map(file => file.index)
  }

  watch(
    source,
    (torrent, previous) => {
      if (!torrent)
        return

      // При открытии и появлении metadata сохраняем подсказку выбора видео.
      if (
        torrent.id !== previous?.id
        || (preselect()
          && previous?.files.length === 0
          && torrent.files.length > 0)
      ) {
        draftPriorities.value = new Map()
        const chosen = selectedIndexes(torrent)
        selection.value = new Set(
          chosen.length === 0 && preselect() ? videoIndexes(torrent) : chosen,
        )
        return
      }

      // Сравниваем с предыдущим серверным снимком: новый уже может содержать
      // выбор Keep. Отложенный priority тоже делает черновик изменённым.
      const before = selectedIndexes(previous)
      if (
        draftPriorities.value.size === 0
        && before.length === selection.value.size
        && before.every(index => selection.value.has(index))
      ) {
        selection.value = new Set(selectedIndexes(torrent))
      }
    },
    { immediate: true },
  )

  return { selection, draftPriorities }
}
