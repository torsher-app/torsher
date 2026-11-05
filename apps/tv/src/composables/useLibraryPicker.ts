import type { DiagnosticContext } from '../diagnostics/index.ts'
import { diagnostic, diagnosticAction } from '../diagnostics/index.ts'
import type { LibraryFile } from '@torsher/api-client'
import type { LibraryEpisode } from '../lib/library.ts'
import { nextTick, onDeactivated, shallowRef } from 'vue'
import { useFocus } from '../focus/index.ts'

interface Selection {
  titleId?: string
  files: LibraryFile[]
  target: LibraryEpisode
  currentId?: string | null
}

/** Один файл играет сразу; несколько ждут явного выбора с пульта или мышью. */
export function useLibraryPicker(
  play: (fileId: string, target: LibraryEpisode, explicit: boolean) => void,
) {
  const focus = useFocus()
  const selection = shallowRef<Selection>()
  let context: DiagnosticContext = {}
  let opener: HTMLElement | undefined

  function open(value: Selection, captured = diagnosticAction()) {
    context = captured
    if (value.files.length === 1) {
      diagnostic(
        {
          event: 'library.choice',
          titleId: value.titleId,
          season: value.target.season ?? undefined,
          episode: value.target.episode ?? undefined,
          outcome: 'auto_single',
          versions: 1,
          mediaFileId: value.files[0]!.id,
        },
        context,
      )
      play(value.files[0]!.id, value.target, false)
    }
    else if (value.files.length > 1 && !selection.value) {
      opener = focus.current() ?? undefined
      selection.value = value
    }
  }

  function close() {
    if (selection.value) {
      diagnostic(
        {
          event: 'library.choice',
          outcome: 'cancelled',
          titleId: selection.value.titleId,
          season: selection.value.target.season ?? undefined,
          episode: selection.value.target.episode ?? undefined,
          versions: selection.value.files.length,
        },
        context,
        true,
      )
    }
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

    diagnostic(
      {
        event: 'library.choice',
        titleId: value.titleId,
        season: value.target.season ?? undefined,
        episode: value.target.episode ?? undefined,
        outcome: 'selected',
        versions: value.files.length,
        mediaFileId: id,
      },
      context,
      true,
    )
    selection.value = undefined
    play(id, value.target, true)
  }

  onDeactivated(() => {
    if (selection.value) {
      diagnostic(
        {
          event: 'library.choice',
          outcome: 'deactivated',
          titleId: selection.value.titleId,
          season: selection.value.target.season ?? undefined,
          episode: selection.value.target.episode ?? undefined,
          versions: selection.value.files.length,
        },
        context,
      )
    }
    selection.value = undefined
  })

  return { selection, open, close, select }
}
