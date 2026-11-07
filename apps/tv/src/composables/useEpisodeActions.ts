import type { Episode, TitleProgress } from '@torsher/api-client'
import type { Ref } from 'vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api.ts'
import { useFocus } from '../focus/index.ts'
import {
  libraryRoute,
  playerRoute,
  resolveRoute,
  withStartPosition,
} from '../lib/continue.ts'
import { episodeActions, markedEpisode } from '../lib/episodeActions.ts'
import { createLatest } from '../lib/latest.ts'
import { libraryChoices } from '../lib/library.ts'
import { isUpcoming } from '../lib/titleInfo.ts'
import { useLibraryPicker } from './useLibraryPicker.ts'

interface EpisodeContext {
  titleId: string
  season: number
  episode: Episode
  opener?: HTMLElement
}

/** Контекст панели общий для ряда карточек и полного списка. */
export function useEpisodeActions(
  id: Ref<string>,
  season: Ref<number | undefined>,
  progress: Ref<TitleProgress | undefined>,
  ready: () => boolean,
  refreshProgress: () => void,
) {
  const { t } = useI18n()
  const router = useRouter()
  const focus = useFocus()
  const context = shallowRef<EpisodeContext>()
  const busy = ref(false)
  const error = ref('')
  const focusOption = ref('play')
  const lookup = createLatest()
  const saving = new Set<string>()
  let fromStart = false
  let live = true

  function pointOf(value: EpisodeContext) {
    return progress.value?.episodes.find(
      item =>
        item.season === value.season && item.episode === value.episode.number,
    )
  }

  const options = computed(() => {
    if (!ready()) {
      return [
        {
          id: 'play',
          label: t('title.episodeActionsLoading'),
          selected: false,
          disabled: true,
        },
      ]
    }
    const state = episodeActions(context.value && pointOf(context.value))
    return [
      {
        id: 'play',
        label: t(state.resume ? 'title.resume' : 'title.watch'),
        selected: false,
      },
      ...(state.fromStart
        ? [{ id: 'start', label: t('player.fromStart'), selected: false }]
        : []),
      {
        id: 'mark',
        label: t(
          state.watched ? 'actions.unmarkWatched' : 'actions.markWatched',
        ),
        selected: false,
      },
    ].map(item => ({ ...item, disabled: busy.value || !ready() }))
  })

  function navigate(route: ReturnType<typeof resolveRoute>) {
    lookup.cancel()
    busy.value = false
    // Панель сохраняет контекст при Back из resolver или плеера.
    void router.push(withStartPosition(route, fromStart))
  }

  const picker = useLibraryPicker((fileId, target) => {
    if (context.value)
      navigate(libraryRoute(fileId, { id: context.value.titleId, ...target }))
  })

  function open(episode: Episode) {
    if (season.value === undefined || isUpcoming(episode.airDate))
      return
    lookup.cancel()
    busy.value = false
    error.value = ''
    focusOption.value = 'play'
    context.value = {
      titleId: id.value,
      season: season.value,
      episode,
      opener: focus.current() ?? undefined,
    }
  }

  function close() {
    const opener = context.value?.opener
    lookup.cancel()
    busy.value = false
    context.value = undefined
    nextTick(() => {
      if (opener?.isConnected)
        focus.focusOn(opener)
    })
  }

  async function toggle(value: EpisodeContext, closeAfter: boolean) {
    const key = `${value.titleId}:${value.season}:${value.episode.number}`
    if (!ready() || saving.has(key) || isUpcoming(value.episode.airDate))
      return
    saving.add(key)
    const previous = pointOf(value) ?? {
      season: value.season,
      episode: value.episode.number,
      position: 0,
      duration: null,
      watched: false,
    }
    const watched = !previous.watched
    try {
      await api.titles.putTitleWatched(value.titleId, {
        season: value.season,
        episode: value.episode.number,
        watched,
      })
      if (!live || id.value !== value.titleId)
        return
      const current = progress.value ?? {
        resume: null,
        last: null,
        seasonReleases: [],
        episodes: [],
      }
      progress.value = {
        ...current,
        episodes: [
          ...current.episodes.filter(
            item =>
              item.season !== value.season
              || item.episode !== value.episode.number,
          ),
          markedEpisode(previous, watched),
        ],
      }
      refreshProgress()
      if (closeAfter && context.value === value)
        close()
    }
    catch {
      if (live && id.value === value.titleId)
        error.value = t('actions.errors.save')
    }
    finally {
      saving.delete(key)
    }
  }

  function hold(episode: Episode) {
    if (season.value !== undefined)
      void toggle({ titleId: id.value, season: season.value, episode }, false)
  }

  async function select(action: string) {
    const value = context.value
    if (!value || busy.value || !ready())
      return
    focusOption.value = action
    error.value = ''
    busy.value = true
    if (action === 'mark') {
      await toggle(value, true)
      if (context.value === value)
        busy.value = false
      return
    }
    fromStart = action === 'start'
    const target = { season: value.season, episode: value.episode.number }
    const result = await lookup.run(signal =>
      api.titles.getTitleLibrary(
        value.titleId,
        { season: String(target.season), episode: String(target.episode) },
        { signal },
      ),
    )
    if (result.status === 'cancelled' || context.value !== value)
      return
    busy.value = false
    if (result.status === 'done') {
      const choice = libraryChoices(result.value.files, true, target)
      if (choice.files.length) {
        picker.open(choice)
        return
      }
      if (result.value.downloadedFile) {
        navigate(
          playerRoute(result.value.downloadedFile, {
            id: value.titleId,
            ...target,
          }),
        )
        return
      }
    }
    const release = progress.value?.seasonReleases.find(
      item =>
        item.season === target.season && item.episodes.includes(target.episode),
    )
    // Без прежнего выбора зритель сам выбирает источник, как на карточке тайтла.
    navigate(
      release
        ? resolveRoute(
            value.titleId,
            target.season,
            target.episode,
            release.torrentId,
          )
        : {
            path: `/title/${value.titleId}/sources`,
            query: {
              season: String(target.season),
              episode: String(target.episode),
            },
          },
    )
  }

  function cancel() {
    lookup.cancel()
    busy.value = false
  }
  onDeactivated(cancel)
  onBeforeUnmount(() => {
    live = false
    cancel()
  })
  return {
    context,
    options,
    busy,
    error,
    focusOption,
    picker,
    open,
    close,
    hold,
    select,
  }
}
