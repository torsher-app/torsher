<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import FocusSection from '../FocusSection.vue'
import PanelRow from './PanelRow.vue'
import PlayerPanel from './PlayerPanel.vue'

export interface TrackOption {
  id: string
  label: string
  /** Вторая строка: тип озвучки, кодек, каналы, битрейт */
  detail?: string
  selected: boolean
}

defineProps<{
  kind: 'audio' | 'subtitles'
  options: TrackOption[]
  /** Под заголовком: какой файл играет */
  caption?: string
  /** Внизу: смена дорожки перезапустит поток */
  hint?: string
}>()

const emit = defineEmits<{ select: [id: string] }>()

const { t } = useI18n()
</script>

<template>
  <PlayerPanel :title="t(`player.${kind}`)" :caption="caption" :hint="hint">
    <FocusSection name="player-tracks" autofocus manual-scroll>
      <PanelRow
        v-for="option in options"
        :key="option.id"
        :label="option.label"
        :detail="option.detail"
        check
        :selected="option.selected"
        @select="emit('select', option.id)"
      />
    </FocusSection>
  </PlayerPanel>
</template>
