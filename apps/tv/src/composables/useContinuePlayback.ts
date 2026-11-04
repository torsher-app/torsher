import type { Ref } from 'vue'
import type { ResumeLike } from '../lib/continue.ts'
import { onBeforeUnmount, onDeactivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LONG_PRESS_EVENT } from '../focus/longPress.ts'
import { api } from '../api.ts'
import { libraryRoute, resumeRoute } from '../lib/continue.ts'
import { createLatest } from '../lib/latest.ts'
import { libraryChoices } from '../lib/library.ts'
import { useLibraryPicker } from './useLibraryPicker.ts'

/** Общий вход из ряда «Продолжить» и карточки тайтла. */
export function useContinuePlayback(screen: Ref<EventTarget | undefined>) {
  const router = useRouter()
  const lookup = createLatest()
  // OK и мышь посылают click, меню удержания — longpress. Перехватываем их
  // до действия карточки, в том числе до запуска нового «Продолжить».
  watch(
    screen,
    (element, _, onCleanup) => {
      if (!element)
        return

      element.addEventListener('click', lookup.cancel, true)
      element.addEventListener(LONG_PRESS_EVENT, lookup.cancel, true)
      onCleanup(() => {
        element.removeEventListener('click', lookup.cancel, true)
        element.removeEventListener(LONG_PRESS_EVENT, lookup.cancel, true)
      })
    },
    { immediate: true },
  )

  let selectedTitle = ''
  const picker = useLibraryPicker((fileId, target) => {
    void router.push(libraryRoute(fileId, { id: selectedTitle, ...target }))
  })

  function openLibrary(
    titleId: string,
    choice: ReturnType<typeof libraryChoices>,
    currentId?: string | null,
  ) {
    lookup.cancel()
    selectedTitle = titleId
    picker.open({ ...choice, currentId })
  }

  async function resume(
    titleId: string,
    item: ResumeLike & { mediaFileId?: string | null },
  ) {
    if (
      item.file
      && !item.mediaFileId
      && (!item.next || item.followNewEpisode)
    ) {
      lookup.cancel()
      void router.push(resumeRoute(titleId, item))
      return
    }

    const target = { season: item.season, episode: item.episode }
    const query
      = item.season && item.episode
        ? { season: String(item.season), episode: String(item.episode) }
        : undefined
    const result = await lookup.run(signal =>
      api.titles.getTitleLibrary(titleId, query, { signal }),
    )

    if (result.status === 'cancelled')
      return

    if (result.status === 'done') {
      // Старый сервер возвращает весь тайтл, даже если передана серия.
      const choice = libraryChoices(result.value.files, !!item.episode, target)
      if (choice.files.length) {
        openLibrary(titleId, choice, item.mediaFileId)
        return
      }
    }

    const downloaded
      = result.status === 'done' ? result.value.downloadedFile : undefined
    // У библиотечного просмотра file указывает на источник того же файла.
    const previous = item.mediaFileId ? null : item.file
    const file = item.next
      ? (downloaded ?? previous)
      : (previous ?? downloaded ?? null)
    void router.push(resumeRoute(titleId, { ...item, file }))
  }

  onDeactivated(lookup.cancel)
  onBeforeUnmount(lookup.cancel)
  return { picker, openLibrary, resume }
}
