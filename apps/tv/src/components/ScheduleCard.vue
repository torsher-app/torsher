<script setup lang="ts">
import type { ScheduleItem } from '@torsher/api-client'
import { computed } from 'vue'
import { useFollowTexts } from '../composables/useTitleFollow.ts'
import { openTitleActions } from '../titleActions.ts'
import AppIcon from './AppIcon.vue'

/**
 * Серия в «Расписании»: кадр 16:9, сериал и «S2E5 · LostFilm · в библиотеке».
 * Без состояния «Следить» (серия до курсора, сериал без слежения) — название
 * серии.
 */
const props = defineProps<{ item: ScheduleItem }>()

defineEmits<{ select: [] }>()

const texts = useFollowTexts()

const meta = computed(() => {
  const { item } = props
  const state = texts.episodeState(item.state)

  return [
    `S${item.season}E${item.episode}`,
    item.studio,
    state || item.episodeTitle,
  ]
    .filter(Boolean)
    .join(' · ')
})

function openActions() {
  openTitleActions({
    id: props.item.titleId,
    title: props.item.title,
    kind: 'series',
  })
}
</script>

<template>
  <button
    v-focusable
    class="card schedule-card"
    type="button"
    data-long-press
    @click="$emit('select')"
    @longpress="openActions"
  >
    <span class="schedule-card__frame">
      <img
        v-if="item.image"
        class="schedule-card__image"
        :src="item.image"
        alt=""
        decoding="async"
      >
      <span v-if="item.mediaFileId" class="schedule-card__library">
        <AppIcon name="library" />
      </span>
      <span class="card__ring" />
    </span>
    <span class="schedule-card__title">{{ item.title }}</span>
    <span class="schedule-card__meta">{{ meta }}</span>
  </button>
</template>

<style scoped>
/* Три в ряд шириной сетки постеров «Моё»: 3 × 330 + 2 × 36 = 4 × 240 + 3 × 34 */
.schedule-card {
  position: relative;
  display: block;
  flex-shrink: 0;
  width: calc(var(--u) * 330);
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

/* 16:9 через padding: aspect-ratio появился только в Chromium 88 */
.schedule-card__frame {
  position: relative;
  display: block;
  padding-top: 56.25%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.schedule-card__image {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
  object-fit: cover;
}

/* Серия в библиотеке: полка, как у серий на карточке тайтла */
.schedule-card__library {
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

.schedule-card__title,
.schedule-card__meta {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  overflow: hidden;
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.schedule-card__title {
  margin-top: calc(var(--u) * 14);
  font-weight: 600;
}

.schedule-card__meta {
  color: var(--color-text-muted);
}
</style>
