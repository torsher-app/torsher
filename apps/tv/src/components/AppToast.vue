<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

/**
 * Всплывающее сообщение внизу экрана: ошибка действия, которая не должна
 * сдвигать разметку. Само скрывается через несколько секунд.
 */
const props = defineProps<{ message: string }>()

const emit = defineEmits<{ hide: [] }>()

const VISIBLE_MS = 5000

let timer: ReturnType<typeof setTimeout> | undefined

watch(
  () => props.message,
  (value) => {
    clearTimeout(timer)

    if (value)
      timer = setTimeout(emit, VISIBLE_MS, 'hide')
  },
  { immediate: true },
)

onBeforeUnmount(() => clearTimeout(timer))
</script>

<template>
  <p v-if="message" class="toast" role="alert">
    {{ message }}
  </p>
</template>

<style scoped>
.toast {
  position: fixed;
  z-index: 30;
  bottom: var(--safe-y);
  left: 50%;
  max-width: calc(var(--u) * 1100);
  margin: 0;
  padding: calc(var(--u) * 20) calc(var(--u) * 32);
  border-radius: calc(var(--u) * 16);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-size: var(--font-size-s);
  font-weight: 500;
  transform: translateX(-50%);
}
</style>
