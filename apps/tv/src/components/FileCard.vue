<script setup lang="ts">
import type { FileCard } from '@torsher/api-client'
import { computed, ref } from 'vue'
import { albumName, formatCaptured } from '../lib/homeVideo.ts'
import { formatDuration } from '../lib/player.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import AppIcon from './AppIcon.vue'
import ProgressTrack from './ProgressTrack.vue'

/**
 * Файл библиотеки без тайтла (домашнее видео, «Без описания»): кадр 16:9,
 * имя файла и дата съёмки или длительность. Кадр делает сервер по запросу
 */
const props = withDefaults(
  defineProps<{ file: FileCard, loadImage?: boolean, dated?: boolean }>(),
  { loadImage: true, dated: false },
)

defineEmits<{ select: [] }>()

const locale = useCatalogLanguage()
const broken = ref(false)

const meta = computed(() => {
  const { capturedAt, duration } = props.file
  // Домашнее видео — дата съёмки; файл без описания — его папка
  const place = props.dated
    ? capturedAt
      ? formatCaptured(capturedAt, locale.value)
      : ''
    : albumName(props.file.album ?? '')
  const parts = [place, duration ? formatDuration(duration) : '']

  return parts.filter(Boolean).join(' · ')
})
</script>

<template>
  <button
    v-focusable
    class="card file-card"
    type="button"
    @click="$emit('select')"
  >
    <span class="file-card__frame">
      <img
        v-if="loadImage && !broken"
        class="file-card__image"
        :src="file.thumb"
        alt=""
        decoding="async"
        @error="broken = true"
      >
      <AppIcon v-else name="play" class="file-card__icon" />
      <ProgressTrack v-if="file.share > 0" :value="file.share" />
      <span class="card__ring" />
    </span>
    <span class="file-card__name">{{ file.name }}</span>
    <span class="file-card__meta">{{ meta }}</span>
  </button>
</template>

<style scoped>
.file-card {
  position: relative;
  display: block;
  flex-shrink: 0;
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
.file-card__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.file-card__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
  object-fit: cover;
}

.file-card__icon {
  position: absolute;
  top: 50%;
  left: 50%;
  margin: calc(var(--u) * -28) 0 0 calc(var(--u) * -28);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 56);
}

.file-card__name,
.file-card__meta {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  overflow: hidden;
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.file-card__name {
  margin-top: calc(var(--u) * 14);
  font-weight: 600;
}

.file-card__meta {
  color: var(--color-text-muted);
  font-variant-numeric: tabular-nums;
}
</style>
