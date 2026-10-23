<script setup lang="ts">
import type { Episode } from '@torsher/api-client'
import AppIcon from './AppIcon.vue'

/**
 * Строка полного списка серий: кадр с номером и прогрессом, название, мета,
 * две строки описания. Высота у всех строк одна: описание любой длины её не
 * меняет, и список не прыгает при прокрутке.
 */
withDefaults(
  defineProps<{
    episode: Episode
    // Длительность и дата выхода
    detail?: string
    // «просмотрено», «осталось 12 мин» или пусто
    status?: string
    // Доля просмотренного 0…1 и отметка «просмотрено»
    progress?: number
    watched?: boolean
  }>(),
  { detail: '', status: '', progress: 0, watched: false },
)

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    v-focusable
    class="episode-row"
    :class="{ 'episode-row--watched': watched }"
    type="button"
    :data-episode="episode.number"
    @click="$emit('select')"
  >
    <span class="episode-row__frame">
      <img
        v-if="episode.still"
        class="episode-row__image"
        :src="episode.still"
        alt=""
        decoding="async"
      >
      <span class="episode-row__number" aria-hidden="true">
        {{ episode.number }}
      </span>
      <span v-if="watched" class="episode-row__watched">
        <AppIcon name="check" />
      </span>
      <span v-if="progress > 0" class="episode-row__track">
        <span
          class="episode-row__progress"
          :style="{ transform: `scaleX(${progress})` }"
        />
      </span>
    </span>
    <span class="episode-row__body">
      <span class="episode-row__title">
        {{ episode.number }}. {{ episode.title }}
      </span>
      <span class="episode-row__detail">
        {{ detail }}
        <template v-if="detail && status">·</template>
        <span v-if="status" class="episode-row__status">{{ status }}</span>
      </span>
      <span class="episode-row__overview">{{ episode.overview }}</span>
    </span>
  </button>
</template>

<style scoped>
.episode-row {
  display: flex;
  align-items: flex-start;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: calc(var(--u) * 16) calc(var(--u) * 24) calc(var(--u) * 16) calc(var(--u) * 16);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  /* Заливка без перехода: список прокручивается нативно, как у строк «Файлов» */
  transition: transform var(--motion-base) var(--motion-easing);
}

.episode-row:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.episode-row__frame {
  position: relative;
  flex-shrink: 0;
  width: calc(var(--u) * 288);
  height: calc(var(--u) * 162);
  margin-right: calc(var(--u) * 28);
  overflow: hidden;
  border-radius: calc(var(--u) * 10);
  background: var(--color-surface);
}

.episode-row__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.episode-row__number {
  position: absolute;
  right: calc(var(--u) * 12);
  bottom: calc(var(--u) * 6);
  color: #fff;
  font-size: calc(var(--u) * 48);
  font-weight: 700;
  line-height: 1.1;
  text-shadow: 0 0 calc(var(--u) * 12) rgba(0, 0, 0, 0.8);
}

.episode-row__watched {
  position: absolute;
  top: calc(var(--u) * 10);
  right: calc(var(--u) * 10);
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 40);
  height: calc(var(--u) * 40);
  border-radius: 50%;
  background: var(--color-ok);
  color: var(--color-bg);
  font-size: calc(var(--u) * 24);
}

/* Дорожка видна целиком: короткий прогресс читается как доля, а не как соринка */
.episode-row__track {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: calc(var(--u) * 6);
  background: rgba(255, 255, 255, 0.25);
}

.episode-row__progress {
  display: block;
  height: 100%;
  background: var(--color-accent);
  transform-origin: left center;
}

.episode-row__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  height: calc(var(--u) * 162);
}

.episode-row__title {
  overflow: hidden;
  font-size: var(--font-size-m);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode-row__detail {
  min-height: calc(var(--font-size-s) * var(--line-height));
  margin-top: calc(var(--u) * 6);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.episode-row--watched .episode-row__status {
  color: var(--color-ok);
}

.episode-row__overview {
  display: -webkit-box;
  margin-top: calc(var(--u) * 10);
  overflow: hidden;
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
  line-height: 1.4;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

.episode-row--watched:not(:focus) .episode-row__title {
  color: var(--color-text-muted);
}

.episode-row:focus .episode-row__detail,
.episode-row:focus .episode-row__status,
.episode-row:focus .episode-row__overview {
  color: var(--color-bg);
}
</style>
