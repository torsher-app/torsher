<script setup lang="ts">
import type { Card } from '@torsher/api-client'
import { openTitleActions } from '../titleActions.ts'
import DownloadBadge from './DownloadBadge.vue'
import PosterRatingBadge from './PosterRatingBadge.vue'

const props = withDefaults(
  defineProps<{
    card: Card
    rank: number
    loadImage?: boolean
  }>(),
  { loadImage: true },
)

defineEmits<{ select: [] }>()

function openActions() {
  openTitleActions({
    id: props.card.id,
    title: props.card.title,
    kind: props.card.kind,
  })
}
</script>

<template>
  <button
    v-focusable
    class="card top-card"
    type="button"
    data-long-press
    @click="$emit('select')"
    @longpress="openActions"
  >
    <span class="top-card__rank" aria-hidden="true">{{ rank }}</span>
    <span class="top-card__frame">
      <img
        v-if="card.poster && loadImage"
        class="top-card__image"
        :src="card.poster"
        alt=""
        decoding="async"
      >
      <span v-else-if="!card.poster" class="top-card__placeholder">
        {{ card.title }}
      </span>
      <PosterRatingBadge :card="card" />
      <DownloadBadge :card="card" />
      <span class="card__ring" />
    </span>
  </button>
</template>

<style scoped>
/*
 * Ширина у всех карточек ряда одна: ряд считает позиции по шагу карточки.
 * Двузначная цифра заходит под предыдущий постер.
 */
.top-card {
  position: relative;
  display: flex;
  flex-shrink: 0;
  align-items: flex-end;
  width: calc(var(--u) * 400);
  height: calc(var(--poster-width) * 1.5);
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
}

/* Контурная цифра; без -webkit-text-stroke — заливка цветом поверхности */
.top-card__rank {
  position: relative;
  z-index: 0;
  flex-shrink: 0;
  width: calc(var(--u) * 206);
  margin-right: calc(var(--u) * -46);
  color: var(--color-surface-raised);
  font-size: calc(var(--u) * 300);
  font-weight: 700;
  line-height: 0.74;
  letter-spacing: -0.08em;
  text-align: right;
  white-space: nowrap;
}

@supports (-webkit-text-stroke: 1px black) {
  .top-card__rank {
    color: var(--color-bg);
    -webkit-text-stroke: var(--focus-ring-width) var(--color-line);
  }

  .top-card:focus .top-card__rank {
    -webkit-text-stroke-color: var(--color-text-muted);
  }
}

.top-card__frame {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  width: var(--poster-width);
  height: calc(var(--poster-width) * 1.5);
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.top-card__image,
.top-card__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
}

.top-card__image {
  object-fit: cover;
}

.top-card__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  text-align: center;
}
</style>
