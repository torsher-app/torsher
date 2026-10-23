<script setup lang="ts">
import type { SourceCandidate } from '@torsher/api-client'
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.ts'
import { useHeldLoading } from '../../composables/useHeldLoading.ts'
import { useSourceLabels } from '../../composables/useSourceLabels.ts'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../../focus/index.ts'
import { coversEpisode } from '../../lib/episodes.ts'
import { coverageLabel, resolutionBadge } from '../../lib/sources.ts'
import AppLoader from '../AppLoader.vue'
import FocusSection from '../FocusSection.vue'
import PanelRow from './PanelRow.vue'
import PlayerPanel from './PlayerPanel.vue'

/**
 * Лист «Источник»: раздачи тайтла, где есть эта серия. Позиция привязана к
 * серии, поэтому другая раздача продолжит с того же места.
 */
const props = defineProps<{
  titleId: string
  season?: number
  episode?: number
}>()

const emit = defineEmits<{ select: [candidate: SourceCandidate] }>()

const { t } = useI18n()
const focus = useFocus()
const { voiceLabel, candidateSize, seedersLabel } = useSourceLabels()
const candidates = shallowRef<SourceCandidate[]>([])
const loading = ref(true)
const showsLoader = useHeldLoading(() => loading.value)

// Раздача, которой смотрят, — первой
const list = computed(() => {
  const { season, episode } = props
  const covering = candidates.value.filter(
    item =>
      season === undefined
      || episode === undefined
      || coversEpisode(item, season, episode),
  )

  return [
    ...covering.filter(item => item.lastWatched),
    ...covering.filter(item => !item.lastWatched),
  ]
})

function detailOf(candidate: SourceCandidate) {
  return [
    coverageLabel(candidate),
    candidateSize(candidate),
    seedersLabel(candidate.seeders),
  ]
    .filter(Boolean)
    .join(' · ')
}

function labelOf(candidate: SourceCandidate) {
  return [
    candidate.resolution && resolutionBadge(candidate.resolution),
    voiceLabel(candidate.voice),
  ]
    .filter(Boolean)
    .join(' · ')
}

onMounted(async () => {
  try {
    candidates.value = (
      await api.titles.getTitleSources(props.titleId, { all: '1' })
    ).candidates
  }
  catch {
    candidates.value = []
  }

  loading.value = false
})

// Список встал на место лоадера — фокус в него
watch(showsLoader, async (shown) => {
  if (shown)
    return

  await nextTick()
  focus.activate('player-sources')
})
</script>

<template>
  <PlayerPanel
    :title="t('player.source.button')"
    :caption="t('player.source.keepsPosition')"
  >
    <AppLoader v-if="showsLoader" class="sources__loader" />
    <FocusSection
      v-else
      name="player-sources"
      class="sources__list"
      autofocus
      :[NATIVE_WHEEL_ATTRIBUTE]="true"
    >
      <p v-if="list.length === 0" class="sources__empty">
        {{ t("player.source.empty") }}
      </p>
      <PanelRow
        v-for="candidate in list"
        :key="candidate.id"
        :label="labelOf(candidate)"
        :detail="detailOf(candidate)"
        check
        :selected="candidate.lastWatched"
        @select="emit('select', candidate)"
      >
        <template v-if="candidate.lastWatched" #trailing>
          <span class="sources__current">{{ t("player.source.current") }}</span>
        </template>
      </PanelRow>
    </FocusSection>
  </PlayerPanel>
</template>

<style scoped>
.sources__loader {
  position: absolute;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.sources__list {
  height: 100%;
  /* Запас под увеличение строки в фокусе (×1.06 от ширины панели): прокрутка
     обрезает её края */
  margin: 0 calc(var(--u) * -24);
  padding: calc(var(--u) * 6) calc(var(--u) * 24);
  overflow-y: auto;
}

.sources__list::-webkit-scrollbar {
  display: none;
}

.sources__empty {
  margin: 0;
  color: var(--color-text-muted);
}

.sources__current {
  flex-shrink: 0;
  margin-left: calc(var(--u) * 16);
  font-size: var(--font-size-s);
  font-weight: 600;
  opacity: 0.72;
}
</style>
