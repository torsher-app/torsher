<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '../AppIcon.vue'
import FocusSection from '../FocusSection.vue'

export interface TrackOption {
  id: string
  label: string
  selected: boolean
}

defineProps<{
  kind: 'audio' | 'subtitles'
  options: TrackOption[]
}>()

const emit = defineEmits<{ select: [id: string] }>()

const { t } = useI18n()
</script>

<template>
  <div class="tracks">
    <div class="tracks__scrim" />
    <aside class="tracks__panel" :aria-label="t(`player.${kind}`)">
      <h2 class="tracks__title">
        {{ t(`player.${kind}`) }}
      </h2>
      <FocusSection name="player-tracks" autofocus manual-scroll>
        <button
          v-for="option in options"
          :key="option.id"
          v-focusable
          class="tracks__row"
          type="button"
          :aria-pressed="option.selected"
          @click="emit('select', option.id)"
        >
          <span class="tracks__check">
            <AppIcon v-if="option.selected" name="check" />
          </span>
          {{ option.label }}
        </button>
      </FocusSection>
    </aside>
  </div>
</template>

<style scoped>
.tracks__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.35);
}

.tracks__panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: calc(var(--u) * 760);
  padding: var(--safe-y) var(--safe-x) var(--safe-y) calc(var(--u) * 56);
  background: var(--color-surface);
}

.tracks__title {
  margin: 0 0 calc(var(--u) * 30);
  font-size: var(--font-size-l);
  font-weight: 700;
}

/* Строка — фокус-язык строк: белая заливка с тёмным текстом */
.tracks__row {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: calc(var(--u) * 20) calc(var(--u) * 24);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: none;
  color: var(--color-text);
  font: inherit;
  font-weight: 600;
  text-align: left;
}

.tracks__row:focus {
  --bump-scale: var(--focus-scale);

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.tracks__check {
  width: calc(var(--u) * 32);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 18);
  flex-shrink: 0;
}

.tracks__check :deep(.icon) {
  width: 100%;
  height: 100%;
}
</style>
