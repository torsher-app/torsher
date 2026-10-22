<script setup lang="ts" generic="T extends string">
import FocusSection from '../FocusSection.vue'

// Содержимое сцены плеера (`PlayerStage`): заголовок, текст и действия по центру
defineProps<{
  title?: string
  text?: string
  /** Доля просмотренного для полосы под текстом: 0…1 */
  progress?: number
  /** Первое действие получает фокус и выглядит главным */
  actions: { id: T, label: string }[]
}>()

const emit = defineEmits<{ choose: [id: T] }>()
</script>

<template>
  <div class="prompt" role="dialog" :aria-label="title ?? text">
    <p v-if="title" class="prompt__title">
      {{ title }}
    </p>
    <p v-if="text" class="prompt__text">
      {{ text }}
    </p>
    <span v-if="progress !== undefined" class="prompt__track">
      <span
        class="prompt__progress"
        :style="{ transform: `scaleX(${progress})` }"
      />
    </span>
    <FocusSection
      name="player-prompt"
      class="prompt__actions"
      autofocus
      manual-scroll
    >
      <button
        v-for="(action, index) in actions"
        :key="action.id"
        v-focusable
        class="action"
        :class="{ 'action--primary': index === 0 }"
        type="button"
        @click="emit('choose', action.id)"
      >
        {{ action.label }}
      </button>
    </FocusSection>
  </div>
</template>

<style scoped>
.prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: calc(var(--u) * 1100);
}

.prompt__title {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-l);
  font-weight: 700;
}

.prompt__text {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
}

/* Где остановились — та же дорожка, что у серий в карточке и «Файлах» */
.prompt__track {
  width: calc(var(--u) * 480);
  height: calc(var(--u) * 6);
  margin-top: var(--space-3);
  overflow: hidden;
  border-radius: calc(var(--u) * 3);
  background: rgba(255, 255, 255, 0.25);
}

.prompt__progress {
  display: block;
  height: 100%;
  background: var(--color-accent);
  transform-origin: left center;
}

.prompt__actions {
  display: flex;
  justify-content: center;
  margin-top: var(--space-4);
}

/* Без gap: flex-gap нет в Chromium 68 */
.prompt__actions .action + .action {
  margin-left: var(--space-2);
}
</style>
