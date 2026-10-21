<script setup lang="ts">
import type { VoiceOption } from '@torsher/api-client'
import { onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import { useFocus } from '../focus/index.ts'
import AppIcon from './AppIcon.vue'
import FocusSection from './FocusSection.vue'

const props = defineProps<{
  voices: VoiceOption[]
}>()

const emit = defineEmits<{
  pin: [voice: VoiceOption | null]
  sources: []
  close: []
}>()

const { t } = useI18n()
const focus = useFocus()
const { voiceLabel, seedersLabel } = useSourceLabels()

function detailOf(option: VoiceOption) {
  return [
    option.studio && option.type ? t(`sources.voiceTypes.${option.type}`) : '',
    option.maxQuality ? t('voice.upTo', { quality: option.maxQuality }) : '',
    seedersLabel(option.seeders),
  ]
    .filter(Boolean)
    .join(' · ')
}

const hasPinned = () => props.voices.some(option => option.pinned)

const stopKey = focus.onKey((action) => {
  if (action.type !== 'back')
    return false

  emit('close')

  return true
})

onBeforeUnmount(stopKey)
</script>

<template>
  <div class="voices">
    <div class="voices__scrim" @click="emit('close')" />
    <aside class="voices__panel" :aria-label="t('voice.title')">
      <h2 class="voices__title">
        {{ t("voice.title") }}
      </h2>
      <p v-if="voices.length === 0" class="voices__empty">
        {{ t("voice.empty") }}
      </p>
      <FocusSection name="title-voices" autofocus>
        <button
          v-for="option in voices"
          :key="option.key"
          v-focusable
          class="voices__row"
          type="button"
          :aria-pressed="option.pinned"
          @click="emit('pin', option)"
        >
          <span class="voices__check">
            <AppIcon v-if="option.pinned" name="check" />
          </span>
          <span class="voices__text">
            <span class="voices__name">{{ voiceLabel(option) }}</span>
            <span class="voices__detail">
              {{ detailOf(option) }}
              <template v-if="option.pinned">
                · {{ t("voice.pinned") }}
              </template>
            </span>
          </span>
        </button>
        <button
          v-if="hasPinned()"
          v-focusable
          class="voices__row"
          type="button"
          @click="emit('pin', null)"
        >
          <span class="voices__check" />
          <span class="voices__name">{{ t("voice.unpin") }}</span>
        </button>
        <button
          v-focusable
          class="voices__row"
          type="button"
          @click="emit('sources')"
        >
          <span class="voices__check" />
          <span class="voices__name">{{ t("voice.allSources") }}</span>
        </button>
      </FocusSection>
    </aside>
  </div>
</template>

<style scoped>
.voices {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
}

.voices__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.45);
}

.voices__panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: calc(var(--u) * 760);
  padding: var(--safe-y) var(--safe-x) var(--safe-y) calc(var(--u) * 56);
  overflow: hidden;
  background: var(--color-surface);
}

.voices__title {
  margin: 0 0 calc(var(--u) * 30);
  font-size: var(--font-size-l);
  font-weight: 700;
}

.voices__empty {
  margin: 0 0 calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

/* Строка — фокус-язык строк: белая заливка с тёмным текстом */
.voices__row {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: calc(var(--u) * 18) calc(var(--u) * 24);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: none;
  color: var(--color-text);
  font: inherit;
  text-align: left;
}

.voices__row:focus {
  --bump-scale: var(--focus-scale);

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.voices__check {
  width: calc(var(--u) * 32);
  height: calc(var(--u) * 32);
  margin-right: calc(var(--u) * 18);
  flex-shrink: 0;
}

.voices__check :deep(.icon) {
  width: 100%;
  height: 100%;
}

.voices__text {
  display: flex;
  flex-direction: column;
}

.voices__name {
  font-weight: 600;
}

.voices__detail {
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
}

.voices__row:focus .voices__detail {
  color: var(--color-bg);
}
</style>
