<script setup lang="ts">
import type { Card, MineSection } from '@torsher/api-client'
import type { PanelOption } from '../components/OptionsPanel.vue'
import type { MineView } from '../lib/mineView.ts'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AppRail from '../components/AppRail.vue'
import FocusSection from '../components/FocusSection.vue'
import OptionsPanel from '../components/OptionsPanel.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useMineItems, useMineSections } from '../composables/useMine.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { useFocus } from '../focus/index.ts'
import {
  DEFAULT_MINE_VIEW,
  gridWindow,
  isFiltered,
  loadMineView,
  MINE_KINDS,
  MINE_RATINGS,
  MINE_SORTS,
  ratingKey,
  saveMineView,
  sectionKey,
} from '../lib/mineView.ts'
import { stackOffset } from '../lib/rowStack.ts'
import { titleActions } from '../titleActions.ts'

defineOptions({ name: 'MinePage' })

const RAIL_SECTION = 'rail-mine'
const COLUMNS = 4
const SKELETON_COUNT = 8
// Пролёт пультом по разделам не грузит каждый: ждём, пока фокус остановится
const SECTION_DELAY_MS = 200
// Строка с фокусом встаёт под верх сетки с этим отступом (пиксели макета)
const ROW_GAP = 40
// Окно строк в DOM вокруг фокусной и запас до конца, с которого дочитываем
const ROWS_BEFORE = 3
const ROWS_AFTER = 5
const PREFETCH = 8

type Control = 'sort' | 'kind' | 'rating'

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()

const {
  status: sectionsStatus,
  sections,
  error: sectionsError,
  retry: retrySections,
  refresh: refreshSections,
} = useMineSections()

const selectedKey = ref('continue')
const selected = computed(() =>
  sections.value.find(item => sectionKey(item) === selectedKey.value),
)
const view = shallowRef<MineView>(loadMineView(selectedKey.value))

const { status, items, total, error, retry, more, refresh } = useMineItems(
  selected,
  view,
)

// Шапка, сетка и счётчик меняются вместе, когда пришли карточки нового раздела
const shownKey = ref<string>()
const shown = computed(() =>
  sections.value.find(item => sectionKey(item) === shownKey.value),
)

// Скелетон — только пока показать нечего; есть прежние карточки — они
// остаются на экране и приглушаются, если загрузка затянулась
const showSkeleton = useHeldLoading(
  () => status.value === 'loading' && items.value.length === 0,
)
const stale = useHeldLoading(
  () => status.value === 'loading' && items.value.length > 0,
)

// Шапка ждёт и удержания скелетона. Пустой раздел готов без загрузки, и статус
// не меняется: следим и за ключом. После рендера — когда загрузка нового
// раздела уже началась
watch(
  [status, selectedKey, showSkeleton],
  ([value, , skeleton]) => {
    if (value !== 'loading' && !skeleton)
      shownKey.value = selectedKey.value
  },
  { flush: 'post' },
)

function sectionLabel(section: MineSection) {
  return section.id === 'collection'
    ? (section.name ?? '')
    : t(`mine.sections.${section.id}`)
}

// Подборки — отдельной группой между «Избранным» и «Просмотрено»
const groups = computed(() => {
  const own = sections.value.filter(item => item.id !== 'collection')
  const collections = sections.value.filter(item => item.id === 'collection')
  const split = own.findIndex(item => item.id === 'watched')

  return {
    before: split < 0 ? own : own.slice(0, split),
    collections,
    after: split < 0 ? [] : own.slice(split),
  }
})

function select(key: string) {
  if (key === selectedKey.value)
    return

  selectedKey.value = key
  view.value = loadMineView(key)
}

let selectTimer = 0

const root = ref<HTMLElement>()
const sectionsRoot = ref<HTMLElement>()
const gridRoot = ref<HTMLElement>()
const focusedIndex = ref(0)

const stopFocus = focus.onFocus((el, via) => {
  const key = el.dataset.section

  if (key && sectionsRoot.value?.contains(el) && via !== 'pointer') {
    clearTimeout(selectTimer)
    selectTimer = window.setTimeout(select, SECTION_DELAY_MS, key)

    return
  }

  if (!gridRoot.value?.contains(el))
    return

  const index = Number(el.closest<HTMLElement>('[data-index]')?.dataset.index)

  if (Number.isFinite(index)) {
    focusedIndex.value = index

    if (index >= items.value.length - PREFETCH)
      void more()
  }

  if (via !== 'pointer')
    alignTo(el)
})

const viewport = ref<HTMLElement>()
const column = ref<HTMLElement>()
const {
  native: nativeScroll,
  alignTo: scrollGridTo,
  onScroll: onColumnScroll,
  transform: columnTransform,
} = useStackScroll(column)

// Новый раздел или вид: сетка с начала
watch([selectedKey, view], () => {
  focusedIndex.value = 0
  scrollGridTo(0)
})

// Окно карточек в DOM: длинное «Просмотрено» не раздувает дерево на ТВ
const rowStep = ref(0)
const windowed = computed(() =>
  rowStep.value
    ? gridWindow(
        focusedIndex.value,
        items.value.length,
        COLUMNS,
        ROWS_BEFORE,
        ROWS_AFTER,
      )
    : { from: 0, to: items.value.length },
)
const visible = computed(() =>
  items.value
    .slice(windowed.value.from, windowed.value.to)
    .map((item, offset) => ({ item, index: windowed.value.from + offset })),
)
const gridPadding = computed(() => {
  const rows = (count: number) => Math.ceil(count / COLUMNS)

  return {
    paddingTop: `${(windowed.value.from / COLUMNS) * rowStep.value}px`,
    paddingBottom: `${(rows(items.value.length) - rows(windowed.value.to)) * rowStep.value}px`,
  }
})

// Шаг строки сетки меряется по DOM: размеры карточки заданы токенами
watch(items, async () => {
  await nextTick()

  const cards = gridRoot.value?.querySelectorAll<HTMLElement>('[data-index]')

  if (cards && cards.length > COLUMNS)
    rowStep.value = cards[COLUMNS].offsetTop - cards[0].offsetTop
})

function alignTo(el: HTMLElement) {
  if (!column.value || !viewport.value)
    return

  const gap = (window.innerWidth / 1920) * ROW_GAP
  const card = el.closest<HTMLElement>('[data-index]') ?? el
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

// Чипы вида и правая панель выбора
const panel = ref<Control>()
let panelOpener: HTMLElement | undefined

const controls = computed(() => [
  { id: 'sort' as const, label: t(`mine.sort.${view.value.sort}`) },
  { id: 'kind' as const, label: t(`mine.kind.${view.value.kind}`) },
  {
    id: 'rating' as const,
    label: t(`mine.rating.${ratingKey(view.value.rating)}`),
  },
])

const panelOptions = computed<PanelOption[]>(() => {
  switch (panel.value) {
    case 'sort':
      return MINE_SORTS.map(id => ({
        id,
        label: t(`mine.sort.${id}`),
        selected: id === view.value.sort,
      }))
    case 'kind':
      return MINE_KINDS.map(id => ({
        id,
        label: t(`mine.kind.${id}`),
        selected: id === view.value.kind,
      }))
    case 'rating':
      return MINE_RATINGS.map(id => ({
        id,
        label: t(`mine.rating.${ratingKey(id)}`),
        selected: id === view.value.rating,
      }))
    default:
      return []
  }
})

function setView(next: MineView) {
  view.value = next
  saveMineView(selectedKey.value, next)
}

function openPanel(id: Control) {
  panelOpener = focus.current() ?? undefined
  panel.value = id
}

function closePanel() {
  panel.value = undefined

  nextTick(() => {
    if (panelOpener?.isConnected)
      focus.focusOn(panelOpener)
    else focus.activate('mine-controls')
  })
}

function choose(id: string) {
  if (panel.value)
    setView({ ...view.value, [panel.value]: id })

  closePanel()
}

function resetFilters() {
  setView({ ...DEFAULT_MINE_VIEW, sort: view.value.sort })
  nextTick(() => focus.activate('mine-controls'))
}

const isEmpty = computed(
  () => status.value === 'ready' && items.value.length === 0,
)

const emptyText = computed(() => {
  if (isFiltered(view.value)) {
    return {
      title: t('mine.emptyFiltered.title'),
      text: t('mine.emptyFiltered.text'),
    }
  }

  const id = shown.value?.id ?? 'continue'

  return {
    title: t(`mine.empty.${id}.title`),
    text: t(`mine.empty.${id}.text`),
  }
})

function open(card: Card) {
  router.push(`/title/${card.id}`)
}

// Правки из меню действий: списки перечитываются тихо, на месте
let seenVersion = titleActions.version

function syncChanges() {
  if (seenVersion === titleActions.version)
    return

  seenVersion = titleActions.version
  void refreshSections()
  void refresh()
}

watch(
  () => titleActions.version,
  () => {
    // Меню открыто поверх «Моё»: перечитываем, когда оно закрылось
    if (!titleActions.target)
      syncChanges()
  },
)
watch(
  () => titleActions.target,
  (value) => {
    if (!value)
      syncChanges()
  },
)

// Экран в KeepAlive: разделы могут прийти, когда пользователь уже ушёл дальше
let isActive = false

function focusSelectedSection() {
  const el = sectionsRoot.value?.querySelector<HTMLElement>(
    `[data-section="${selectedKey.value}"]`,
  )

  if (el)
    focus.focusOn(el)
}

// Первый показ: разделы приходят после открытия экрана, autofocus им не достаётся
watch(sectionsStatus, async (value, previous) => {
  if (value !== 'ready' || previous !== 'loading' || !isActive)
    return

  await nextTick()

  if (!root.value?.contains(focus.current() ?? null))
    focusSelectedSection()
})

onActivated(() => {
  isActive = true
  syncChanges()

  if (!focus.activate('mine-grid'))
    focusSelectedSection()
})

onDeactivated(() => {
  isActive = false
})

onBeforeUnmount(() => {
  stopFocus()
  clearTimeout(selectTimer)
})
</script>

<template>
  <main ref="root" class="mine">
    <div class="mine__left">
      <h1 class="mine__heading">
        {{ t("nav.mine") }}
      </h1>
      <ScreenState
        v-if="sectionsStatus === 'error' && sectionsError"
        :kind="sectionsError"
        @retry="retrySections"
      />
      <div v-else ref="sectionsRoot">
        <FocusSection
          name="mine-sections"
          class="mine__sections"
          :edges="{
            left: RAIL_SECTION,
            right: isEmpty ? 'mine-controls' : 'mine-grid',
          }"
          autofocus
        >
          <template
            v-for="group in ['before', 'collections', 'after'] as const"
            :key="group"
          >
            <h2
              v-if="group === 'collections' && groups.collections.length"
              class="mine__label"
            >
              {{ t("mine.collections") }}
            </h2>
            <button
              v-for="section in groups[group]"
              :key="sectionKey(section)"
              v-focusable
              class="mine__section"
              :class="{
                'mine__section--selected': sectionKey(section) === selectedKey,
              }"
              :data-section="sectionKey(section)"
              type="button"
              :aria-pressed="sectionKey(section) === selectedKey"
              @click="select(sectionKey(section))"
            >
              <span class="mine__section-name">{{
                sectionLabel(section)
              }}</span>
              <span class="mine__section-count">{{ section.count }}</span>
            </button>
          </template>
        </FocusSection>
      </div>
    </div>

    <div class="mine__right">
      <div class="mine__head">
        <h2 class="mine__title">
          {{ shown ? sectionLabel(shown) : "" }}
          <span
            v-if="shown && status === 'ready' && !showSkeleton"
            class="mine__total"
          >{{ total }}</span>
        </h2>
        <FocusSection
          name="mine-controls"
          class="mine__controls"
          manual-scroll
          :edges="{ left: 'mine-sections', down: 'mine-grid' }"
        >
          <button
            v-for="control in controls"
            :key="control.id"
            v-focusable
            class="chip"
            type="button"
            @click="openPanel(control.id)"
          >
            {{ control.label }}
          </button>
          <button
            v-if="isFiltered(view)"
            v-focusable
            class="chip mine__reset"
            type="button"
            :aria-label="t('mine.resetFilters')"
            :title="t('mine.resetFilters')"
            @click="resetFilters"
          >
            <AppIcon name="close" />
          </button>
        </FocusSection>
      </div>

      <div ref="viewport" class="mine__viewport">
        <div
          ref="column"
          class="mine__column"
          :class="{ 'mine__column--native': nativeScroll }"
          :style="{ transform: columnTransform }"
          @scroll="onColumnScroll"
        >
          <div ref="gridRoot">
            <FocusSection
              name="mine-grid"
              manual-scroll
              :edges="{ left: 'mine-sections', up: 'mine-controls' }"
            >
              <ScreenState
                v-if="status === 'error' && error && !showSkeleton"
                :kind="error"
                @retry="retry"
              />
              <div
                v-else-if="showSkeleton"
                class="mine__grid"
                aria-hidden="true"
              >
                <PosterSkeleton v-for="index in SKELETON_COUNT" :key="index" />
              </div>
              <div v-else-if="isEmpty" class="mine__empty">
                <p class="mine__empty-title">
                  {{ emptyText.title }}
                </p>
                <p class="mine__empty-text">
                  {{ emptyText.text }}
                </p>
              </div>
              <div
                v-else
                class="mine__grid"
                :class="{ 'mine__grid--stale': stale }"
                :style="gridPadding"
              >
                <div
                  v-for="{ item, index } in visible"
                  :key="item.id"
                  :data-index="index"
                >
                  <PosterCard :card="item" caption @select="open(item)" />
                </div>
              </div>
            </FocusSection>
          </div>
        </div>
      </div>
    </div>

    <AppRail current="mine" :section="RAIL_SECTION" content="mine-sections" />

    <OptionsPanel
      v-if="panel"
      :title="t(`mine.panel.${panel}`)"
      :options="panelOptions"
      @select="choose"
      @close="closePanel"
    />
  </main>
</template>

<style scoped>
.mine {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

.mine__left {
  position: absolute;
  top: calc(var(--u) * 90);
  bottom: 0;
  left: var(--content-x);
  display: flex;
  flex-direction: column;
  width: calc(var(--u) * 480);
}

.mine__heading {
  margin: 0 0 calc(var(--u) * 36);
  font-size: var(--font-size-xl);
  font-weight: 700;
}

/* Разделы прокручиваются нативно: подборок бывает много, движок зовёт scrollIntoView */
.mine__sections {
  flex: 1;
  max-height: calc(var(--u) * 860);
  margin: 0 calc(var(--focus-ring-gap) * -1);
  padding: calc(var(--u) * 8) var(--focus-ring-gap) var(--safe-y);
  overflow-y: auto;
}

.mine__sections::-webkit-scrollbar {
  display: none;
}

.mine__label {
  margin: calc(var(--u) * 24) 0 calc(var(--u) * 12) calc(var(--u) * 22);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* Строка раздела — фокус-язык строк, как недавние запросы поиска */
.mine__section {
  display: flex;
  align-items: center;
  width: 100%;
  height: calc(var(--u) * 64);
  margin-bottom: calc(var(--u) * 4);
  padding: 0 calc(var(--u) * 22);
  border: 0;
  border-radius: calc(var(--u) * 14);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-m);
  text-align: left;
}

.mine__section--selected:not(:focus) {
  background: rgba(242, 244, 248, 0.12);
  color: var(--color-text);
}

.mine__section:focus {
  --bump-scale: var(--focus-scale);

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.mine__section-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.mine__section-count {
  flex-shrink: 0;
  margin-left: calc(var(--u) * 16);
  font-variant-numeric: tabular-nums;
}

.mine__right {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: calc(var(--u) * 760);
}

.mine__head {
  position: absolute;
  top: calc(var(--u) * 90);
  right: 0;
  left: 0;
}

.mine__title {
  display: flex;
  align-items: baseline;
  height: calc(var(--font-size-l) * var(--line-height));
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-l);
  font-weight: 700;
  white-space: nowrap;
}

.mine__total {
  margin-left: calc(var(--u) * 16);
  color: var(--color-text-dim);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.mine__controls {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  margin-top: calc(var(--u) * 20);
  padding: calc(var(--u) * 6) 0;
}

.mine__reset {
  justify-content: center;
  width: calc(var(--u) * 64);
  padding: 0;
  font-size: calc(var(--u) * 30);
}

/* Сетка уезжает под шапку: окно обрезает её по верху, без clip-path; запас
   окна слева и сверху — кольцу фокуса */
.mine__viewport {
  position: absolute;
  top: calc(var(--u) * 294 - var(--focus-ring-gap));
  right: 0;
  bottom: 0;
  left: calc(var(--focus-ring-gap) * -1);
  overflow: hidden;
}

.mine__column {
  padding: var(--focus-ring-gap) 0 calc(var(--u) * 160) var(--focus-ring-gap);
  transition: transform var(--motion-base) var(--motion-easing);
}

/* Веб: сетка прокручивается нативно */
.mine__column--native {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow-y: auto;
  transition: none;
}

.mine__column--native::-webkit-scrollbar {
  display: none;
}

/* grid-gap, а не gap у flex: gap для flexbox появился только в Chromium 84 */
.mine__grid {
  display: grid;
  grid-template-columns: repeat(4, var(--poster-width));
  grid-gap: calc(var(--u) * 36) calc(var(--u) * 34);
  transition: opacity var(--motion-base) var(--motion-easing);
}

/* Долгая смена раздела: прежние карточки приглушены, сетка не пропадает.
   Приглушение — тоже лоадер: проявляется через --loader-delay */
.mine__grid--stale {
  opacity: 0.4;
  transition-delay: var(--loader-delay);
}

.mine__empty {
  max-width: calc(var(--u) * 900);
}

.mine__empty-title {
  margin: 0 0 calc(var(--u) * 12);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.mine__empty-text {
  margin: 0;
  color: var(--color-text-muted);
  line-height: 1.45;
}
</style>
