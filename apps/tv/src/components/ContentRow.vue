<script setup lang="ts" generic="T">
import type { FocusVia, SectionEdges } from '../focus/index.ts'
import type { TrackMetrics } from '../lib/rowTrack.ts'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useFocus } from '../focus/index.ts'
import {
  ensureVisible,
  maxOffset,
  offsetOnFocus,
  pageOffset,
  renderWindow,
} from '../lib/rowTrack.ts'
import { platform } from '../platform/index.ts'
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
    // Карточка, видимая при открытии ряда, пока в нём не было фокуса
    start?: number
  }>(),
  { title: undefined, edges: undefined, start: 0 },
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
const clip = ref<HTMLElement>()
const view = ref<HTMLElement>()
// В вебе лента прокручивается нативно (тачпад вбок, Shift + колесо), на ТВ — transform
const native = platform === 'web'
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
  transform: native ? undefined : `translateX(${-offset.value}px)`,
  // Карточки вне окна рендера не рисуются: место под них держат отступы,
  // в вебе и справа — иначе нативной прокрутке некуда ехать
  paddingLeft: `${range.value.start * step.value}px`,
  paddingRight: native
    ? `${(props.items.length - range.value.end) * step.value}px`
    : undefined,
}))

function setOffset(value: number) {
  if (!native) {
    offset.value = value

    return
  }

  clip.value?.scrollTo({ left: value, behavior: 'smooth' })
}

function onClipScroll() {
  if (native && clip.value)
    offset.value = clip.value.scrollLeft
}

async function measure() {
  const elements = view.value?.querySelectorAll<HTMLElement>('[data-index]')
  const first = elements?.[0]

  if (!view.value || !elements || !first)
    return

  // Дробные размеры: при --u не целом offsetLeft округляет шаг, и за ряд
  // ошибка копится в упор дальше конца нативной прокрутки
  const firstRect = first.getBoundingClientRect()

  itemWidth.value = firstRect.width
  step.value
    = elements.length > 1
      ? elements[1]!.getBoundingClientRect().left - firstRect.left
      : firstRect.width
  viewWidth.value = view.value.clientWidth

  const next = ensureVisible(
    offset.value,
    focused ?? props.start,
    metrics.value,
  )

  // В вебе ширину прокрутки дают отрисованные карточки: окно рендера сначала
  // встаёт у цели, иначе scrollTo к дальней карточке упёрся бы в край окна
  if (native && next !== offset.value) {
    offset.value = next
    await nextTick()
  }

  setOffset(next)
}

// Карточка под фокусом ушла из окна рендера (ряд пролистали стрелкой): её больше нет в DOM
watch(range, ({ start, end }) => {
  if (focused !== undefined && (focused < start || focused >= end))
    focused = undefined
})

function page(direction: 1 | -1) {
  setOffset(pageOffset(offset.value, direction, metrics.value))
}

const stopFocus = focus.onFocus((el, via) => {
  if (!root.value?.contains(el)) {
    focused = undefined

    return
  }

  // Фокусируется сама карточка, а позицию в ряду знает её обёртка
  const index = Number(el.closest<HTMLElement>('[data-index]')?.dataset.index)

  const next = offsetOnFocus(offset.value, index, via, metrics.value, focused)

  if (next !== offset.value)
    setOffset(next)
  focused = index
  emit('focusItem', index, via)
})

onMounted(() => {
  measure()
  window.addEventListener('resize', measure)
})

// Вернувшийся из KeepAlive экран: нативная прокрутка ленты сбросилась
onActivated(() => {
  if (native && clip.value)
    clip.value.scrollLeft = offset.value
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
    <div class="row__frame">
      <div
        ref="clip"
        class="row__clip"
        :class="{ 'row__clip--native': native }"
        @scroll="onClipScroll"
      >
        <div ref="view" class="row__view">
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
        </div>
      </div>
      <!--
        Стрелки листания видны только под указкой; фокус они не забирают. Вне
        ленты: в вебе она прокручивается нативно и увезла бы их с собой
      -->
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
      <button
        v-if="offset < max - 1"
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
 * Обрезка ленты: слева остаётся полоска 48 px предыдущей карточки (она шире
 * запаса под кольцо фокуса), сверху и снизу — запас под кольцо, справа лента
 * идёт до края экрана. overflow, а не clip-path: clip-path над лентой на своём
 * слое GPU ТВ рисует маской, и это роняло кадры при листании рядов.
 */
.row__clip {
  margin: calc(var(--focus-ring-gap) * -1) 0 calc(var(--focus-ring-gap) * -1) calc(var(--u) * -48);
  padding: var(--focus-ring-gap) 0 var(--focus-ring-gap) calc(var(--u) * 48);
  overflow: hidden;
}

/* Ряд со стрелками: стрелки стоят над лентой, а не в ней */
.row__frame {
  position: relative;
}

/* Веб: лента прокручивается нативно по горизонтали, вертикаль уходит странице */
.row__clip--native {
  overflow-x: auto;
  overflow-y: hidden;
}

.row__clip--native::-webkit-scrollbar {
  display: none;
}

/*
 * Поле .row__view справа нативная прокрутка не считает, и в конце ряда последняя
 * карточка уезжала к краю экрана, срезая кольцо фокуса. Распорка ставит её у
 * safe area, как упор на ТВ (поле последней карточки уже есть, распорка — остаток)
 */
.row__clip--native .row__track::after {
  content: '';
  flex: none;
  width: calc(var(--safe-x) - var(--u) * 28);
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
  background: none;
  color: var(--color-text);
  font-size: calc(var(--u) * 48);
}

.row__page:hover {
  color: var(--color-accent);
}

/*
 * Кнопка ловит клик только за краем ряда: на полоске предыдущей карточки слева
 * и в поле у края экрана справа. Карточки, видные целиком, под стрелку не
 * попадают. Стрелки стоят зеркально, в 24 px макета за краем ряда
 */
.row__page--back {
  left: calc(var(--u) * -48);
  width: calc(var(--u) * 48);
}

.row__page--forward {
  right: 0;
  width: var(--safe-x);
  justify-content: flex-start;
}

/*
 * Затемнение под стрелкой шире кнопки и уходит в прозрачность по обеим осям:
 * обрыв поверх карточки читался полосой, а прямой верхний и нижний край —
 * чертой на бэкдропе. Вертикальный спад делает маска, поэтому затемнение —
 * отдельный слой. Маска лежит на статичном слое и при листании не перерисовывается
 */
.row__page::before {
  content: '';
  position: absolute;
  z-index: -1;
  top: calc(var(--u) * -80);
  bottom: calc(var(--u) * -80);
  pointer-events: none;
  -webkit-mask-image: linear-gradient(
    rgba(0, 0, 0, 0),
    #000 calc(var(--u) * 70),
    #000 calc(100% - var(--u) * 70),
    rgba(0, 0, 0, 0)
  );
}

/*
 * Слева лента обрезана не краем экрана, а у рейла. Затемнение идёт от края
 * экрана и до края ленты держит ту же плотность, что справа у края экрана:
 * иначе виден зазор без затемнения и черта среза карточки. Дальше, как и
 * справа, без глухой полосы: карточка под стрелкой просвечивает
 */
.row__page--back::before {
  right: calc(var(--u) * -120);
  left: calc(var(--u) * 48 - var(--content-x));
  background: linear-gradient(
    90deg,
    rgba(11, 13, 18, 0.9) calc(var(--content-x) - var(--u) * 48),
    rgba(11, 13, 18, 0.55) calc(var(--content-x) + var(--u) * 24),
    rgba(11, 13, 18, 0)
  );
}

.row__page--forward::before {
  right: 0;
  left: calc(var(--u) * -120);
  background: linear-gradient(270deg, rgba(11, 13, 18, 0.9), rgba(11, 13, 18, 0.55) 45%, rgba(11, 13, 18, 0));
}

[data-input='pointer'] .row__frame:hover .row__page {
  display: flex;
}
</style>
