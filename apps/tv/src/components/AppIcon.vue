<script setup lang="ts">
import { computed } from 'vue'

export type IconName
  = | 'brand'
    | 'search'
    | 'home'
    | 'movies'
    | 'series'
    | 'about'
    | 'chevronLeft'
    | 'chevronRight'
    | 'play'

const props = defineProps<{ name: IconName }>()

// Контурные иконки 24×24; размер и цвет задаёт родитель (font-size, color)
const PATHS: Record<IconName, string[]> = {
  brand: ['M7.5 3h9l3 7.5h-15z', 'M12 10.5V20M8 21h8'],
  search: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z', 'M20 20l-3.6-3.6'],
  home: [
    'M3.5 10.5 12 3.5l8.5 7V20a1 1 0 0 1-1 1H15v-6H9v6H4.5a1 1 0 0 1-1-1z',
  ],
  movies: [
    'M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3z',
    'M7.5 3v18M16.5 3v18M3 8h4.5M3 16h4.5M16.5 8H21M16.5 16H21',
  ],
  series: [
    'M4.5 5.5h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z',
    'm8.5 2.5 3.5 3 3.5-3M8 21.5h8',
  ],
  about: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 11v5.5M12 7.5h.01'],
  chevronLeft: ['m15 5-7 7 7 7'],
  chevronRight: ['m9 5 7 7-7 7'],
  play: ['M7 4.5v15l12.5-7.5z'],
}

const filled = computed(() => props.name === 'play')
</script>

<template>
  <svg
    class="icon"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    :stroke="filled ? 'none' : 'currentColor'"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="d in PATHS[name]" :key="d" :d="d" />
  </svg>
</template>

<style scoped>
.icon {
  display: block;
  flex-shrink: 0;
  width: 1em;
  height: 1em;
}
</style>
