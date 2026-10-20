<script setup lang="ts">
import type { Card } from '@torsher/api-client'

withDefaults(
  defineProps<{
    card: Card
    // В рядах карточка без текста, в сетке поиска — с названием и годом
    caption?: boolean
    // Далёкие от фокуса ряды не держат картинки в памяти ТВ
    loadImage?: boolean
  }>(),
  { caption: false, loadImage: true },
)

defineEmits<{ select: [] }>()
</script>

<template>
  <button
    v-focusable
    class="card poster-card"
    type="button"
    @click="$emit('select')"
  >
    <span class="poster-card__frame">
      <img
        v-if="card.poster && loadImage"
        class="poster-card__image"
        :src="card.poster"
        alt=""
        decoding="async"
      >
      <span v-else-if="!card.poster" class="poster-card__placeholder">
        {{ card.title }}
      </span>
      <span class="card__ring" />
    </span>
    <template v-if="caption">
      <span class="poster-card__title">{{ card.title }}</span>
      <span class="poster-card__year">{{ card.year }}</span>
    </template>
  </button>
</template>

<style scoped>
.poster-card {
  position: relative;
  display: block;
  flex-shrink: 0;
  width: var(--poster-width);
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}

/* aspect-ratio появился в Chromium 88 — пропорции 2:3 держим через padding */
.poster-card__frame {
  position: relative;
  display: block;
  padding-top: 150%;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.poster-card__image,
.poster-card__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border-radius: var(--radius-m);
}

.poster-card__image {
  object-fit: cover;
}

.poster-card__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  text-align: center;
}

.poster-card__title,
.poster-card__year {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  overflow: hidden;
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.poster-card__title {
  margin-top: calc(var(--u) * 14);
  font-weight: 600;
}

.poster-card__year {
  color: var(--color-text-muted);
}
</style>
