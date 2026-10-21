<script setup lang="ts" generic="T">
import type { FocusVia, SectionEdges } from '../focus/index.ts'
import type { TrackMetrics } from '../lib/rowTrack.ts'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocus } from '../focus/index.ts'
import {
  ensureVisible,
  maxOffset,
  offsetOnFocus,
  pageOffset,
  renderWindow,
} from '../lib/rowTrack.ts'
import AppIcon from './AppIcon.vue'
import FocusSection from './FocusSection.vue'

/**
 * Лента карточек любого вида: трек, упор, окно рендера и стрелки листания.
 * Карточку рисует слот `item`; у всех карточек ряда одна ширина.
 */
const props = withDefaults(
  defineProps<{
    section: string
    items: T[]
    itemKey: (item: T) => string | number
    title?: string
    edges?: SectionEdges
  }>(),
  { title: undefined, edges: undefined },
)

const emit = defineEmits<{
  focusItem: [index: number, via: FocusVia]
}>()

defineSlots<{
  item: (props: { item: T, index: number }) => unknown
}>()

const { t } = useI18n()
const focus = useFocus()

const root = ref<HTMLElement>()
const view = ref<HTMLElement>()
// Шаг и ширина карточки — в пикселях экрана, меряются по DOM
const step = ref(0)
const itemWidth = ref(0)
const viewWidth = ref(0)
const offset = ref(0)
// Карточка этого ряда под фокусом; undefined — фокус в другом месте
let focused: number | undefined

const metrics = computed<TrackMetrics>(() => ({
  step: step.value,
  itemWidth: itemWidth.value,
  count: props.items.length,
  viewWidth: viewWidth.value,
}))

const range = computed(() => renderWindow(offset.value, metrics.value))
const visible = computed(() =>
  props.items.slice(range.value.start, range.value.end),
)
const max = computed(() => maxOffset(metrics.value))

const trackStyle = computed(() => ({
  transform: `translateX(${-offset.value}px)`,
  // Карточки до окна рендера не рисуются: место под них держит отступ
  paddingLeft: `${range.value.start * step.value}px`,
}))

function measure() {
  const elements = view.value?.querySelectorAll<HTMLElement>('[data-index]')
  const first = elements?.[0]

  if (!view.value || !elements || !first)
    return

  itemWidth.value = first.offsetWidth
  step.value
    = elements.length > 1
      ? elements[1]!.offsetLeft - first.offsetLeft
      : first.offsetWidth
  viewWidth.value = view.value.clientWidth
  offset.value = ensureVisible(offset.value, focused ?? 0, metrics.value)
}

// Карточка под фокусом ушла из окна рендера (ряд пролистали стрелкой): её больше нет в DOM
watch(range, ({ start, end }) => {
  if (focused !== undefined && (focused < start || focused >= end))
    focused = undefined
})

function page(direction: 1 | -1) {
  offset.value = pageOffset(offset.value, direction, metrics.value)
}

const stopFocus = focus.onFocus((el, via) => {
  if (!root.value?.contains(el)) {
    focused = undefined

    return
  }

  // Фокусируется сама карточка, а позицию в ряду знает её обёртка
  const index = Number(el.closest<HTMLElement>('[data-index]')?.dataset.index)

  offset.value = offsetOnFocus(
    offset.value,
    index,
    via,
    metrics.value,
    focused,
  )
  focused = index
  emit('focusItem', index, via)
})

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})

onBeforeUnmount(() => {
  stopFocus()
  window.removeEventListener('resize', measure)
})
</script>

<template>
  <section ref="root" class="row">
    <h2 v-if="title" class="row__title">
      {{ title }}
    </h2>
    <div class="row__clip">
      <div ref="view" class="row__view">
        <!-- Стрелки листания видны только под указкой; фокус они не забирают -->
        <button
          v-if="offset > 0"
          class="row__page row__page--back"
          type="button"
          tabindex="-1"
          :aria-label="t('home.pageBack')"
          @mousedown.prevent
          @click="page(-1)"
        >
          <AppIcon name="chevronLeft" />
        </button>
        <FocusSection
          :name="section"
          :edges="edges"
          manual-scroll
          class="row__track"
          :style="trackStyle"
        >
          <div
            v-for="(item, i) in visible"
            :key="itemKey(item)"
            class="row__item"
            :data-index="range.start + i"
          >
            <slot name="item" :item="item" :index="range.start + i" />
          </div>
        </FocusSection>
        <button
          v-if="offset < max"
          class="row__page row__page--forward"
          type="button"
          tabindex="-1"
          :aria-label="t('home.pageForward')"
          @mousedown.prevent
          @click="page(1)"
        >
          <AppIcon name="chevronRight" />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.row {
  /* Отрицательные отступы обрезки не схлопываются с отступами ряда */
  display: flow-root;
  padding-left: var(--content-x);
  margin-bottom: calc(var(--u) * 52);
  transition: opacity var(--motion-base) var(--motion-easing);
  /*
   * Свой слой: ряд, уходящий под hero, гаснет без перерисовки. Без слоя
   * на ТВ каждая такая анимация перерисовывала ряд и роняла кадры
   */
  will-change: opacity;
}

.row__title {
  margin: 0 0 calc(var(--u) * 18);
  font-size: var(--font-size-m);
  font-weight: 600;
}

/*
 * Обрезка ленты: слева остаётся полоска 48 px предыдущей карточки, сверху
 * и снизу — место под кольцо и масштаб фокуса, справа лента идёт до края
 * экрана. overflow, а не clip-path: clip-path над лентой на своём слое
 * GPU ТВ рисует маской, и это роняло кадры при листании рядов.
 */
.row__clip {
  margin: calc(var(--u) * -40) 0 calc(var(--u) * -40) calc(var(--u) * -48);
  padding: calc(var(--u) * 40) 0 calc(var(--u) * 40) calc(var(--u) * 48);
  overflow: hidden;
}

/* Видимая часть ряда для расчётов — до safe area справа */
.row__view {
  position: relative;
  margin-right: var(--safe-x);
}

/* margin вместо gap: gap у flexbox появился только в Chromium 84 */
.row__track {
  display: flex;
  transition: transform var(--motion-base) var(--motion-easing);
  will-change: transform;
}

.row__item {
  flex-shrink: 0;
  margin-right: calc(var(--u) * 28);
}

.row__page {
  position: absolute;
  z-index: 3;
  top: calc(var(--u) * -10);
  bottom: calc(var(--u) * -10);
  display: none;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  color: var(--color-text);
  font-size: calc(var(--u) * 48);
}

.row__page:hover {
  color: var(--color-accent);
}

.row__page--back {
  left: calc(var(--u) * -48);
  width: calc(var(--u) * 48);
  background: linear-gradient(90deg, var(--color-bg), rgba(11, 13, 18, 0.6));
}

.row__page--forward {
  right: calc(var(--safe-x) * -1);
  width: calc(var(--u) * 120 + var(--safe-x));
  background: linear-gradient(270deg, var(--color-bg) 30%, rgba(11, 13, 18, 0));
}

[data-input='pointer'] .row__view:hover .row__page {
  display: flex;
}
</style>
