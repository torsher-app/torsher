<script setup lang="ts">
import type { Card, HomeRow } from '@torsher/api-client'
import type { ComponentPublicInstance } from 'vue'
import type { RailItemId } from '../components/AppRail.vue'
import type { HomeMode } from '../composables/useHome.ts'
import type { FocusVia, SectionEdges } from '../focus/index.ts'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppRail from '../components/AppRail.vue'
import BackdropLayer from '../components/BackdropLayer.vue'
import ContentRow from '../components/ContentRow.vue'
import FocusSection from '../components/FocusSection.vue'
import HeroPanel from '../components/HeroPanel.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import { useHero } from '../composables/useHero.ts'
import { useHome } from '../composables/useHome.ts'
import { useFocus } from '../focus/index.ts'
import { firstVisibleRow, stackOffset } from '../lib/rowStack.ts'

defineOptions({ name: 'HomePage' })

const props = defineProps<{ mode: HomeMode }>()

const RAIL_ITEM: Record<HomeMode, RailItemId> = {
  all: 'home',
  movies: 'movies',
  series: 'series',
}
const SKELETON_ROWS = 2
const SKELETON_CARDS = 7

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const { status, rows, error, retry } = useHome(computed(() => props.mode))
const { hero, show } = useHero()

const railItem = computed(() => RAIL_ITEM[props.mode])
const railSection = computed(() => `rail-${railItem.value}`)

// Ряд, под который выставлен экран: меняется от пульта и колеса, не от наведения
const aligned = ref(0)
const rowsOffset = ref(0)
const firstVisible = ref(0)
const rowsElement = ref<HTMLElement>()
const lastSection = ref<string>()
const rowElements: (HTMLElement | undefined)[] = []

function sectionOf(row: HomeRow) {
  return `home-${props.mode}-${row.id}`
}

function edgesOf(index: number): SectionEdges {
  const above = rows.value[index - 1]
  const below = rows.value[index + 1]

  return {
    left: railSection.value,
    up: above && sectionOf(above),
    down: below && sectionOf(below),
  }
}

// Картинки держат только ряды рядом с фокусным: остальные их не грузят
function isNear(index: number) {
  return index >= aligned.value - 1 && index <= aligned.value + 2
}

function setRowElement(index: number) {
  return (instance: Element | ComponentPublicInstance | null) => {
    rowElements[index] = (instance as ComponentPublicInstance | null)?.$el
  }
}

const content = computed(() => {
  if (status.value === 'error' || rows.value.length === 0)
    return 'home-state'

  return lastSection.value ?? sectionOf(rows.value[0]!)
})

function alignRows() {
  const container = rowsElement.value
  const target = rowElements[aligned.value]

  if (!container || !target) {
    rowsOffset.value = 0
    firstVisible.value = 0

    return
  }

  const tops = rows.value.map((_, index) => rowElements[index]?.offsetTop ?? 0)

  rowsOffset.value = stackOffset(
    target.offsetTop,
    container.offsetHeight,
    window.innerHeight - container.offsetTop,
  )
  firstVisible.value = firstVisibleRow(tops, rowsOffset.value)
}

function onFocusItem(rowIndex: number, index: number, via: FocusVia) {
  const row = rows.value[rowIndex]!

  lastSection.value = sectionOf(row)

  // Наведение не сдвигает экран; пульт и колесо ставят ряд на место фокусного
  if (via !== 'pointer')
    aligned.value = rowIndex

  show(row.items[index]!, via)
}

function open(card: Card) {
  router.push(`/title/${card.id}`)
}

// Экран в KeepAlive: ряды могут прийти, когда пользователь уже ушёл на другой экран
let isActive = false

function restoreFocus() {
  if (isActive)
    focus.activate(content.value)
}

watch(aligned, alignRows)

// Новые ряды: экран встаёт на первый, фокус — в первый ряд
watch(rows, async () => {
  aligned.value = 0
  lastSection.value = undefined
  await nextTick()
  alignRows()
  restoreFocus()
})

// Возврат из карточки: фокус на ту карточку, с которой ушли
onActivated(() => {
  isActive = true
  restoreFocus()
})

onDeactivated(() => {
  isActive = false
})

// Колесо листает ряды от того, что на экране, а не от карточки под курсором,
// и не трогает ленты по горизонтали — куда бы ни указывал фокус (рейл, ряд ниже)
const stopWheel = focus.onWheel((direction) => {
  if (!isActive || rows.value.length === 0)
    return false

  if (direction !== 'up' && direction !== 'down')
    return true

  const row = rows.value[aligned.value + (direction === 'down' ? 1 : -1)]

  // Карточка в той же колонке: под неподвижным курсором, а не запомненная рядом
  if (row)
    focus.activate(sectionOf(row), 'wheel', focus.current())

  return true
})

onMounted(() => window.addEventListener('resize', alignRows))
onBeforeUnmount(() => {
  stopWheel()
  window.removeEventListener('resize', alignRows)
})
</script>

<template>
  <main class="home">
    <BackdropLayer :src="hero?.details?.backdrop" />

    <div class="home__hero">
      <HeroPanel v-if="hero" :hero="hero" />
    </div>

    <div v-if="status === 'error' && error" class="home__state">
      <FocusSection name="home-state" :edges="{ left: railSection }" autofocus>
        <ScreenState :kind="error" @retry="retry" />
      </FocusSection>
    </div>

    <div
      v-else-if="rows.length > 0"
      ref="rowsElement"
      class="home__rows"
      :style="{ transform: `translateY(${-rowsOffset}px)` }"
    >
      <ContentRow
        v-for="(row, index) in rows"
        :key="row.id"
        :ref="setRowElement(index)"
        :class="{ 'home__row--above': index < firstVisible }"
        :section="sectionOf(row)"
        :title="t(row.title)"
        :kind="row.kind"
        :items="row.items"
        :edges="edgesOf(index)"
        :load-images="isNear(index)"
        @focus-item="(item, via) => onFocusItem(index, item, via)"
        @select="open"
      />
    </div>

    <div v-else-if="status === 'ready'" class="home__state">
      <FocusSection name="home-state" :edges="{ left: railSection }" autofocus>
        <ScreenState kind="homeEmpty" @retry="retry" />
      </FocusSection>
    </div>

    <div v-else class="home__rows" aria-hidden="true">
      <div v-for="row in SKELETON_ROWS" :key="row" class="home__skeleton-row">
        <span class="home__skeleton-title skeleton" />
        <div class="home__skeleton-track">
          <PosterSkeleton
            v-for="card in SKELETON_CARDS"
            :key="card"
            :caption="false"
          />
        </div>
      </div>
    </div>

    <AppRail :current="railItem" :section="railSection" :content="content" />
  </main>
</template>

<style scoped>
.home {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

.home__hero {
  position: absolute;
  z-index: 5;
  top: calc(var(--u) * 84);
  left: var(--content-x);
}

.home__state {
  position: absolute;
  z-index: 5;
  top: calc(var(--u) * 618);
  left: var(--content-x);
}

/* Фокусный ряд встаёт наверх области (с упором в конце), ряды под hero гаснут */
.home__rows {
  position: absolute;
  z-index: 4;
  top: calc(var(--u) * 618);
  right: 0;
  left: 0;
  transition: transform var(--motion-base) var(--motion-easing);
}

.home__row--above {
  opacity: 0;
  pointer-events: none;
}

.home__skeleton-row {
  margin-bottom: calc(var(--u) * 52);
  padding-left: var(--content-x);
}

.home__skeleton-title {
  display: block;
  width: calc(var(--u) * 320);
  height: var(--font-size-m);
  margin-bottom: calc(var(--u) * 18);
  border-radius: var(--radius-s);
}

.home__skeleton-track {
  display: flex;
  overflow: hidden;
}

.home__skeleton-track > * {
  margin-right: calc(var(--u) * 28);
}
</style>
