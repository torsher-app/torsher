<script setup lang="ts">
import type { Playback } from '@torsher/api-client'
import { computed, nextTick, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocus } from '../../focus/index.ts'
import FocusSection from '../FocusSection.vue'
import PanelRow from './PanelRow.vue'
import PlayerPanel from './PlayerPanel.vue'
import PlayerSubtitleSearch from './PlayerSubtitleSearch.vue'

export interface TrackOption {
  id: string
  label: string
  /** Вторая строка: тип озвучки, кодек, каналы, битрейт */
  detail?: string
  selected: boolean
}

const props = defineProps<{
  kind: 'audio' | 'subtitles'
  options: TrackOption[]
  /** Под заголовком: какой файл играет */
  caption?: string
  offsetMs?: number
  savingOffset?: boolean
  sessionId?: string
  search?: Playback['subtitleSearch']
  removable?: boolean
  subtitleBusy?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  offset: [change: number | 'reset']
  apply: [id: string]
  remove: []
  close: []
  searchClosed: []
}>()

const { t, locale } = useI18n()
const focus = useFocus()
const timing = ref(false)
const searching = ref(false)
const searchPanel = ref<InstanceType<typeof PlayerSubtitleSearch>>()
const actions = [
  { change: -500, key: 'earlier' },
  { change: 500, key: 'later' },
  { change: -100, key: 'earlierFine' },
  { change: 100, key: 'laterFine' },
  { change: 'reset', key: 'reset' },
] as const
const offsetLabel = computed(() => {
  const offset = props.offsetMs ?? 0
  const seconds = (offset / 1000).toLocaleString(
    locale.value.replace('_', '-'),
    {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    },
  )
  return t('player.subtitleTiming.value', {
    seconds: offset > 0 ? `+${seconds}` : seconds,
  })
})

async function openTiming() {
  timing.value = true
  await nextTick()
  focus.activate('player-tracks')
}

function back() {
  if (searching.value) {
    if (!searchPanel.value?.back()) {
      searching.value = false
      emit('searchClosed')
      void nextTick(() => restoreFocus('[data-subtitle-search]'))
    }
    return true
  }
  if (!timing.value)
    return false
  timing.value = false
  void nextTick(() => restoreFocus('[data-subtitle-timing]'))
  return true
}

function restoreFocus(selector: string) {
  const row = document.querySelector<HTMLElement>(selector)
  if (row)
    focus.focusOn(row)
}

defineExpose({ back })
</script>

<template>
  <PlayerSubtitleSearch
    v-if="searching && search && sessionId"
    :key="sessionId"
    ref="searchPanel"
    :session-id="sessionId"
    :search="search"
    :applying="!!subtitleBusy"
    @apply="emit('apply', $event)"
    @close="emit('close')"
  />
  <PlayerPanel
    v-else
    :title="timing ? t('player.subtitleTiming.title') : t(`player.${kind}`)"
    :caption="timing ? offsetLabel : caption"
    @close="emit('close')"
  >
    <FocusSection
      :key="timing ? 'timing' : kind"
      name="player-tracks"
      autofocus
      manual-scroll
    >
      <template v-if="timing">
        <PanelRow
          v-for="action in actions"
          :key="action.key"
          :label="t(`player.subtitleTiming.${action.key}`)"
          :aria-disabled="savingOffset || undefined"
          @select="emit('offset', action.change)"
        />
      </template>
      <template v-else>
        <PanelRow
          v-if="kind === 'subtitles' && search?.providers.length"
          data-subtitle-search
          :label="t('player.subtitleSearch.title')"
          @select="searching = true"
        />
        <PanelRow
          v-for="option in options"
          :key="option.id"
          :label="option.label"
          :detail="option.detail"
          check
          :selected="option.selected"
          @select="emit('select', option.id)"
        />
        <PanelRow
          v-if="kind === 'subtitles' && offsetMs !== undefined"
          data-subtitle-timing
          :label="t('player.subtitleTiming.title')"
          :detail="offsetLabel"
          @select="openTiming"
        />
        <PanelRow
          v-if="kind === 'subtitles' && removable"
          :label="t('player.subtitleSearch.remove')"
          :aria-disabled="subtitleBusy || undefined"
          @select="emit('remove')"
        />
      </template>
    </FocusSection>
  </PlayerPanel>
</template>
