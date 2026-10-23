<script setup lang="ts">
import type { ResolveStep } from '../composables/resolveEpisode.ts'
import type { KeyAction } from '../focus/index.ts'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api.ts'
import PlayerBuffering from '../components/player/PlayerBuffering.vue'
import PlayerLamp from '../components/player/PlayerLamp.vue'
import PlayerPrompt from '../components/player/PlayerPrompt.vue'
import PlayerStage from '../components/player/PlayerStage.vue'
import { resolveEpisode } from '../composables/resolveEpisode.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { usePlayerArt } from '../composables/usePlayerArt.ts'
import { useFocus } from '../focus/index.ts'
import { playerRoute } from '../lib/continue.ts'
import { lastVoiceKey } from '../lib/episodes.ts'
import { goBack } from '../lib/navigation.ts'

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
  // Раздача, где серию ищем первой: та, которой смотрели прошлую
  torrent?: string
  candidate?: string
}>()

const { t } = useI18n()
const router = useRouter()
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
let cancelled = false
let offKey: (() => void) | undefined

const label = computed(() => t(`resolve.${step.value}`))
// Выбранная раздача не открылась — другое объяснение, чем «серии нигде нет»
const failure = computed(() => (props.candidate ? 'failed' : 'notFound'))

function back() {
  cancelled = true
  goBack(router, () => void router.replace('/'))
}

function onKey(action: KeyAction) {
  if (action.type !== 'back')
    return false

  back()

  return true
}

function onChoice(choice: 'sources' | 'back') {
  if (choice === 'back') {
    back()
    return
  }

  cancelled = true
  void router.replace(`/title/${props.id}/sources`)
}

async function run() {
  // Раздача сезона и озвучка прошлых серий — из прогресса; без него ищем по
  // порядку сервера
  const progress = await api.titles
    .getTitleProgress(props.id, { language: language.value })
    .catch(() => undefined)
  const releases = progress?.seasonReleases ?? []
  const season = target.season ?? 0
  const outcome = await resolveEpisode(target, {
    candidateId: props.candidate,
    torrents: [
      props.torrent,
      releases.find(item => item.season === season)?.torrentId,
    ],
    voiceKey: lastVoiceKey(releases, season),
    cancelled: () => cancelled,
    onStep: (next) => {
      step.value = next
    },
  })

  if (outcome.kind === 'found') {
    void router.replace(
      playerRoute(outcome.file, {
        id: props.id,
        season: target.season,
        episode: target.episode,
      }),
    )
  }
  else if (outcome.kind === 'notFound') {
    notFound.value = true
  }
}

onMounted(() => {
  offKey = focus.onKey(onKey)
  void run()
})

onBeforeUnmount(() => {
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
        :actions="[
          { id: 'sources', label: t('resolve.toSources') },
          { id: 'back', label: t('player.back') },
        ]"
        @choose="onChoice"
      />
      <PlayerLamp v-else step="connecting" :connected="0" />

      <template v-if="!notFound" #bottom>
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
