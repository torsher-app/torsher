<script setup lang="ts">
import type { SampleTitle } from '../sampleTitles.ts'

defineProps<{ title: SampleTitle }>()

defineEmits<{ select: [] }>()
</script>

<template>
  <button v-focusable class="poster" type="button" @click="$emit('select')">
    <span class="poster__image" :style="{ backgroundColor: title.color }" />
    <span class="poster__title">{{ title.title }}</span>
    <span class="poster__year">{{ title.year }}</span>
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
.poster__image {
  display: block;
  padding-top: 150%;
  border-radius: var(--radius-m);
}

.poster__title {
  display: block;
  margin-top: var(--space-2);
  font-size: var(--font-size-s);
}

.poster__year {
  display: block;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}
</style>
