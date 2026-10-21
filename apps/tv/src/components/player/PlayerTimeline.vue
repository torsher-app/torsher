<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatDuration } from '../../lib/player.ts'

const props = defineProps<{
  position: number
  duration: number
  /** До какой секунды видео уже скачано подряд */
  bufferEnd: number
  /** Цель перемотки, пока её набирают стрелками */
  scrubTarget: number | null
}>()

const emit = defineEmits<{
  toggle: []
  seek: [fraction: number]
}>()

const { t } = useI18n()

function fraction(seconds: number) {
  if (!Number.isFinite(props.duration) || props.duration <= 0)
    return 0

  return Math.min(1, Math.max(0, seconds / props.duration))
}

const shown = computed(() => props.scrubTarget ?? props.position)
const played = computed(() => fraction(shown.value))
const buffered = computed(() =>
  Math.max(played.value, fraction(props.bufferEnd)),
)
const markerStyle = computed(() => ({
  transform: `translateX(${played.value * 100}%)`,
}))

// OK с пульта приходит кликом без координат (`detail` 0): пауза.
// Клик мышью по полосе — переход в эту точку
function onClick(event: MouseEvent) {
  if (event.detail === 0) {
    emit('toggle')
    return
  }

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()

  emit(
    'seek',
    Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
  )
}
</script>

<template>
  <button
    v-focusable
    class="timeline"
    :class="{ 'timeline--scrubbing': scrubTarget !== null }"
    type="button"
    :aria-label="t('player.timeline', { position: formatDuration(shown) })"
    @click="onClick"
  >
    <span class="timeline__track">
      <span
        class="timeline__fill timeline__fill--buffer"
        :style="{ transform: `scaleX(${buffered})` }"
      />
      <span
        class="timeline__fill timeline__fill--played"
        :style="{ transform: `scaleX(${played})` }"
      />
    </span>
    <span class="timeline__marker" :style="markerStyle">
      <span class="timeline__thumb" />
      <span v-if="scrubTarget !== null" class="timeline__bubble">
        {{ formatDuration(scrubTarget) }}
      </span>
    </span>
  </button>
</template>

<style scoped>
/* Полоса растягивается на ширину OSD; высота кнопки — зона наведения и фокуса */
.timeline {
  position: relative;
  display: block;
  width: 100%;
  height: calc(var(--u) * 64);
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
}

.timeline__track {
  position: absolute;
  top: 50%;
  right: 0;
  left: 0;
  height: calc(var(--u) * 8);
  margin-top: calc(var(--u) * -4);
  overflow: hidden;
  border-radius: calc(var(--u) * 4);
  background: rgba(255, 255, 255, 0.22);
  transition: transform var(--motion-fast) var(--motion-easing);
}

.timeline:focus .timeline__track {
  transform: scaleY(1.5);
}

/* Заливки — scaleX от левого края: на ТВ анимируем только transform */
.timeline__fill {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  transform-origin: 0 50%;
}

.timeline__fill--buffer {
  background: rgba(255, 255, 255, 0.42);
}

.timeline__fill--played {
  background: var(--color-accent);
}

/* Маркер во всю ширину полосы: translateX в процентах его ширины = процент полосы */
.timeline__marker {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  pointer-events: none;
}

.timeline__thumb {
  position: absolute;
  top: 50%;
  left: calc(var(--u) * -12);
  width: calc(var(--u) * 24);
  height: calc(var(--u) * 24);
  margin-top: calc(var(--u) * -12);
  border-radius: 50%;
  background: var(--color-focus);
  opacity: 0;
  transition: opacity var(--motion-fast) var(--motion-easing);
}

.timeline:focus .timeline__thumb,
.timeline--scrubbing .timeline__thumb {
  opacity: 1;
}

.timeline__bubble {
  position: absolute;
  bottom: calc(var(--u) * 56);
  left: 0;
  padding: calc(var(--u) * 6) calc(var(--u) * 16);
  border-radius: var(--radius-s);
  background: var(--color-focus);
  color: var(--color-bg);
  font-size: var(--font-size-s);
  font-weight: 600;
  white-space: nowrap;
  transform: translateX(-50%);
}
</style>
