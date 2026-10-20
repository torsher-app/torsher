<script setup lang="ts">
import type { Person } from '@torsher/api-client'
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    person: Person
    loadImage?: boolean
  }>(),
  { loadImage: true },
)

// Без фото — инициалы: первые буквы первых двух слов имени
const initials = computed(() =>
  props.person.name
    .split(/\s+/)
    .slice(0, 2)
    .map(word => word.charAt(0))
    .join('')
    .toUpperCase(),
)
</script>

<template>
  <button v-focusable class="card person-card" type="button">
    <span class="person-card__face">
      <img
        v-if="person.photo && loadImage"
        class="person-card__photo"
        :src="person.photo"
        alt=""
        decoding="async"
      >
      <span v-else-if="!person.photo" class="person-card__initials">
        {{ initials }}
      </span>
      <span class="card__ring person-card__ring" />
    </span>
    <span class="person-card__name">{{ person.name }}</span>
    <span class="person-card__role">{{ person.role }}</span>
  </button>
</template>

<style scoped>
.person-card {
  display: block;
  width: calc(var(--u) * 200);
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: center;
}

.person-card__face {
  position: relative;
  display: block;
  width: calc(var(--u) * 140);
  height: calc(var(--u) * 140);
  margin: 0 auto calc(var(--u) * 14);
  border-radius: 50%;
  background: var(--color-surface-raised);
}

.person-card__photo {
  width: 100%;
  height: 100%;
  border-radius: 50%;
  object-fit: cover;
}

.person-card__initials {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--color-text-muted);
  font-size: calc(var(--u) * 52);
  font-weight: 600;
}

.person-card__ring {
  border-radius: 50%;
}

.person-card__name,
.person-card__role {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.person-card__name {
  font-weight: 600;
  font-size: var(--font-size-s);
}

.person-card__role {
  min-height: calc(var(--u) * 22 * 1.3);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
}
</style>
