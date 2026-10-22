<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '../AppIcon.vue'
import FocusSection from '../FocusSection.vue'

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
  <div class="tracks">
    <div class="tracks__scrim" />
    <aside class="tracks__panel" :aria-label="t(`player.${kind}`)">
      <h2 class="tracks__title">
        {{ t(`player.${kind}`) }}
      </h2>
      <p v-if="caption" class="tracks__caption">
        {{ caption }}
      </p>
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
          <span class="tracks__text">
            <span class="tracks__label">{{ option.label }}</span>
            <span v-if="option.detail" class="tracks__detail">{{
              option.detail
            }}</span>
          </span>
        </button>
      </FocusSection>
      <p v-if="hint" class="tracks__hint">
        {{ hint }}
      </p>
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
  display: flex;
  flex-direction: column;
  width: calc(var(--u) * 760);
  padding: var(--safe-y) var(--safe-x) var(--safe-y) calc(var(--u) * 56);
  background: var(--color-surface);
}

.tracks__title {
  margin: 0 0 calc(var(--u) * 8);
  font-size: var(--font-size-l);
  font-weight: 700;
}

.tracks__caption {
  margin: 0 0 calc(var(--u) * 30);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.tracks__title + :not(.tracks__caption) {
  margin-top: calc(var(--u) * 22);
}

/* Строка — фокус-язык строк: белая заливка с тёмным текстом */
.tracks__row {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: calc(var(--u) * 8);
  padding: calc(var(--u) * 20) calc(var(--u) * 24);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: none;
  color: var(--color-text);
  font: inherit;
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

.tracks__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.tracks__label {
  overflow: hidden;
  font-size: var(--font-size-m);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tracks__detail {
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.tracks__row:focus .tracks__detail {
  color: inherit;
  opacity: 0.7;
}

.tracks__hint {
  margin: auto 0 0;
  padding-top: calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
