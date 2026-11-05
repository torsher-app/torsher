import type { DiagnosticContext } from '../diagnostics/index.ts'
import {
  diagnostic,
  diagnosticAction,
  diagnosticParams,
  diagnosticRoute,
} from '../diagnostics/index.ts'
import { continueSnapshot } from '../diagnostics/continue.ts'
import type { Ref } from 'vue'
import type { ResumeLike } from '../lib/continue.ts'
import { onBeforeUnmount, onDeactivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { LONG_PRESS_EVENT } from '../focus/longPress.ts'
import { api } from '../api.ts'
import {
  automaticPlayback,
  libraryRoute,
  resumeRoute,
} from '../lib/continue.ts'
import { createLatest } from '../lib/latest.ts'
import { libraryChoices } from '../lib/library.ts'
import { useLibraryPicker } from './useLibraryPicker.ts'

/** Общий вход из ряда «Продолжить» и карточки тайтла. */
export function useContinuePlayback(screen: Ref<EventTarget | undefined>) {
  const router = useRouter()
  const lookup = createLatest()
  type CancelReason
    = 'superseded' | 'back' | 'user_interaction' | 'deactivated' | 'unmounted'
  let pending: { cancelCause?: CancelReason } | undefined
  function cancel(reason: CancelReason = 'superseded') {
    if (
      pending
      && (!pending.cancelCause
        || (pending.cancelCause === 'user_interaction' && reason === 'superseded'))
    ) {
      pending.cancelCause = reason
    }
    lookup.cancel()
  }
  function interaction(event: Event) {
    const target = event.target as Element | null
    const back
      = typeof target?.closest === 'function'
        && target.closest('[data-diagnostic-action="back"]')
    cancel(back ? 'back' : 'user_interaction')
  }
  // OK и мышь посылают click, меню удержания — longpress. Перехватываем их
  // до действия карточки, в том числе до запуска нового «Продолжить».
  watch(
    screen,
    (element, _, onCleanup) => {
      if (!element)
        return

      element.addEventListener('click', interaction, true)
      element.addEventListener(LONG_PRESS_EVENT, interaction, true)
      onCleanup(() => {
        element.removeEventListener('click', interaction, true)
        element.removeEventListener(LONG_PRESS_EVENT, interaction, true)
      })
    },
    { immediate: true },
  )

  let selectedContext: DiagnosticContext = {}
  let selectedTitle = ''
  let automatic = false
  const picker = useLibraryPicker((fileId, target, explicit) => {
    void router.push(
      diagnosticRoute(
        libraryRoute(
          fileId,
          { id: selectedTitle, ...target },
          automatic && !explicit ? automaticPlayback : undefined,
        ),
        selectedContext,
      ),
    )
  })

  function openLibrary(
    titleId: string,
    choice: ReturnType<typeof libraryChoices>,
    currentId?: string | null,
    isAutomatic = false,
    context = diagnosticAction(),
  ) {
    cancel()
    selectedContext = context
    diagnostic(
      {
        event: 'continue.route',
        titleId,
        branch: choice.files.length === 1 ? 'library_single' : 'library_picker',
      },
      context,
    )
    selectedTitle = titleId
    automatic = isAutomatic
    picker.open({ ...choice, currentId, titleId }, context)
  }

  async function resume(
    titleId: string,
    item: ResumeLike & { mediaFileId?: string | null },
    intent?: 'follow-ready',
    trigger: 'remote' | 'pointer' = 'remote',
  ) {
    const context = Object.freeze({
      ...diagnosticAction(),
      decisionId: item.decisionId,
    })
    diagnostic(
      {
        event: 'selection.activated',
        slot: 'continue',
        trigger,
        titleId,
      },
      context,
    )
    continueSnapshot('continue.selected', titleId, item, context)
    if (intent) {
      cancel()
      void router.push(
        diagnosticRoute(resumeRoute(titleId, item, intent), context),
      )
      return
    }
    if (
      item.file
      && !item.mediaFileId
      && (!item.next || item.followNewEpisode)
    ) {
      cancel()
      diagnostic(
        { event: 'continue.route', titleId, branch: 'direct_file' },
        context,
      )
      void router.push(diagnosticRoute(resumeRoute(titleId, item), context))
      return
    }

    const target = { season: item.season, episode: item.episode }
    const query
      = item.season && item.episode
        ? { season: String(item.season), episode: String(item.episode) }
        : undefined
    diagnostic(
      { event: 'continue.route', titleId, branch: 'library_lookup' },
      context,
    )
    cancel()
    const operation: { cancelCause?: CancelReason } = {}
    pending = operation
    const result = await lookup.run(signal =>
      api.titles.getTitleLibrary(titleId, query, {
        signal,
        ...diagnosticParams(context),
      }),
    )

    if (pending === operation)
      pending = undefined
    if (result.status === 'cancelled') {
      diagnostic(
        {
          event: 'operation.cancelled',
          reason: operation.cancelCause ?? 'superseded',
        },
        context,
      )
      return
    }
    diagnostic(
      {
        event: 'continue.route',
        titleId,
        branch: 'library_lookup',
        outcome: result.status === 'done' ? 'accepted' : 'failed',
      },
      context,
    )

    if (result.status === 'done') {
      // Старый сервер возвращает весь тайтл, даже если передана серия.
      const choice = libraryChoices(result.value.files, !!item.episode, target)
      if (choice.files.length) {
        openLibrary(
          titleId,
          choice,
          item.mediaFileId,
          item.next && !item.position,
          context,
        )
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
    const route = resumeRoute(titleId, { ...item, file })
    diagnostic(
      {
        event: 'continue.route',
        titleId,
        branch: file
          ? file === downloaded
            ? 'downloaded_file'
            : 'previous_file'
          : route.path.endsWith('/sources')
            ? 'sources'
            : 'resolve',
      },
      context,
    )
    void router.push(diagnosticRoute(route, context))
  }

  onDeactivated(() => cancel('deactivated'))
  onBeforeUnmount(() => cancel('unmounted'))
  return { picker, openLibrary, resume }
}
