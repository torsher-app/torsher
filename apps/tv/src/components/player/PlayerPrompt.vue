<script setup lang="ts" generic="T extends string">
import FocusSection from '../FocusSection.vue'

defineProps<{
  title: string
  text?: string
  /** Первое действие получает фокус и выглядит главным */
  actions: { id: T, label: string }[]
}>()

const emit = defineEmits<{ choose: [id: T] }>()
</script>

<template>
  <div class="prompt" role="dialog" :aria-label="title">
    <p class="prompt__title">
      {{ title }}
    </p>
    <p v-if="text" class="prompt__text">
      {{ text }}
    </p>
    <FocusSection name="player-prompt" autofocus manual-scroll>
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
  position: absolute;
  bottom: calc(var(--u) * 140);
  left: var(--safe-x);
  max-width: calc(var(--u) * 1100);
}

.prompt__title {
  margin: 0 0 var(--space-4);
  font-size: var(--font-size-l);
  font-weight: 700;
}

.prompt__text {
  margin: calc(var(--space-3) * -1) 0 var(--space-4);
  color: var(--color-text-muted);
}
</style>
