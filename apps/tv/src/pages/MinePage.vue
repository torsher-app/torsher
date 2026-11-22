<script setup lang="ts">
import type { Card, MineBootstrap } from '@torsher/api-client'
import type { PanelOption } from '../components/OptionsPanel.vue'
import type { MineGridItem } from '../composables/useMine.ts'
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
import ContinueCard from '../components/ContinueCard.vue'
import LibraryVersionPicker from '../components/LibraryVersionPicker.vue'
import MinePersonalSections from '../components/mine/MinePersonalSections.vue'
import { api } from '../api.ts'
import { useContinuePlayback } from '../composables/useContinuePlayback.ts'
import { mineEditor } from '../lib/mineEditor.ts'
import type {
  ContinueState,
  DiaryFilter,
  DiaryScope,
  MineMenuSection,
  WatchedScope,
} from '../lib/minePersonal.ts'
import { isMineViewer, mineStartKey, mineViewer } from '../lib/minePersonal.ts'
import AppRail from '../components/AppRail.vue'
import FocusSection from '../components/FocusSection.vue'
import MineSchedule from '../components/MineSchedule.vue'
import MineSectionHeader from '../components/MineSectionHeader.vue'
import OptionsPanel from '../components/OptionsPanel.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useTitleChanges } from '../composables/useTitleChanges.ts'
import {
  useMineBootstrap,
  useMineItems,
  useMineSectionCounts,
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

type Control = 'sort' | 'kind' | 'rating' | 'state'
type PersonalSection = 'overview' | 'diary' | 'recommendations'
const PERSONAL_SECTIONS: PersonalSection[] = [
  'overview',
  'diary',
  'recommendations',
]

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const focus = useFocus()
const root = ref<HTMLElement>()
const sectionsRoot = ref<HTMLElement>()
const isActive = ref(false)
const { resume, picker: libraryPicker } = useContinuePlayback(root)
const { selection: librarySelection } = libraryPicker
const selectedKey = ref('continue')
const continueState = ref<ContinueState>('normal')
const watchedScope = shallowRef<WatchedScope>()
const diaryFilter = ref<DiaryFilter>('all')
const diaryScope = shallowRef<DiaryScope>({})
const diaryDrilldown = ref(0)
let menuRevision = 0
let startApplied = false
let startWrite = Promise.resolve()
let queuedStart: string | undefined
let gridFocusPending = false

const {
  status: sectionsStatus,
  bootstrap,
  error: sectionsError,
  retry: retrySections,
  refresh: refreshSections,
} = useMineBootstrap()
const {
  counts: sectionCounts,
  status: sectionCountsStatus,
  refresh: refreshSectionCounts,
} = useMineSectionCounts()

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

const standardSections = [
  'continue',
  'watchlist',
  'favorites',
  'ratings',
  'watched',
  'dropped',
] as const
const collectionCounts = computed(
  () =>
    new Map(
      sectionCounts.value?.collections.map(({ id, count }) => [id, count]),
    ),
)
const sections = computed<MineMenuSection[]>(() => [
  ...standardSections.map(id => ({
    id,
    count:
      sectionCounts.value?.counts[id]
      ?? bootstrap.value?.counts[id]
      ?? undefined,
  })),
  ...(bootstrap.value?.collections ?? []).map(item => ({
    id: 'collection' as const,
    collectionId: item.id,
    name: item.name,
    count: collectionCounts.value.get(item.id) ?? item.count ?? undefined,
  })),
])
const selected = computed(() =>
  bootstrap.value
    ? sections.value.find(item => sectionKey(item) === selectedKey.value)
    : undefined,
)
const view = shallowRef<MineView>(loadMineView(selectedKey.value))

const { status, items, total, error, retry, more, refresh, refreshReady }
  = useMineItems(selected, view, { state: continueState, watched: watchedScope })

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

function sectionLabel(section: MineMenuSection) {
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

function entryOf(section: MineMenuSection): SectionEntry {
  return {
    key: sectionKey(section),
    label: sectionLabel(section),
    count: section.count,
  }
}

interface MenuGroup {
  key: string
  label?: string
  spacerBefore?: boolean
  entries: SectionEntry[]
}

const menuGroups = computed<MenuGroup[]>(() => {
  const system = new Map(
    sections.value.map(section => [sectionKey(section), entryOf(section)]),
  )
  const scheduleCount = schedule.value
  const scheduleEntry: SectionEntry = {
    key: SCHEDULE,
    label: t('mine.sections.schedule'),
    count: scheduleCount
      ? scheduleCount.upcoming.length + scheduleCount.recent.length
      : (bootstrap.value?.counts.schedule ?? undefined),
  }
  const personal = (key: PersonalSection): SectionEntry => ({
    key,
    label: t(`mine.preview.sections.${key}`),
  })
  const take = (...keys: string[]) =>
    keys.map(key => system.get(key)).filter(entry => entry !== undefined)

  return [
    {
      key: 'watch',
      entries: [
        ...take('continue'),
        personal('recommendations'),
        scheduleEntry,
      ],
    },
    {
      key: 'history',
      spacerBefore: true,
      entries: [personal('overview'), personal('diary'), ...take('watched')],
    },
    {
      key: 'lists',
      spacerBefore: true,
      entries: take('watchlist', 'favorites', 'ratings', 'dropped'),
    },
    {
      key: 'collections',
      spacerBefore: true,
      label: t('mine.collections'),
      entries: sections.value
        .filter(item => item.id === 'collection')
        .map(entryOf),
    },
  ].filter(group => group.entries.length)
})

let selectTimer = 0

function select(key: string) {
  clearTimeout(selectTimer)
  if (key === selectedKey.value)
    return
  if (key !== 'watched')
    watchedScope.value = undefined
  selectedKey.value = key
  if (isPersonalSection(key) || key === SCHEDULE)
    shownKey.value = key
  else view.value = loadMineView(key)
}

function isPersonalSection(key: string): key is PersonalSection {
  return PERSONAL_SECTIONS.includes(key as PersonalSection)
}

function selectFromMenu(key: string) {
  menuRevision++
  watchedScope.value = undefined
  select(key)
  if (key === queuedStart)
    return
  queuedStart = key
  const context = mineViewer()
  const start: MineBootstrap['start'] = key.startsWith('collection:')
    ? { kind: 'collection', collectionId: key.slice(11) }
    : {
        kind: 'section',
        section: key as Extract<
          MineBootstrap['start'],
          { kind: 'section' }
        >['section'],
      }
  startWrite = startWrite.then(async () => {
    if (!isMineViewer(context))
      return
    try {
      await api.mine.putMineStart({
        expectedProfileId: context.expectedProfileId,
        start,
      })
    }
    catch {
      if (isMineViewer(context) && queuedStart === key)
        queuedStart = undefined
    }
  })
}

const openedAt = menuRevision
watch(
  bootstrap,
  (data) => {
    if (!data || startApplied)
      return
    startApplied = true
    if (menuRevision !== openedAt)
      return
    const key = mineStartKey(data.start)
    if (
      menuGroups.value.some(group =>
        group.entries.some(entry => entry.key === key),
      )
    ) {
      select(key)
      queuedStart = key
      void nextTick(() => {
        if (
          menuRevision === openedAt
          && isActive.value
          && sectionsRoot.value?.contains(focus.current() ?? null)
        ) {
          focusSelectedSection()
        }
      })
    }
  },
  { flush: 'sync' },
)

async function openDiary(filter: DiaryFilter, scope: DiaryScope = {}) {
  diaryFilter.value = filter
  diaryScope.value = scope
  diaryDrilldown.value++
  select('diary')
  const context = mineViewer()
  await nextTick()
  if (isMineViewer(context) && isActive.value)
    focus.activate('mine-diary-list') || focus.activate('mine-preview')
}

async function openWatched(scope: WatchedScope) {
  select('watched')
  watchedScope.value = scope
  view.value = { ...DEFAULT_MINE_VIEW }
  gridFocusPending = true
  await focusPendingGrid()
}

const gridRoot = ref<HTMLElement>()
const focusedIndex = ref(0)
const panel = ref<Control>()

const stopFocus = focus.onFocus((el, via) => {
  if (!isActive.value)
    return
  const key = el.dataset.section

  if (key && sectionsRoot.value?.contains(el) && via !== 'pointer') {
    clearTimeout(selectTimer)
    const context = mineViewer()
    selectTimer = window.setTimeout(() => {
      if (isMineViewer(context) && isActive.value)
        select(key)
    }, SECTION_DELAY_MS)

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
watch([selectedKey, view, continueState, watchedScope], () => {
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
  const context = mineViewer()
  const previous = focus.current()
  const lostGridCard = !!previous && !!gridRoot.value?.contains(previous)
  const oldIndex = focusedIndex.value
  const oldSection = shownKey.value
  await nextTick()

  const cards = gridRoot.value?.querySelectorAll<HTMLElement>('[data-index]')

  if (cards && cards.length > COLUMNS)
    rowStep.value = cards[COLUMNS].offsetTop - cards[0].offsetTop

  const canRestore = () => {
    const current = focus.current()
    return (
      isMineViewer(context)
      && isActive.value
      && !mineEditor.value
      && !titleActions.target
      && !panel.value
      && lostGridCard
      && !previous?.isConnected
      && shownKey.value === oldSection
      && (!current || current === previous)
    )
  }
  if (!canRestore())
    return
  if (items.value.length)
    await focusCard(Math.min(oldIndex, items.value.length - 1), canRestore)
  else focusSelectedSection()
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
async function focusCard(index: number, canFocus = () => true) {
  focusedIndex.value = index

  if (nativeScroll && column.value) {
    column.value.scrollTop = Math.floor(index / COLUMNS) * rowStep.value
    onColumnScroll()
  }

  const context = mineViewer()
  await nextTick()

  if (!isMineViewer(context) || !isActive.value || !canFocus())
    return false

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
function openTarget() {
  const target = parseMineTarget(route.query)

  if (!target)
    return false

  clearTimeout(selectTimer)
  menuRevision++
  watchedScope.value = undefined
  if (target.key === 'continue')
    continueState.value = 'normal'
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
    || !isActive.value
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
let panelOpener: HTMLElement | undefined

function sortLabel(id: MineView['sort']) {
  return t(
    selected.value?.id === 'ratings' && id === 'added'
      ? 'mine.sort.rated'
      : `mine.sort.${id}`,
  )
}

const continuationFilters: ContinueState[] = ['normal', 'paused', 'hidden']
function continueLabel(id: ContinueState) {
  return t(
    id === 'normal' ? 'mine.preview.diary.filters.all' : `mine.personal.${id}`,
  )
}
const controls = computed(() => [
  ...(shownKey.value === 'continue'
    ? [{ id: 'state' as const, label: continueLabel(continueState.value) }]
    : []),
  { id: 'sort' as const, label: sortLabel(view.value.sort) },
  { id: 'kind' as const, label: t(`mine.kind.${view.value.kind}`) },
  {
    id: 'rating' as const,
    label: t(`mine.rating.${ratingKey(view.value.rating)}`),
  },
])

const panelOptions = computed<PanelOption[]>(() => {
  switch (panel.value) {
    case 'state':
      return continuationFilters.map(id => ({
        id,
        label: continueLabel(id),
        selected: id === continueState.value,
      }))
    case 'sort':
      return MINE_SORTS.map(id => ({
        id,
        label: sortLabel(id),
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
  if (panel.value === 'state')
    continueState.value = id as ContinueState
  else if (panel.value)
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
const previewShown = computed(() => isPersonalSection(shownKey.value ?? ''))
const sectionsRight = computed(() => {
  if (previewShown.value)
    return 'mine-preview'

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

let personalReturn:
  | {
    opener: HTMLElement
    section?: string
    tab: string
    viewer: ReturnType<typeof mineViewer>
  }
  | undefined

function rememberPersonalFocus(opener?: HTMLElement) {
  if (
    !shownKey.value
    || !previewShown.value
    || !opener
    || !root.value?.contains(opener)
  ) {
    return
  }
  personalReturn = {
    opener,
    section:
      opener
        .closest('[data-focus-section]')
        ?.getAttribute('data-focus-section') ?? undefined,
    tab: shownKey.value,
    viewer: mineViewer(),
  }
}

function open(card: Card, opener?: HTMLElement) {
  rememberPersonalFocus(opener)
  router.push(`/title/${card.id}`)
}

function selectGridItem(item: MineGridItem, event: MouseEvent) {
  if (item.continuation && item.canResume) {
    void resume(
      item.card.id,
      item.continuation,
      undefined,
      event.detail > 0 ? 'pointer' : 'remote',
    )
    return
  }
  open(item.card)
}

// Правки из меню действий: списки перечитываются тихо, на месте
const syncChanges = useTitleChanges(
  () => titleActions.version,
  () => sectionsStatus.value === 'ready' && refreshReady.value,
  async () => {
    void refreshSectionCounts()
    const outcomes = await Promise.all([
      refreshSections(),
      refreshSchedule(),
      ...(!previewShown.value && !scheduleShown.value ? [refresh()] : []),
    ])
    return outcomes.every(outcome => outcome !== false)
  },
  () => isActive.value,
  () => !!titleActions.target || !!panel.value || !!mineEditor.value,
)

// Back в глубине сетки — к её началу, с первой строки — как обычно, на
// главную; PageUp/PageDown — на экран строк в той же колонке
const offKey = focus.onKey((action) => {
  const current = focus.current()
  if (
    isActive.value
    && !panel.value
    && !mineEditor.value
    && !titleActions.target
    && current
    && action.type === 'move'
    && action.direction === 'right'
    && sectionsRoot.value?.contains(current)
  ) {
    const key = current.dataset.section
    if (key) {
      const changed = key !== selectedKey.value
      selectFromMenu(key)
      if (changed) {
        const context = mineViewer()
        void nextTick(() => {
          if (
            isMineViewer(context)
            && isActive.value
            && focus.current() === current
          ) {
            focus.activate(sectionsRight.value)
          }
        })
        return true
      }
    }
  }
  if (
    isActive.value
    && watchedScope.value
    && action.type === 'back'
    && !panel.value
    && !mineEditor.value
    && !titleActions.target
  ) {
    select('overview')
    void nextTick(() => focus.activate('mine-preview'))
    return true
  }
  if (
    !isActive.value
    || panel.value
    || (action.type !== 'back' && action.type !== 'page')
  ) {
    return false
  }

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
  if (value !== 'ready' || previous !== 'loading' || !isActive.value)
    return

  const context = mineViewer()
  await nextTick()

  if (
    isMineViewer(context)
    && isActive.value
    && !root.value?.contains(focus.current() ?? null)
  ) {
    focusSelectedSection()
  }
})

onActivated(() => {
  isActive.value = true

  const returning = personalReturn
  personalReturn = undefined
  const targeted = openTarget()

  const syncing = syncChanges()

  // Из плеера и карточки — с новыми состояниями тайтлов и серий
  if (!syncing && !titleActions.target) {
    if (scheduleStatus.value !== 'loading')
      void refreshSchedule()
    if (sectionCountsStatus.value !== 'loading')
      void refreshSectionCounts()
  }

  if (targeted)
    return

  if (
    returning
    && returning.tab === shownKey.value
    && isMineViewer(returning.viewer)
  ) {
    const { opener, section } = returning
    if (
      (opener.isConnected && focus.focusOn(opener))
      || (section && focus.activate(section))
    ) {
      return
    }
  }

  const target = previewShown.value
    ? 'mine-preview'
    : scheduleShown.value
      ? 'mine-schedule'
      : 'mine-grid'

  if (!focus.activate(target))
    focusSelectedSection()
})

onDeactivated(() => {
  isActive.value = false
  clearTimeout(selectTimer)
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
      <div v-else ref="sectionsRoot" class="mine__sections-frame">
        <FocusSection
          name="mine-sections"
          class="mine__sections"
          :edges="{ left: RAIL_SECTION, right: sectionsRight }"
          autofocus
        >
          <template v-for="group in menuGroups" :key="group.key">
            <div
              v-if="group.spacerBefore"
              class="mine__section-spacer"
              aria-hidden="true"
            />
            <h2 v-if="group.label" class="mine__label mine__label--preview">
              {{ group.label }}
            </h2>
            <button
              v-for="section in group.entries"
              :key="section.key"
              v-focusable
              class="mine__section"
              :class="{
                'mine__section--selected': section.key === selectedKey,
              }"
              :data-section="section.key"
              type="button"
              :aria-pressed="section.key === selectedKey"
              @click="selectFromMenu(section.key)"
            >
              <span class="mine__section-name">{{ section.label }}</span>
              <span class="mine__section-count">{{ section.count }}</span>
            </button>
          </template>
        </FocusSection>
      </div>
    </div>

    <MinePersonalSections
      v-if="bootstrap"
      v-show="previewShown"
      :active="isActive && previewShown"
      :section="previewShown ? (shownKey as PersonalSection) : undefined"
      :bootstrap="bootstrap"
      :diary-filter="diaryFilter"
      :diary-scope="diaryScope"
      :diary-drilldown="diaryDrilldown"
      @diary="openDiary"
      @watched="openWatched"
      @update-filter="
        diaryFilter = $event;
        diaryScope = {};
      "
      @clear-scope="diaryScope = {}"
      @open="open"
      @remember-focus="rememberPersonalFocus"
      @return-sections="focusSelectedSection"
    />
    <MineSchedule
      v-if="scheduleShown"
      v-model:tab="scheduleTab"
      :schedule="schedule"
      :loading="scheduleStatus === 'loading'"
      :error="scheduleStatus === 'error' ? scheduleError : undefined"
      @retry="retrySchedule"
    />
    <div
      v-else-if="!previewShown"
      class="mine__right"
      @wheel.passive="onRightWheel"
    >
      <MineSectionHeader
        :title="
          watchedScope?.label
            ?? (shown ? sectionLabel(shown) : t('mine.sections.continue'))
        "
        :total="
          shown && status === 'ready' && !showSkeleton ? total : undefined
        "
      >
        <template v-if="!watchedScope" #default>
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
        </template>
        <template #content>
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
                    <PosterSkeleton
                      v-for="index in SKELETON_COUNT"
                      :key="index"
                    />
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
                    :class="{
                      'mine__grid--stale': stale,
                      'mine__grid--continue': shownKey === 'continue',
                    }"
                    :style="gridPadding"
                  >
                    <div
                      v-for="{ item, index } in visible"
                      :key="item.card.id"
                      :data-index="index"
                    >
                      <ContinueCard
                        v-if="item.continuation"
                        :item="item.continuation"
                        :continuation-state="item.continuationState"
                        :cycle="item.cycle"
                        @select="selectGridItem(item, $event)"
                      />
                      <PosterCard
                        v-else
                        :card="item.card"
                        caption
                        @select="open(item.card)"
                      />
                    </div>
                  </div>
                </FocusSection>
              </div>
            </div>
          </div>
        </template>
      </MineSectionHeader>
    </div>

    <LibraryVersionPicker
      v-if="librarySelection"
      :files="librarySelection.files"
      @select="libraryPicker.select"
      @close="libraryPicker.close"
    />
    <AppRail current="mine" :section="RAIL_SECTION" content="mine-sections" />

    <OptionsPanel
      v-if="panel"
      :title="
        panel === 'state'
          ? t('mine.sections.continue')
          : t(`mine.panel.${panel}`)
      "
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
  top: var(--safe-y);
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
.mine__sections-frame {
  flex: 1;
  min-height: 0;
}

.mine__sections {
  height: 100%;
  margin: 0 calc(var(--focus-ring-gap) * -1);
  padding: calc(var(--u) * 8) var(--focus-ring-gap) var(--safe-y);
  overflow-y: auto;
}

.mine__sections::-webkit-scrollbar {
  display: none;
}

.mine__label {
  margin: 0 0 calc(var(--u) * 12) calc(var(--u) * 22);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.mine__label--preview {
  font-size: var(--font-size-s);
}

.mine__section-spacer {
  height: calc(var(--u) * 32);
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

.mine__controls {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
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
  top: calc(var(--mine-content-top) - var(--focus-ring-gap));
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
.mine__grid--continue :deep(.continue-card) {
  width: 100%;
}
</style>
