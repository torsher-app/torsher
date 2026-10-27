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
import { useRoute, useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AppRail from '../components/AppRail.vue'
import FocusSection from '../components/FocusSection.vue'
import MineSchedule from '../components/MineSchedule.vue'
import OptionsPanel from '../components/OptionsPanel.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import {
  useMineItems,
  useMineSections,
  useSchedule,
} from '../composables/useMine.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { useFocus } from '../focus/index.ts'
import { anchorSpan, rowAt } from '../lib/gridWindow.ts'
import {
  DEFAULT_MINE_VIEW,
  gridWindow,
  isFiltered,
  loadMineView,
  MINE_KINDS,
  MINE_RATINGS,
  MINE_SORTS,
  pageTarget,
  parseMineTarget,
  ratingKey,
  saveMineView,
  sectionKey,
} from '../lib/mineView.ts'
import type { ScheduleTab } from '../lib/follow.ts'
import { stackOffset } from '../lib/rowStack.ts'
import { titleActions } from '../titleActions.ts'

defineOptions({ name: 'MinePage' })

const RAIL_SECTION = 'rail-mine'
// «Расписание» — свой раздел витрины после «Продолжить», без карточек «Моё»
const SCHEDULE = 'schedule'
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
const route = useRoute()
const router = useRouter()
const focus = useFocus()

const {
  status: sectionsStatus,
  sections,
  error: sectionsError,
  retry: retrySections,
  refresh: refreshSections,
} = useMineSections()

const {
  schedule,
  status: scheduleStatus,
  error: scheduleError,
  retry: retrySchedule,
  refresh: refreshSchedule,
} = useSchedule()
const scheduleTab = ref<ScheduleTab>('upcoming')
const scheduleEmpty = computed(
  () => !!schedule.value && schedule.value[scheduleTab.value].length === 0,
)

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

interface SectionEntry {
  key: string
  label: string
  // Пусто, пока не пришло: место числа занято, строка не сдвигается
  count?: number
}

function entryOf(section: MineSection): SectionEntry {
  return {
    key: sectionKey(section),
    label: sectionLabel(section),
    count: section.count,
  }
}

// Подборки — отдельной группой между «Избранным» и «Просмотрено»;
// «Расписание» — сразу после «Продолжить» и только вместе с разделами
// сервера: одна эта строка до их ответа забрала бы фокус и выбор раздела
const groups = computed(() => {
  const own = sections.value.filter(item => item.id !== 'collection')
  const collections = sections.value.filter(item => item.id === 'collection')
  const split = own.findIndex(item => item.id === 'watched')
  const before = (split < 0 ? own : own.slice(0, split)).map(entryOf)
  const value = schedule.value

  if (own.length) {
    before.splice(before.findIndex(item => item.key === 'continue') + 1, 0, {
      key: SCHEDULE,
      label: t('mine.sections.schedule'),
      count: value ? value.upcoming.length + value.recent.length : undefined,
    })
  }

  return {
    before,
    collections: collections.map(entryOf),
    after: split < 0 ? [] : own.slice(split).map(entryOf),
  }
})

function select(key: string) {
  if (key === selectedKey.value)
    return

  selectedKey.value = key

  // Расписание уже загружено вместе с «Моё»: показываем сразу
  if (key === SCHEDULE)
    shownKey.value = SCHEDULE
  else view.value = loadMineView(key)
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
  offset: columnOffset,
  followsFocus,
  alignTo: scrollGridTo,
  onScroll: onColumnScroll,
  onWheel: onRightWheel,
  transform: columnTransform,
} = useStackScroll(column)

// Новый раздел или вид: сетка с начала
watch([selectedKey, view], () => {
  focusedIndex.value = 0
  followsFocus.value = false
  scrollGridTo(0)
})

// Окно карточек в DOM: длинное «Просмотрено» не раздувает дерево на ТВ
const rowStep = ref(0)
// В вебе сетку листают колесом мимо фокуса: окно держит верхнюю видимую строку
const anchors = computed(() => {
  const focusedRow = Math.floor(focusedIndex.value / COLUMNS)

  if (!nativeScroll)
    return { first: focusedRow, last: focusedRow }

  const rows = Math.ceil(items.value.length / COLUMNS)

  return anchorSpan(
    rowAt(columnOffset.value, rowStep.value, rows),
    focusedRow,
    followsFocus.value,
  )
})
const windowed = computed(() =>
  rowStep.value
    ? gridWindow(
        anchors.value,
        items.value.length,
        COLUMNS,
        ROWS_BEFORE,
        ROWS_AFTER,
      )
    : { from: 0, to: items.value.length },
)
// В вебе конец сетки открывают прокруткой, а не фокусом: страницу просит окно
watch(windowed, ({ to }) => {
  if (nativeScroll && rowStep.value && to >= items.value.length - PREFETCH)
    void more()
})
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

  followsFocus.value = true

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

// Шаг PageUp/PageDown — высота окна в строках с округлением вверх: на ТВ
// в окне полторы-две строки постеров, и округление вниз дало бы шаг стрелки
function rowsPerScreen() {
  const height = viewport.value?.clientHeight ?? 0

  return rowStep.value ? Math.max(1, Math.ceil(height / rowStep.value)) : 1
}

// Карточка может быть за окном строк в DOM: сначала сдвигаем окно, потом фокус.
// В вебе окно идёт за прокруткой: колонку сразу ставим к строке карточки,
// плавное выравнивание после фокуса только доводит её
async function focusCard(index: number) {
  focusedIndex.value = index

  if (nativeScroll && column.value) {
    column.value.scrollTop = Math.floor(index / COLUMNS) * rowStep.value
    onColumnScroll()
  }

  await nextTick()

  const card = gridRoot.value?.querySelector<HTMLElement>(
    `[data-index="${index}"] button`,
  )

  if (card) {
    focus.focusOn(card)

    return true
  }

  return false
}

// Плитка «Все» главной открывает раздел адресом `/mine?section=…&kind=…`:
// раздел выбирается сразу, без задержки пролёта, а тип — только на этот
// показ, без записи в сохранённый вид раздела. Адрес сразу очищается: вход
// из рейла не возвращает в тот же раздел
let gridFocusPending = false

function openTarget() {
  const target = parseMineTarget(route.query)

  if (!target)
    return false

  clearTimeout(selectTimer)
  selectedKey.value = target.key

  const saved = loadMineView(target.key)

  view.value = target.kind ? { ...saved, kind: target.kind } : saved
  focusedIndex.value = 0
  scrollGridTo(0)
  gridFocusPending = true
  void router.replace({ path: '/mine' })
  void focusPendingGrid()

  return true
}

// Фокус — на первую карточку, когда пришли карточки выбранного раздела;
// пусто или ошибка — на сам раздел
async function focusPendingGrid() {
  await nextTick()

  if (
    !gridFocusPending
    || shownKey.value !== selectedKey.value
    || status.value === 'loading'
    || showSkeleton.value
  ) {
    return
  }

  gridFocusPending = false

  if (!(await focusCard(0)))
    focusSelectedSection()
}

watch([shownKey, status, showSkeleton], () => void focusPendingGrid(), {
  flush: 'post',
})

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

const scheduleShown = computed(() => shownKey.value === SCHEDULE)
const sectionsRight = computed(() => {
  if (scheduleShown.value)
    return scheduleEmpty.value ? 'mine-schedule-tabs' : 'mine-schedule'

  return isEmpty.value ? 'mine-controls' : 'mine-grid'
})

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
  void refreshSchedule()
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

// Back в глубине сетки — к её началу, с первой строки — как обычно, на
// главную; PageUp/PageDown — на экран строк в той же колонке
const offKey = focus.onKey((action) => {
  if (
    !isActive
    || panel.value
    || (action.type !== 'back' && action.type !== 'page')
  ) {
    return false
  }

  const current = focus.current()

  if (!current || !gridRoot.value?.contains(current))
    return false

  if (action.type === 'back') {
    if (focusedIndex.value < COLUMNS)
      return false

    scrollGridTo(0)
    void focusCard(0)

    return true
  }

  void focusCard(
    pageTarget(
      focusedIndex.value,
      items.value.length,
      COLUMNS,
      rowsPerScreen(),
      action.direction,
    ),
  )

  return true
})

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

  const targeted = openTarget()

  syncChanges()

  // Из плеера и карточки — с новыми состояниями серий
  if (scheduleShown.value)
    void refreshSchedule()

  if (targeted)
    return

  if (!focus.activate(scheduleShown.value ? 'mine-schedule' : 'mine-grid'))
    focusSelectedSection()
})

onDeactivated(() => {
  isActive = false
})

onBeforeUnmount(() => {
  stopFocus()
  offKey()
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
          :edges="{ left: RAIL_SECTION, right: sectionsRight }"
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
              :key="section.key"
              v-focusable
              class="mine__section"
              :class="{
                'mine__section--selected': section.key === selectedKey,
              }"
              :data-section="section.key"
              type="button"
              :aria-pressed="section.key === selectedKey"
              @click="select(section.key)"
            >
              <span class="mine__section-name">{{ section.label }}</span>
              <span class="mine__section-count">{{ section.count }}</span>
            </button>
          </template>
        </FocusSection>
      </div>
    </div>

    <MineSchedule
      v-if="scheduleShown"
      v-model:tab="scheduleTab"
      :schedule="schedule"
      :loading="scheduleStatus === 'loading'"
      :error="scheduleStatus === 'error' ? scheduleError : undefined"
      @retry="retrySchedule"
    />
    <div v-else class="mine__right" @wheel.passive="onRightWheel">
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
