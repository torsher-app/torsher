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
    | 'chevronDown'
    | 'play'
    | 'pause'
    | 'fromStart'
    | 'recent'
    | 'download'
    | 'audio'
    | 'subtitles'
    | 'check'
    | 'close'
    | 'lock'
    | 'list'
    | 'settings'
    | 'mine'
    | 'plus'
    | 'star'
    | 'more'
    | 'source'
    | 'next'

const props = defineProps<{ name: IconName }>()

// Путь со своей толщиной линии или залитый, как шнурок и бусина у знака
interface IconPart {
  d: string
  width?: number
  fill?: boolean
}

// Контурные иконки 24×24; размер и цвет задаёт родитель (font-size, color)
const PATHS: Record<IconName, (string | IconPart)[]> = {
  // Та же геометрия, что у AppLoader. Шнурок первым: его кончик прячется под
  // кромку абажура. Ножка доходит до середины площадки, иначе на тонкой линии
  // они расходятся
  brand: [
    { d: 'M17 11.4v3.2', width: 1 },
    { d: 'M17 14.45a1.05 1.05 0 1 0 0 2.1a1.05 1.05 0 1 0 0-2.1z', fill: true },
    'M7.5 3h9l3 7.5h-15z',
    'M12 10.5V21M8 21h8',
  ],
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
  chevronDown: ['m6 9 6 6 6-6'],
  recent: [
    'M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5',
    'M3.5 3.5v5h5M12 7.5V12l3 2',
  ],
  play: ['M7 4.5v15l12.5-7.5z'],
  pause: ['M6.5 4.5h4v15h-4z', 'M13.5 4.5h4v15h-4z'],
  fromStart: ['M6.5 5v14', { d: 'M18.5 5.5v13L9 12z', fill: true }],
  download: ['M12 4.5v14M6 12.5l6 6 6-6'],
  audio: ['M4 14.5v-5M8 18V6M12 21V3M16 18V6M20 14.5v-5'],
  subtitles: [
    'M5.5 5h13A2.5 2.5 0 0 1 21 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5v-9A2.5 2.5 0 0 1 5.5 5z',
    'M10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6',
  ],
  check: ['m5 12.5 4.5 4.5L19 7.5'],
  close: ['M6.5 6.5l11 11', 'M17.5 6.5l-11 11'],
  mine: ['M7 3.5h10a1 1 0 0 1 1 1V21l-6-4-6 4V4.5a1 1 0 0 1 1-1z'],
  plus: ['M12 5v14M5 12h14'],
  star: [
    'm12 3.5 2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.8l-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
  ],
  more: [
    { d: 'M6 12h.01', width: 3.2 },
    { d: 'M12 12h.01', width: 3.2 },
    { d: 'M18 12h.01', width: 3.2 },
  ],
  lock: [
    'M6 11h12a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18 21H6a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 6 11z',
    'M8 11V7.5a4 4 0 0 1 8 0V11',
  ],
  source: ['M4 8h14l-3.5-3.5', 'M20 16H6l3.5 3.5'],
  next: [{ d: 'M5 5v14l10-7z', fill: true }, 'M19 5v14'],
  list: ['M9 6.5h11M9 12h11M9 17.5h11', 'M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01'],
  // Шестерёнка: кольцо, восемь зубцов и отверстие
  settings: [
    'M12 5.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z',
    'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    { d: 'M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3', width: 3 },
    {
      d: 'M5.28 5.28l2.12 2.12M16.6 16.6l2.12 2.12M5.28 18.72l2.12-2.12M16.6 7.4l2.12-2.12',
      width: 3,
    },
  ],
}

const filled = computed(() => props.name === 'play' || props.name === 'pause')

const parts = computed<IconPart[]>(() =>
  PATHS[props.name].map(part =>
    typeof part === 'string' ? { d: part } : part,
  ),
)
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
    <path
      v-for="part in parts"
      :key="part.d"
      :d="part.d"
      :stroke-width="part.width"
      :fill="part.fill ? 'currentColor' : undefined"
      :stroke="part.fill ? 'none' : undefined"
    />
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
