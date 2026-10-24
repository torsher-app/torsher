<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { describeInput, INPUT_LOG_SIZE } from '../lib/inputLog.ts'

/**
 * Журнал ввода поверх экрана для проверки пульта и указки на ТВ. Слушает на
 * захвате, поэтому видит и события, которые экран или движок фокуса гасят.
 * Ничего не перехватывает и не ловит курсор.
 */
interface Line {
  id: number
  delta: number
  // R — режим пульта, P — указки на момент события
  mode: string
  text: string
}

const lines = ref<Line[]>([])
let lastAt: number | undefined
let counter = 0

const WINDOW_EVENTS = [
  'keydown',
  'keyup',
  'mousedown',
  'mouseup',
  'click',
  'contextmenu',
  'longpress',
  'blur',
  'focus',
]
const DOCUMENT_EVENTS = ['cursorStateChange', 'visibilitychange']

function record(event: Event) {
  // blur и focus элементов тоже долетают до окна на захвате; нужны только окна:
  // по ним видно, что ввод забрала система
  if (
    (event.type === 'blur' || event.type === 'focus')
    && event.target !== window
  ) {
    return
  }

  const now = performance.now()
  const text
    = event.type === 'visibilitychange'
      ? `visibilitychange ${document.visibilityState}`
      : describeInput(event as Event & { keyCode?: number })

  lines.value = [
    {
      id: ++counter,
      delta: lastAt === undefined ? 0 : Math.round(now - lastAt),
      mode:
        document.documentElement.getAttribute('data-input') === 'pointer'
          ? 'P'
          : 'R',
      text,
    },
    ...lines.value,
  ].slice(0, INPUT_LOG_SIZE)
  lastAt = now
}

onMounted(() => {
  for (const type of WINDOW_EVENTS) window.addEventListener(type, record, true)

  for (const type of DOCUMENT_EVENTS)
    document.addEventListener(type, record, true)
})

onBeforeUnmount(() => {
  for (const type of WINDOW_EVENTS)
    window.removeEventListener(type, record, true)

  for (const type of DOCUMENT_EVENTS)
    document.removeEventListener(type, record, true)
})
</script>

<template>
  <ol class="input-debug" aria-hidden="true">
    <li v-for="line in lines" :key="line.id" class="input-debug__line">
      <span class="input-debug__delta">+{{ line.delta }}</span>
      {{ line.mode }} {{ line.text }}
    </li>
  </ol>
</template>

<style scoped>
.input-debug {
  position: fixed;
  top: var(--safe-y);
  right: var(--safe-x);
  z-index: 1000;
  width: calc(var(--u) * 640);
  margin: 0;
  padding: var(--space-2) var(--space-3);
  list-style: none;
  border-radius: var(--radius-s);
  background: rgba(0, 0, 0, 0.8);
  color: var(--color-text);
  font-family: monospace;
  font-size: var(--font-size-s);
  pointer-events: none;
}

.input-debug__line {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.input-debug__delta {
  display: inline-block;
  min-width: calc(var(--u) * 90);
  color: var(--color-text-muted);
}
</style>
