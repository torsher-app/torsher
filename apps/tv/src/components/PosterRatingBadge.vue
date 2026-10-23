<script setup lang="ts">
import type { Card } from '@torsher/api-client'
import { computed } from 'vue'
import { posterRatingOf } from '../titleActions.ts'

/** Значок оценки в углу постера; без оценки ничего не рисует, постер чистый */
const props = defineProps<{ card: Card }>()

const rating = computed(() => posterRatingOf(props.card))

const SOURCE_LABELS = { tmdb: 'TMDB', imdb: 'IMDb' } as const
</script>

<template>
  <span
    v-if="rating"
    class="poster-rating"
    :class="`poster-rating--${rating.source}`"
  >
    <template v-if="rating.source === 'own'">★ {{ rating.value }}</template>
    <template v-else>
      <span class="poster-rating__source">{{
        SOURCE_LABELS[rating.source]
      }}</span>
      {{ rating.value.toFixed(1) }}
    </template>
  </span>
</template>

<style scoped>
/* Поверх картинки, своим слоем: появление значка не сдвигает постер */
.poster-rating {
  position: absolute;
  bottom: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
  z-index: 1;
  display: flex;
  align-items: center;
  height: calc(var(--u) * 36);
  padding: 0 calc(var(--u) * 12);
  border-radius: calc(var(--u) * 18);
  background: rgba(10, 12, 18, 0.78);
  color: var(--color-text);
  font-size: calc(var(--u) * 22);
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  line-height: 1;
  white-space: nowrap;
}

.poster-rating--own {
  color: var(--color-warn);
}

.poster-rating__source {
  margin-right: calc(var(--u) * 6);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 16);
  font-weight: 600;
}
</style>
