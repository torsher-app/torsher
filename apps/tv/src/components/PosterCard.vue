<script setup lang="ts">
import type { Card } from '@torsher/api-client'

defineProps<{ card: Card }>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button v-focusable class="poster" type="button" @click="$emit('select')">
    <span class="poster__frame">
      <img
        v-if="card.poster"
        class="poster__image"
        :src="card.poster"
        alt=""
        decoding="async"
      >
      <span v-else class="poster__placeholder">{{ card.title }}</span>
    </span>
    <span class="poster__title">{{ card.title }}</span>
    <span class="poster__year">{{ card.year }}</span>
  </button>
</template>

<style scoped>
.poster {
  display: block;
  width: var(--poster-width);
  padding: 0;
  border: 0;
  border-radius: var(--radius-m);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

/* aspect-ratio появился в Chromium 88 — пропорции 2:3 держим через padding */
.poster__frame {
  position: relative;
  display: block;
  padding-top: 150%;
  overflow: hidden;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.poster__image,
.poster__placeholder {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.poster__image {
  object-fit: cover;
}

.poster__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  text-align: center;
}

.poster__title,
.poster__year {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  overflow: hidden;
  font-size: var(--font-size-s);
  white-space: nowrap;
  text-overflow: ellipsis;
}

.poster__title {
  margin-top: var(--space-2);
}

.poster__year {
  color: var(--color-text-muted);
}
</style>
