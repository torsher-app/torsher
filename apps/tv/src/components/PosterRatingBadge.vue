<script setup lang="ts">
import type { Card } from '@torsher/api-client'
import { computed } from 'vue'
import { ownRatingOf } from '../titleActions.ts'

/**
 * Значки оценок на постере: своя — в правом верхнем углу, оценки сервисов —
 * одной плашкой в левом нижнем. Без оценок ничего не рисует, постер чистый.
 */
const props = defineProps<{ card: Card }>()

const own = computed(() => ownRatingOf(props.card))
const services = computed(() => props.card.posterRatings ?? [])

const SOURCE_LABELS = { tmdb: 'TMDB', imdb: 'IMDb' } as const
</script>

<template>
  <span v-if="own" class="poster-rating poster-rating--own">★ {{ own }}</span>
  <span
    v-if="services.length > 0"
    class="poster-rating poster-rating--services"
  >
    <span
      v-for="rating in services"
      :key="rating.source"
      class="poster-rating__item"
    >
      <span class="poster-rating__source">{{
        SOURCE_LABELS[rating.source]
      }}</span>
      {{ rating.value.toFixed(1) }}
    </span>
  </span>
</template>

<style scoped>
/* Поверх картинки, своим слоем: появление значка не сдвигает постер */
.poster-rating {
  position: absolute;
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
  top: calc(var(--u) * 12);
  right: calc(var(--u) * 12);
  color: var(--color-warn);
}

.poster-rating--services {
  bottom: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
}

/* Отступ через margin: gap у flexbox нет в Chromium 68 */
.poster-rating__item + .poster-rating__item {
  margin-left: calc(var(--u) * 12);
}

.poster-rating__source {
  margin-right: calc(var(--u) * 6);
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 16);
  font-weight: 600;
}
</style>
