<script setup lang="ts">
import type { Card, MineBootstrap } from '@torsher/api-client'
import type {
  DiaryFilter,
  DiaryScope,
  WatchedScope,
} from '../../lib/minePersonal.ts'
import { onBeforeUnmount, ref } from 'vue'
import { useFocus } from '../../focus/index.ts'
import { mineEditor } from '../../lib/mineEditor.ts'
import MineDiary from './MineDiary.vue'
import MineOverview from './MineOverview.vue'
import MineRecommendations from './MineRecommendations.vue'

const props = defineProps<{
  active: boolean
  section?: 'overview' | 'diary' | 'recommendations'
  bootstrap: MineBootstrap
  diaryFilter: DiaryFilter
  diaryScope: DiaryScope
  diaryDrilldown: number
}>()

const emit = defineEmits<{
  diary: [filter: DiaryFilter, scope?: DiaryScope]
  watched: [scope: WatchedScope]
  open: [card: Card, opener?: HTMLElement]
  rememberFocus: [opener?: HTMLElement]
  updateFilter: [filter: DiaryFilter]
  clearScope: []
  returnSections: []
}>()

const focus = useFocus()
const root = ref<HTMLElement>()
const stopKey = focus.onKey((action) => {
  if (
    action.type !== 'back'
    || !props.active
    || mineEditor.value
    || !root.value?.contains(focus.current() ?? null)
  ) {
    return false
  }
  emit('returnSections')
  return true
})
onBeforeUnmount(stopKey)
</script>

<template>
  <div ref="root" class="mine-personal">
    <KeepAlive>
      <MineOverview
        v-if="section === 'overview'"
        :today="bootstrap.today"
        @open="(card, opener) => emit('open', card, opener)"
        @diary="(filter, scope) => emit('diary', filter, scope)"
        @watched="emit('watched', $event)"
      />
      <MineDiary
        v-else-if="section === 'diary'"
        :filter="diaryFilter"
        :scope="diaryScope"
        :drilldown="diaryDrilldown"
        :today="bootstrap.today"
        :time-zone="bootstrap.timeZone"
        @open="(card, opener) => emit('open', card, opener)"
        @remember-focus="emit('rememberFocus', $event)"
        @update-filter="emit('updateFilter', $event)"
        @clear-scope="emit('clearScope')"
      />
      <MineRecommendations
        v-else-if="section === 'recommendations'"
        @open="(card, opener) => emit('open', card, opener)"
      />
    </KeepAlive>
  </div>
</template>

<style scoped>
.mine-personal {
  position: absolute;
  top: 0;
  right: var(--safe-x);
  bottom: 0;
  left: calc(var(--u) * 760);
}
</style>
