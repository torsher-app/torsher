<script setup lang="ts">
import type { ScheduleItem, ScheduleResponse } from '@torsher/api-client'
import type { GridRow } from '../lib/homeVideo.ts'
import type { LoadError } from '../lib/loadError.ts'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { useFocus } from '../focus/index.ts'
import { libraryRoute, resolveRoute } from '../lib/continue.ts'
import type { ScheduleTab } from '../lib/follow.ts'
import { relativeDay, scheduleDays } from '../lib/follow.ts'
import { anchorSpan } from '../lib/gridWindow.ts'
import { gridRows, rowAtOffset, rowWindow } from '../lib/homeVideo.ts'
import { stackOffset } from '../lib/rowStack.ts'
import { formatAirDate, isUpcoming } from '../lib/titleInfo.ts'
import { lacksSources } from '../serverSources.ts'
import FocusSection from './FocusSection.vue'
import ScheduleCard from './ScheduleCard.vue'
import ScreenState from './ScreenState.vue'

/**
 * «Расписание» в «Моё»: чипы «Ближайшие» / «Недавние» и сетка 3 × 16:9 с
 * заголовками дней. В DOM — окно строк вокруг фокуса, как в «Домашнем видео».
 * OK на вышедшей серии — плеер (с диска, если серия в библиотеке), на
 * будущей — карточка тайтла.
 */
const props = defineProps<{
  schedule?: ScheduleResponse
  loading: boolean
  error?: LoadError
}>()

const emit = defineEmits<{ retry: [] }>()

// Выбранный список живёт в «Моё»: по нему решается, куда шагнуть из разделов
const tab = defineModel<ScheduleTab>('tab', { required: true })

const SECTIONS = 'mine-sections'
const COLUMNS = 3
const ROWS_BEFORE = 3
const ROWS_AFTER = 5
// Строка с фокусом встаёт под верх окна с этим отступом (пиксели макета)
const ROW_GAP = 110
const SKELETON_COUNT = 3

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const locale = useCatalogLanguage()

const items = computed(() => props.schedule?.[tab.value] ?? [])
const isEmpty = computed(
  () => !!props.schedule && !props.loading && items.value.length === 0,
)

function dayLabel(date: string) {
  const day = relativeDay(date)

  return day ? t(`mine.schedule.${day}`) : formatAirDate(date, locale.value)
}

const rows = computed<GridRow<ScheduleItem>[]>(() =>
  gridRows(
    scheduleDays(items.value).map(day => ({
      key: day.date,
      label: dayLabel(day.date),
      items: day.items,
    })),
    COLUMNS,
  ),
)

const gridRoot = ref<HTMLElement>()
const viewport = ref<HTMLElement>()
const column = ref<HTMLElement>()
const {
  native: nativeScroll,
  offset: columnOffset,
  followsFocus,
  alignTo: scrollGridTo,
  onScroll: onColumnScroll,
  onWheel: onScheduleWheel,
  transform: columnTransform,
} = useStackScroll(column)

const focusedRow = ref(0)
const heights = ref({ header: 0, cards: 0 })
const kinds = computed(() => rows.value.map(row => row.kind))
// В вебе колонку листают колесом мимо фокуса: окно держит верхнюю видимую строку
const anchors = computed(() =>
  nativeScroll
    ? anchorSpan(
        rowAtOffset(kinds.value, columnOffset.value, heights.value),
        focusedRow.value,
        followsFocus.value,
      )
    : { first: focusedRow.value, last: focusedRow.value },
)
// Пока высоты строк не измерены, окна нет: убранные строки нечем заменить
const windowed = computed(() =>
  heights.value.cards
    ? rowWindow(
        kinds.value,
        anchors.value,
        ROWS_BEFORE,
        ROWS_AFTER,
        heights.value,
      )
    : { from: 0, to: rows.value.length, top: 0, bottom: 0 },
)
const visibleRows = computed(() =>
  rows.value.slice(windowed.value.from, windowed.value.to),
)

function itemKey(item: ScheduleItem) {
  return `${item.titleId}:${item.season}:${item.episode}`
}

// Высоты строк — по DOM: размеры заданы в единицах макета
function measure() {
  const root = gridRoot.value

  if (!root)
    return

  const step = (selector: string) => {
    const el = root.querySelector<HTMLElement>(selector)

    if (!el)
      return 0

    const style = getComputedStyle(el)

    return (
      el.offsetHeight
      + Number.parseFloat(style.marginTop)
      + Number.parseFloat(style.marginBottom)
    )
  }

  heights.value = {
    header: step('.schedule__day') || heights.value.header,
    cards: step('.schedule__row') || heights.value.cards,
  }
}

watch(rows, async () => {
  await nextTick()
  measure()
})

function alignTo(el: HTMLElement) {
  if (!column.value || !viewport.value)
    return

  followsFocus.value = true

  const gap = (window.innerWidth / 1920) * ROW_GAP
  const card = el.closest<HTMLElement>('.card') ?? el
  // Первая строка дня — вместе с его заголовком
  const top = Math.max(0, card.offsetTop - gap)

  scrollGridTo(
    nativeScroll
      ? stackOffset(top, column.value.scrollHeight, column.value.clientHeight)
      : stackOffset(
          top,
          column.value.offsetHeight,
          viewport.value.clientHeight,
        ),
  )
}

const stopFocus = focus.onFocus((el, via) => {
  if (!gridRoot.value?.contains(el))
    return

  const row = Number(el.closest<HTMLElement>('[data-row]')?.dataset.row)

  if (Number.isFinite(row))
    focusedRow.value = row

  if (via !== 'pointer')
    alignTo(el)
})

// Фокус на вкладках: окну строк держать его не нужно
watch(tab, () => {
  focusedRow.value = 0
  followsFocus.value = false
  scrollGridTo(0)
})

// Ещё не вышла или без источников её не найти и не скачать — карточка тайтла
function open(item: ScheduleItem) {
  if (isUpcoming(item.airDate) || (!item.mediaFileId && lacksSources())) {
    router.push(`/title/${item.titleId}`)
    return
  }

  router.push(
    item.mediaFileId
      ? libraryRoute(item.mediaFileId, {
          id: item.titleId,
          season: item.season,
          episode: item.episode,
        })
      : resolveRoute(item.titleId, item.season, item.episode),
  )
}

// Расписание приходит вместе с «Моё», часто раньше показа раздела: строки
// уже есть, и меряем их сразу
onMounted(() => {
  window.addEventListener('resize', measure)
  nextTick(measure)
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', measure)
  stopFocus()
})
</script>

<template>
  <div class="schedule" @wheel.passive="onScheduleWheel">
    <div class="schedule__head">
      <h2 class="schedule__title">
        {{ t("mine.sections.schedule") }}
        <span v-if="schedule" class="schedule__total">{{ items.length }}</span>
      </h2>
      <FocusSection
        name="mine-schedule-tabs"
        class="schedule__tabs"
        manual-scroll
        :edges="{ left: SECTIONS, down: 'mine-schedule' }"
      >
        <button
          v-for="item in ['upcoming', 'recent'] as const"
          :key="item"
          v-focusable
          class="chip"
          :class="{ 'chip--selected': tab === item }"
          type="button"
          :aria-pressed="tab === item"
          @click="tab = item"
        >
          {{ t(`mine.schedule.${item}`) }}
        </button>
      </FocusSection>
    </div>

    <div ref="viewport" class="schedule__viewport">
      <div
        ref="column"
        class="schedule__column"
        :class="{ 'schedule__column--native': nativeScroll }"
        :style="{ transform: columnTransform }"
        @scroll="onColumnScroll"
      >
        <div ref="gridRoot">
          <FocusSection
            name="mine-schedule"
            manual-scroll
            :edges="{ left: SECTIONS, up: 'mine-schedule-tabs' }"
          >
            <ScreenState v-if="error" :kind="error" @retry="emit('retry')" />
            <div v-else-if="!schedule" class="schedule__row" aria-hidden="true">
              <span
                v-for="index in SKELETON_COUNT"
                :key="index"
                class="schedule__skeleton skeleton"
              />
            </div>
            <div v-else-if="isEmpty" class="schedule__empty">
              <p class="schedule__empty-title">
                {{ t(`mine.schedule.empty.${tab}.title`) }}
              </p>
              <p class="schedule__empty-text">
                {{ t(`mine.schedule.empty.${tab}.text`) }}
              </p>
            </div>
            <!-- Окно строк: в DOM только строки вокруг фокуса, место остальных
                 держат отступы -->
            <div
              v-else
              :style="{
                paddingTop: `${windowed.top}px`,
                paddingBottom: `${windowed.bottom}px`,
              }"
            >
              <template v-for="(row, offset) in visibleRows" :key="row.key">
                <h3
                  v-if="row.kind === 'header'"
                  class="schedule__day"
                  :data-row="windowed.from + offset"
                >
                  {{ row.label }}
                </h3>
                <div
                  v-else
                  class="schedule__row"
                  :data-row="windowed.from + offset"
                >
                  <ScheduleCard
                    v-for="item in row.items"
                    :key="itemKey(item)"
                    :item="item"
                    @select="open(item)"
                  />
                </div>
              </template>
            </div>
          </FocusSection>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.schedule {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: calc(var(--u) * 760);
}

.schedule__head {
  position: absolute;
  top: calc(var(--u) * 90);
  right: 0;
  left: 0;
}

.schedule__title {
  display: flex;
  align-items: baseline;
  height: calc(var(--font-size-l) * var(--line-height));
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-l);
  font-weight: 700;
  white-space: nowrap;
}

.schedule__total {
  margin-left: calc(var(--u) * 16);
  color: var(--color-text-dim);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.schedule__tabs {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  margin-top: calc(var(--u) * 20);
  padding: calc(var(--u) * 6) 0;
}

/* Сетка уезжает под шапку: окно обрезает её по верху, без clip-path; запас
   окна слева и сверху — кольцу фокуса */
.schedule__viewport {
  position: absolute;
  top: calc(var(--u) * 294 - var(--focus-ring-gap));
  right: 0;
  bottom: 0;
  left: calc(var(--focus-ring-gap) * -1);
  overflow: hidden;
}

.schedule__column {
  padding: var(--focus-ring-gap) 0 calc(var(--u) * 160) var(--focus-ring-gap);
  transition: transform var(--motion-base) var(--motion-easing);
}

/* Веб: сетка прокручивается нативно */
.schedule__column--native {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow-y: auto;
  transition: none;
}

.schedule__column--native::-webkit-scrollbar {
  display: none;
}

/* Отступы карточек — margin: gap у flexbox появился только в Chromium 84 */
.schedule__row {
  display: flex;
  margin-bottom: calc(var(--u) * 36);
}

.schedule__row > * {
  margin-right: calc(var(--u) * 36);
}

/* Без верхнего поля: оно схлопнулось бы с полем ряда выше, и шаг строк в окне
   разошёлся бы с измеренным */
.schedule__day {
  height: calc(var(--font-size-m) * var(--line-height));
  margin: 0 0 calc(var(--u) * 20);
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  font-weight: 600;
}

/* Скелетон в размер карточки: кадр 16:9 и две строки подписи */
.schedule__skeleton {
  display: block;
  width: calc(var(--u) * 330);
  height: calc(var(--u) * (330 * 0.5625 + 14) + var(--font-size-s) * var(--line-height) * 2);
  border-radius: var(--radius-m);
}

.schedule__empty {
  max-width: calc(var(--u) * 900);
}

.schedule__empty-title {
  margin: 0 0 calc(var(--u) * 12);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.schedule__empty-text {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.45;
}
</style>
