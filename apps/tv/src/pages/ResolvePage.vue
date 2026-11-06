<script setup lang="ts">
import { sourceReturnRoute } from '../lib/sourceReturn.ts'
import type { AutomaticPlayback } from '../lib/continue.ts'
import type { ResolveStep } from '../composables/resolveEpisode.ts'
import type { KeyAction } from '../focus/index.ts'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import {
  currentDiagnosticContext,
  diagnostic,
  diagnosticParams,
} from '../diagnostics/index.ts'
import { api } from '../api.ts'
import PlayerBuffering from '../components/player/PlayerBuffering.vue'
import PlayerLamp from '../components/player/PlayerLamp.vue'
import PlayerPrompt from '../components/player/PlayerPrompt.vue'
import PlayerStage from '../components/player/PlayerStage.vue'
import { resolveEpisode } from '../composables/resolveEpisode.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { usePlayerArt } from '../composables/usePlayerArt.ts'
import { useFocus } from '../focus/index.ts'
import { playerRoute, withStartPosition } from '../lib/continue.ts'
import { lastVoiceKey } from '../lib/episodes.ts'
import { LOADER_DELAY_MS } from '../lib/loader.ts'
import { goBack, sourcesAfterResolve } from '../lib/navigation.ts'

/**
 * Экран подготовки: серия, файла которой ещё нет, — следующая после
 * досмотренной или выбранная в плеере. Ищет её в известных раздачах, потом в
 * лучших раздачах с той же озвучкой и встаёт на своё место плеером. С
 * `candidate` — раздача, выбранная в «Источнике» плеера: только она.
 */
const props = defineProps<{
  id: string
  // У фильма сезона и серии нет
  season?: string
  episode?: string
  start?: string
  // Раздача, где серию ищем первой: та, которой смотрели прошлую
  torrent?: string
  candidate?: string
  query?: string
  intent?: string
  // Озвучка, которую слушали в прошлой раздаче: плеер возьмёт её дорожку
  voice?: string
  automatic?: AutomaticPlayback
}>()

const { t } = useI18n()
const router = useRouter()
const diagnosticContext = currentDiagnosticContext()
const focus = useFocus()
const language = useCatalogLanguage()
const target = {
  titleId: props.id,
  season: props.season ? Number(props.season) : undefined,
  episode: props.episode ? Number(props.episode) : undefined,
}
const { art, subtitle } = usePlayerArt(props.id, target.season, target.episode)

const step = ref<ResolveStep>('searching')
const notFound = ref(false)
// Серии не нашлось, а искать было негде: источников на сервере нет
const noSources = ref(false)
const failureReason = ref<'unsuitable' | 'searchFailed'>()
const followFailure = ref<
  'followUnavailable' | 'followOpenFailed' | 'followUnsupported'
>()
let running = false
let cancelled = false
let operation: 'pending' | 'completed' | 'cancelled' = 'pending'
function cancelOperation(reason: 'back' | 'unmounted' | 'superseded') {
  if (operation !== 'pending')
    return
  operation = 'cancelled'
  diagnostic({ event: 'operation.cancelled', reason }, diagnosticContext, true)
}
const mountedAt = performance.now()
let offKey: (() => void) | undefined

const label = computed(() => t(`resolve.${step.value}`))
// Выбранная раздача не открылась — другое объяснение, чем «серии нигде нет»;
// без источников — серии просто нет в библиотеке, и «Источников» тоже нет
const failure = computed(
  () =>
    followFailure.value
    ?? (props.candidate
      ? 'failed'
      : noSources.value
        ? 'notInLibrary'
        : (failureReason.value ?? 'notFound')),
)
const actions = computed(() => [
  ...(failureReason.value === 'searchFailed'
    || followFailure.value === 'followOpenFailed'
    || followFailure.value === 'followUnsupported'
    ? [{ id: 'retry' as const, label: t('resolve.retry') }]
    : []),
  ...(noSources.value
    ? []
    : [{ id: 'sources' as const, label: t('resolve.toSources') }]),
  { id: 'back' as const, label: t('player.back') },
])

function back() {
  cancelOperation('back')
  cancelled = true
  const previous = props.candidate
    ? sourceReturnRoute(router.options.history.state.sourceReturn, props.id)
    : undefined
  if (previous) {
    void router.replace(previous)
    return
  }
  goBack(router, () => void router.replace('/'))
}

function onKey(action: KeyAction) {
  if (action.type !== 'back')
    return false

  back()

  return true
}

function onChoice(choice: 'sources' | 'back' | 'retry') {
  if (choice === 'retry') {
    void run()
    return
  }
  if (choice === 'back') {
    back()
    return
  }

  cancelOperation('superseded')
  cancelled = true
  const action = sourcesAfterResolve(
    props.id,
    router.options.history.state.back,
  )
  if (action.kind === 'history') {
    router.back()
    return
  }
  void router.replace({
    path: `/title/${props.id}/sources`,
    query: { season: props.season, episode: props.episode, start: props.start },
  })
}

async function run() {
  if (running || cancelled)
    return
  running = true
  operation = 'pending'
  notFound.value = false
  failureReason.value = undefined
  followFailure.value = undefined
  try {
    // Раздача сезона и озвучка прошлых серий — из прогресса; без него ищем по
    // порядку сервера
    const progress = await api.titles
      .getTitleProgress(
        props.id,
        {
          language: language.value,
          season: props.season,
          episode: props.episode,
        },
        diagnosticParams(diagnosticContext),
      )
      .catch(() => undefined)
    const releases = progress?.seasonReleases ?? []
    const season = target.season ?? 0
    const outcome = await resolveEpisode(target, {
      diagnosticContext,
      candidateId: props.candidate,
      query: props.query,
      intent: props.intent === 'follow-ready' ? 'follow-ready' : undefined,
      torrents: [
        props.torrent,
        props.automatic && progress?.continuation !== undefined
          ? progress.continuation.preferredTorrent?.torrentId
          : releases.find(
            item =>
              item.season === season
              && (!target.episode || item.episodes.includes(target.episode)),
          )?.torrentId,
      ],
      voiceKey: props.voice
        ? `studio:${props.voice}`
        : lastVoiceKey(releases, season),
      cancelled: () => cancelled,
      onStep: (next) => {
        step.value = next
      },
    })

    if (cancelled || outcome.kind === 'cancelled')
      return
    if (operation === 'pending')
      operation = 'completed'
    if (outcome.kind === 'found') {
      // Торшер уже на экране — плеер не прячет его на вторую задержку
      void router.replace({
        ...withStartPosition(
          playerRoute(
            outcome.file,
            {
              id: props.id,
              season: target.season,
              episode: target.episode,
            },
            props.voice,
            props.candidate ? undefined : props.automatic,
          ),
          props.start === '0',
        ),
        state: {
          sourceReturn: null,
          resumePlayback: null,
          diagnostic: { ...diagnosticContext },
          loaderShown: performance.now() - mountedAt >= LOADER_DELAY_MS,
        },
      })
    }
    else if (
      outcome.kind === 'followUnavailable'
      || outcome.kind === 'followOpenFailed'
      || outcome.kind === 'followUnsupported'
    ) {
      followFailure.value = outcome.kind
      notFound.value = true
      if (outcome.kind === 'followUnavailable') {
        await api.titles
          .getTitleFollow(props.id, { language: language.value })
          .catch(() => undefined)
      }
    }
    else if (outcome.kind === 'notFound') {
      noSources.value = !!outcome.noSources
      failureReason.value = outcome.failureKind
      notFound.value = true
    }
  }
  finally {
    running = false
  }
}

onMounted(() => {
  offKey = focus.onKey(onKey)
  void run()
})

onBeforeUnmount(() => {
  cancelOperation('unmounted')
  cancelled = true
  offKey?.()
})
</script>

<template>
  <main class="resolve">
    <PlayerStage
      :title="art?.title ?? ''"
      :backdrop="art?.backdrop"
      :logo="art?.logo"
      :subtitle="subtitle"
    >
      <PlayerPrompt
        v-if="notFound"
        :title="t(`resolve.${failure}.title`)"
        :text="t(`resolve.${failure}.text`)"
        :actions="actions"
        @choose="onChoice"
      />
      <template v-else>
        <PlayerLamp step="connecting" :connected="0" />
        <PlayerBuffering step="connecting" :stats="undefined" :label="label" />
      </template>
    </PlayerStage>
  </main>
</template>

<style scoped>
.resolve {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: #000000;
}
</style>
