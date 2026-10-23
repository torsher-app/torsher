<script setup lang="ts">
import type { Episode } from '@torsher/api-client'
import AppIcon from './AppIcon.vue'
import ProgressTrack from './ProgressTrack.vue'
import WatchedMark from './WatchedMark.vue'

withDefaults(
  defineProps<{
    episode: Episode
    // Вторая строка подписи: длительность или дата выхода
    meta?: string
    loadImage?: boolean
    // Доля просмотренного 0…1 и отметка «просмотрено»
    progress?: number
    watched?: boolean
    // Серия лежит в библиотеке: полка в левом верхнем углу кадра
    inLibrary?: boolean
  }>(),
  { meta: '', loadImage: true, progress: 0, watched: false, inLibrary: false },
)

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    v-focusable
    class="card episode-card"
    type="button"
    @click="$emit('select')"
  >
    <span class="episode-card__frame">
      <img
        v-if="episode.still && loadImage"
        class="episode-card__image"
        :src="episode.still"
        alt=""
        decoding="async"
      >
      <span class="episode-card__number" aria-hidden="true">
        {{ episode.number }}
      </span>
      <WatchedMark v-if="watched" />
      <span v-if="inLibrary" class="episode-card__library">
        <AppIcon name="library" />
      </span>
      <ProgressTrack v-if="progress > 0" :value="progress" />
      <span class="card__ring" />
    </span>
    <span class="episode-card__title">
      {{ episode.number }}. {{ episode.title }}
    </span>
    <span class="episode-card__meta">{{ meta }}</span>
  </button>
</template>

<style scoped>
/* Поверх кадра, как отметка «просмотрено»: карточка не меняет размер */
.episode-card__library {
  position: absolute;
  z-index: 1;
  top: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 40);
  height: calc(var(--u) * 40);
  border-radius: 50%;
  background: rgba(10, 12, 18, 0.78);
  color: var(--color-ok);
  font-size: calc(var(--u) * 24);
}

.episode-card {
  position: relative;
  display: block;
  width: calc(var(--u) * 420);
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

/* 16:9 через padding: aspect-ratio появился только в Chromium 88 */
.episode-card__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.episode-card__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
  object-fit: cover;
}

.episode-card__number {
  position: absolute;
  right: calc(var(--u) * 16);
  bottom: calc(var(--u) * 10);
  color: rgba(255, 255, 255, 0.88);
  font-size: calc(var(--u) * 64);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.04em;
  text-shadow: 0 0 calc(var(--u) * 12) rgba(0, 0, 0, 0.5);
}

.episode-card__title,
.episode-card__meta {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.episode-card__title {
  margin-top: calc(var(--u) * 16);
  font-size: calc(var(--u) * 26);
  font-weight: 600;
}

.episode-card__meta {
  min-height: calc(var(--font-size-s) * var(--line-height));
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
