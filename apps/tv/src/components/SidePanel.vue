<script setup lang="ts">
import { onBeforeUnmount } from 'vue'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../focus/index.ts'

/**
 * Правая панель поверх экрана со своим содержимым в слоте (полный текст
 * биографии персоны). Back и клик по скриму закрывают, прокрутка нативная.
 */
defineProps<{ title: string }>()

const emit = defineEmits<{ close: [] }>()

const focus = useFocus()

const stopKey = focus.onKey((action) => {
  if (action.type !== 'back')
    return false

  emit('close')

  return true
})

onBeforeUnmount(stopKey)
</script>

<template>
  <div class="side-panel">
    <div class="side-panel__scrim" @click="emit('close')" />
    <aside
      class="side-panel__panel"
      :aria-label="title"
      :[NATIVE_WHEEL_ATTRIBUTE]="true"
    >
      <h2 class="side-panel__title">
        {{ title }}
      </h2>
      <slot />
    </aside>
  </div>
</template>

<style scoped>
.side-panel {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 20;
}

.side-panel__scrim {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background: rgba(0, 0, 0, 0.45);
}

.side-panel__panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  width: calc(var(--u) * 760);
  padding: var(--safe-y) var(--safe-x) 0 calc(var(--u) * 56);
  background: var(--color-surface);
}

.side-panel__title {
  margin: 0 0 calc(var(--u) * 30);
  font-size: var(--font-size-l);
  font-weight: 700;
}
</style>
