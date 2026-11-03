import type { LibraryFile } from '@torsher/api-client'
import type { LibraryEpisode } from '../lib/library.ts'
import { nextTick, onDeactivated, shallowRef } from 'vue'
import { useFocus } from '../focus/index.ts'

interface Selection {
  files: LibraryFile[]
  target: LibraryEpisode
  currentId?: string | null
}

/** Один файл играет сразу; несколько ждут явного выбора с пульта или мышью. */
export function useLibraryPicker(
  play: (fileId: string, target: LibraryEpisode) => void,
) {
  const focus = useFocus()
  const selection = shallowRef<Selection>()
  let opener: HTMLElement | undefined

  function open(value: Selection) {
    if (value.files.length === 1) {
      play(value.files[0]!.id, value.target)
    }
    else if (value.files.length > 1 && !selection.value) {
      opener = focus.current() ?? undefined
      selection.value = value
    }
  }

  function close() {
    selection.value = undefined
    nextTick(() => {
      if (opener?.isConnected)
        focus.focusOn(opener)
    })
  }

  function select(id: string) {
    const value = selection.value

    if (!value?.files.some(file => file.id === id))
      return

    selection.value = undefined
    play(id, value.target)
  }

  onDeactivated(() => {
    selection.value = undefined
  })

  return { selection, open, close, select }
}
