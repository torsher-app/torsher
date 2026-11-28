<script setup lang="ts">
import type { Card, MineDiaryEntry } from '@torsher/api-client'
import type { DiaryFilter, DiaryScope } from '../../lib/minePersonal.ts'
import type { PanelOption } from '../OptionsPanel.vue'
import {
  computed,
  nextTick,
  onActivated,
  onDeactivated,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useMineDiary } from '../../composables/useMineDiary.ts'
import { useTitleChanges } from '../../composables/useTitleChanges.ts'
import { useTitleMeta } from '../../composables/useTitleMeta.ts'
import { useFocus } from '../../focus/index.ts'
import { restartScope, stageViewingRestart } from '../../lib/viewingRestart.ts'
import { episodeCode, withStartPosition } from '../../lib/continue.ts'
import {
  countryLabel,
  diaryClock,
  formatMineDate,
  mineDayLabel,
} from '../../lib/mineDates.ts'
import { mineEditor, openMineEditor } from '../../lib/mineEditor.ts'
import {
  diaryCard,
  diaryFilterQuery,
  isMineViewer,
  mineViewer,
} from '../../lib/minePersonal.ts'
import { platform } from '../../platform/index.ts'
import { titleActions } from '../../titleActions.ts'
import AppIcon from '../AppIcon.vue'
import FocusSection from '../FocusSection.vue'
import MineSectionHeader from '../MineSectionHeader.vue'
import OptionsPanel from '../OptionsPanel.vue'
import ScreenState from '../ScreenState.vue'
import SearchField from '../SearchField.vue'

const props = defineProps<{
  filter: DiaryFilter
  scope: DiaryScope
  drilldown: number
  today: string
  timeZone: string
}>()
const emit = defineEmits<{
  updateFilter: [filter: DiaryFilter]
  open: [card: Card, opener?: HTMLElement]
  rememberFocus: [opener?: HTMLElement]
  clearScope: []
}>()

const { locale, t } = useI18n()
const focus = useFocus()
const router = useRouter()
const { formatRuntime } = useTitleMeta()
const browser = platform === 'web'
const active = ref(false)
const list = ref<HTMLElement>()
const monthPanel = ref(false)
const activeEntry = shallowRef<MineDiaryEntry>()
const searchInput = ref('')
const search = ref('')
let searchTimer: ReturnType<typeof setTimeout> | undefined
let panelOpener: HTMLElement | undefined
let jumpRevision = 0
let jumping = false
const scopeActive = computed(() => Object.keys(props.scope).length > 0)
const distinctScope = computed(
  () => !!props.scope.genre || !!props.scope.country,
)
const scopeLabel = computed(() =>
  [
    props.scope.day
      ? dayTitle(props.scope.day)
      : props.scope.month
        ? monthLabel(`${props.scope.month}-01`)
        : props.scope.year,
    props.scope.label
    ?? (props.scope.country && countryLabel(props.scope.country, locale.value)),
  ]
    .filter(Boolean)
    .join(' · '),
)
const filters: DiaryFilter[] = [
  'all',
  'movies',
  'episodes',
  'rewatches',
  'undated',
]
const query = computed(() =>
  diaryFilterQuery(props.filter, props.scope, search.value),
)
const { data: page, error, loading, read, jump } = useMineDiary(query, active)

watch(searchInput, (value) => {
  clearTimeout(searchTimer)
  const context = mineViewer()
  searchTimer = setTimeout(() => {
    if (active.value && isMineViewer(context))
      search.value = value
  }, 300)
})
watch(
  () => props.drilldown,
  () => {
    searchInput.value = ''
    clearTimeout(searchTimer)
    search.value = ''
  },
)
onActivated(() => {
  active.value = true
  search.value = searchInput.value
})
onDeactivated(() => {
  active.value = false
  jumpRevision++
  jumping = false
  clearTimeout(searchTimer)
})
onScopeDispose(() => clearTimeout(searchTimer))
useTitleChanges(
  () => titleActions.version,
  () => !loading.value,
  () => read(),
  () => active.value,
  () => !!mineEditor.value || !!activeEntry.value || monthPanel.value,
)

const stopKeys = focus.onKey((action) => {
  if (
    !active.value
    || mineEditor.value
    || monthPanel.value
    || activeEntry.value
    || !list.value?.contains(focus.current() ?? null)
  ) {
    return false
  }
  const current = focus.current()
  const buttons = [...list.value.querySelectorAll<HTMLElement>('[data-entry]')]
  const index = buttons.findIndex(button => button === current)
  if (index < 0)
    return false
  if (action.type === 'back' && (index > 0 || page.value?.newerCursor)) {
    if (page.value?.newerCursor)
      void jumpDiary()
    else focus.focusOn(buttons[0]!)
    return true
  }
  if (action.type === 'page') {
    const limit = list.value.clientHeight
    const source = buttons[index]!.getBoundingClientRect()
    const target
      = action.direction === 'down'
        ? (buttons
            .slice(index + 1)
            .find(
              row => row.getBoundingClientRect().top >= source.top + limit,
            ) ?? buttons[buttons.length - 1])
        : (buttons
            .slice(0, index)
            .reverse()
            .find(
              row => row.getBoundingClientRect().top <= source.top - limit,
            ) ?? buttons[0])
    if (target === current)
      void more(action.direction === 'down' ? 'older' : 'newer')
    else if (target)
      focus.focusOn(target)
    return true
  }
  return false
})
onScopeDispose(stopKeys)

function diaryRows() {
  return [...(list.value?.querySelectorAll<HTMLElement>('[data-entry]') ?? [])]
}

const stopPagingFocus = focus.onFocus((element, via) => {
  if (
    browser
    || !active.value
    || jumping
    || loading.value
    || via === 'pointer'
    || mineEditor.value
    || activeEntry.value
    || monthPanel.value
    || !element.dataset.entry
  ) {
    return
  }
  const rows = diaryRows()
  const index = rows.indexOf(element)
  if (index < 0)
    return
  if (index >= rows.length - 5 && page.value?.olderCursor)
    void read('older')
  else if (index < 5 && page.value?.newerCursor)
    void read('newer')
})
onScopeDispose(stopPagingFocus)

watch(
  () => page.value?.entries,
  async (entries) => {
    if (!entries || jumping)
      return
    const context = mineViewer()
    const scroller = list.value?.querySelector<HTMLElement>('.diary__list')
    const previous = focus.current()
    const rows = diaryRows()
    const index = rows.findIndex(row => row === previous)
    const visibleTop = scroller?.getBoundingClientRect().top ?? 0
    const anchor = rows.find(
      row => row.getBoundingClientRect().bottom > visibleTop,
    )
    const anchorTop = anchor?.getBoundingClientRect().top
    await nextTick()
    if (
      !isMineViewer(context)
      || !active.value
      || jumping
      || page.value?.entries !== entries
    ) {
      return
    }

    const remaining = diaryRows()
    const newAnchor
      = anchor
        && remaining.find(row => row.dataset.entry === anchor.dataset.entry)
    if (scroller && newAnchor && anchorTop !== undefined) {
      const top = newAnchor.getBoundingClientRect().top
      scroller.scrollTop += top - anchorTop
    }
    if (
      index < 0
      || !previous
      || previous.isConnected
      || mineEditor.value
      || monthPanel.value
      || activeEntry.value
      || (focus.current() && focus.current() !== previous)
    ) {
      return
    }
    const neighbor
      = remaining.find(row => row.dataset.entry === previous.dataset.entry)
        ?? newAnchor
        ?? remaining[Math.min(index, remaining.length - 1)]
    if (neighbor)
      focus.focusOn(neighbor)
    else focus.activate('mine-preview')
  },
)

const groups = computed(() => {
  const result: Array<{
    day: string | null
    entries: MineDiaryEntry[]
    monthStart: boolean
    monthCount: number
  }> = []
  let previousMonth: string | undefined
  for (const entry of page.value?.entries ?? []) {
    let group = result[result.length - 1]
    if (!group || group.day !== entry.calendarDay) {
      const month = entry.calendarDay?.slice(0, 7)
      group = {
        day: entry.calendarDay,
        entries: [],
        monthStart: !!month && month !== previousMonth,
        monthCount:
          page.value?.months.find(row => row.month === month)?.count ?? 0,
      }
      previousMonth = month
      result.push(group)
    }
    group.entries.push(entry)
  }
  return result
})
const emptyKey = computed(() =>
  props.filter === 'all' && !scopeActive.value && !search.value
    ? 'mine.personal.empty'
    : 'mine.emptyFiltered',
)

const actions = computed<PanelOption[]>(() => [
  { id: 'open', label: t('mine.preview.diary.actions.open'), selected: false },
  ...(activeEntry.value?.sourceUrl
    ? [{
        id: 'simkl',
        label: t('mine.preview.diary.actions.simkl'),
        selected: false,
      }]
    : []),
  {
    id: 'rewatch',
    label: t('mine.preview.diary.actions.rewatch'),
    selected: false,
    disabled: activeEntry.value?.kind === 'series',
  },
  {
    id: 'date',
    label: t('mine.preview.diary.actions.date'),
    selected: false,
    detail: '›',
  },
  {
    id: 'note',
    label: t('mine.preview.diary.actions.note'),
    selected: false,
    detail: '›',
  },
  {
    id: 'delete',
    label: t('mine.preview.diary.actions.delete'),
    selected: false,
  },
])
const monthOptions = computed<PanelOption[]>(() => {
  const options: PanelOption[] = []
  for (const { month, count } of page.value?.months ?? []) {
    if (month) {
      options.push({
        id: month,
        label: monthLabel(`${month}-01`),
        detail: String(count),
        selected: false,
      })
    }
  }
  return options
})

async function jumpDiary(month?: string) {
  const context = mineViewer()
  const token = ++jumpRevision
  monthPanel.value = false
  jumping = true
  try {
    if (!(await jump(month)))
      return
    await nextTick()
    if (!isMineViewer(context) || !active.value || token !== jumpRevision)
      return
    const row = month
      ? list.value?.querySelector<HTMLElement>(
          `[data-month="${month}"] .diary-row`,
        )
      : diaryRows()[0]
    if (row)
      focus.focusOn(row)
    else focus.activate('mine-diary-list')
  }
  finally {
    if (token === jumpRevision)
      jumping = false
  }
}

function monthLabel(day: string) {
  return formatMineDate(day, locale.value, { month: 'long', year: 'numeric' })
}

function dayTitle(day: string | null) {
  return day
    ? mineDayLabel(day, locale.value, t, props.today)
    : t('mine.preview.diary.undated')
}

function entryMeta(entry: MineDiaryEntry) {
  return [
    entry.kind === 'movie'
      ? t('title.movie')
      : entry.kind === 'series'
        ? t('title.series')
        : episodeCode(entry.season, entry.episode),
    entry.metadata?.episodeTitle,
    entry.metadata?.runtimeMinutes
      ? formatRuntime(entry.metadata.runtimeMinutes)
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

function chooseFilter(filter: DiaryFilter) {
  emit('updateFilter', filter)
}

function openActions(entry: MineDiaryEntry, event: Event) {
  panelOpener = event.currentTarget as HTMLElement
  activeEntry.value = entry
}

function openMonths() {
  if (!monthOptions.value.length)
    return
  panelOpener = focus.current() ?? undefined
  monthPanel.value = true
}

function closeActions(restore = true) {
  const context = mineViewer()
  const opener = panelOpener
  activeEntry.value = undefined
  monthPanel.value = false
  if (restore) {
    void nextTick(() => {
      if (isMineViewer(context) && active.value && opener?.isConnected)
        focus.focusOn(opener)
    })
  }
}

function chooseAction(id: string) {
  const entry = activeEntry.value
  if (!entry)
    return
  if (id === 'simkl') {
    const link = entry.sourceUrl
    if (link)
      window.open(link, '_blank', 'noopener,noreferrer')
    closeActions()
    return
  }
  closeActions(false)
  if (id === 'open') {
    emit('open', diaryCard(entry), panelOpener)
  }
  else if (id === 'rewatch') {
    const context = mineViewer()
    if (!context)
      return
    const target = {
      id: entry.titleId,
      season: entry.season,
      episode: entry.episode,
    }
    const request = stageViewingRestart(
      restartScope(context.expectedProfileId, target),
    )
    const query = entry.episode
      ? { season: String(entry.season), episode: String(entry.episode) }
      : undefined
    emit('rememberFocus', panelOpener)
    void router.push(
      withStartPosition(
        { path: `/title/${entry.titleId}/sources`, query },
        true,
        request.requestId,
      ),
    )
  }
  else {
    const kind
      = id === 'date' ? 'diaryDate' : id === 'note' ? 'diaryNote' : 'delete'
    openMineEditor({ kind, entry }, panelOpener)
  }
}

function logWatch() {
  openMineEditor({ kind: 'log' }, focus.current())
}

async function more(direction: 'older' | 'newer') {
  const context = mineViewer()
  const current = focus.current()
  const entries = page.value?.entries
  const edge
    = direction === 'older'
      ? entries?.[entries.length - 1]?.id
      : entries?.[0]?.id
  if (!(await read(direction)))
    return
  await nextTick()
  if (
    !isMineViewer(context)
    || !active.value
    || (focus.current() && focus.current() !== current)
  ) {
    return
  }
  const rows = diaryRows()
  const index = rows.findIndex(row => row.dataset.entry === edge)
  const next = index >= 0 && rows[index + (direction === 'older' ? 1 : -1)]
  if (next)
    focus.focusOn(next)
  else if (!current?.isConnected)
    focus.activate('mine-diary-list')
}

function onScroll(event: Event) {
  if (
    !browser
    || !page.value
    || loading.value
    || jumping
    || monthPanel.value
    || activeEntry.value
    || mineEditor.value
  ) {
    return
  }
  const container = event.currentTarget as HTMLElement
  if (
    container.scrollHeight - container.scrollTop - container.clientHeight
    < 300
    && page.value.olderCursor
  ) {
    void read('older')
  }
  else if (container.scrollTop === 0 && page.value.newerCursor) {
    void read('newer')
  }
}
</script>

<template>
  <div class="diary" :class="{ 'diary--scoped': scopeActive }">
    <MineSectionHeader :title="t('mine.preview.sections.diary')">
      <template #title-extra>
        <span v-if="page" class="diary__total">{{
          t("mine.preview.views", page.total)
        }}</span>
        <span v-if="page && distinctScope" class="diary__total">{{
          t("mine.personal.distinctTitles", page.distinctTitles)
        }}</span>
      </template>
      <template #actions>
        <FocusSection
          name="mine-preview"
          class="diary__period"
          :edges="{ left: 'mine-sections', down: 'mine-diary-filters' }"
          manual-scroll
        >
          <button v-focusable type="button" class="chip" @click="logWatch">
            {{ t("mine.personal.logWatch") }}
          </button>
          <button
            v-focusable
            type="button"
            class="chip period-button"
            @click="openMonths"
          >
            {{ t("mine.preview.diary.jumpMonth") }}
          </button>
        </FocusSection>
      </template>

      <FocusSection
        name="mine-diary-filters"
        class="diary__filters"
        :edges="{
          left: 'mine-sections',
          up: 'mine-preview',
          down: browser
            ? 'mine-diary-search'
            : scopeActive
              ? 'mine-diary-scope'
              : 'mine-diary-list',
        }"
        manual-scroll
      >
        <button
          v-for="item in filters"
          :key="item"
          v-focusable
          type="button"
          class="chip"
          :class="{ 'chip--selected': filter === item }"
          :aria-pressed="filter === item"
          @click="chooseFilter(item)"
        >
          {{ t(`mine.preview.diary.filters.${item}`) }}
        </button>
      </FocusSection>
      <template v-if="browser" #search>
        <FocusSection
          name="mine-diary-search"
          :edges="{
            left: 'mine-sections',
            up: 'mine-diary-filters',
            down: scopeActive ? 'mine-diary-scope' : 'mine-diary-list',
          }"
          manual-scroll
        >
          <SearchField>
            <input
              v-model="searchInput"
              v-focusable
              class="field"
              type="search"
              maxlength="200"
              :placeholder="t('search.title')"
              :aria-label="t('search.title')"
            >
          </SearchField>
        </FocusSection>
      </template>
      <template v-if="scopeActive" #scope>
        <FocusSection
          name="mine-diary-scope"
          :edges="{
            left: 'mine-sections',
            up: browser ? 'mine-diary-search' : 'mine-diary-filters',
            down: 'mine-diary-list',
          }"
          manual-scroll
        >
          <button
            v-focusable
            type="button"
            class="chip"
            @click="emit('clearScope')"
          >
            {{ scopeLabel }}
            <AppIcon name="close" />
          </button>
        </FocusSection>
      </template>
      <template #content>
        <div ref="list" class="diary__viewport">
          <FocusSection
            name="mine-diary-list"
            class="diary__list"
            :edges="{
              left: 'mine-sections',
              up: scopeActive
                ? 'mine-diary-scope'
                : browser
                  ? 'mine-diary-search'
                  : 'mine-diary-filters',
            }"
            @scroll.passive="onScroll"
          >
            <ScreenState v-if="error" :kind="error" @retry="read()" />
            <div v-if="loading && !page" aria-hidden="true">
              <div
                v-for="index in 4"
                :key="index"
                class="diary-row diary-row--skeleton"
              />
            </div>
            <div v-else-if="page && !page.total" class="diary__empty">
              <h3>{{ t(`${emptyKey}.title`) }}</h3>
              <p>{{ t(`${emptyKey}.text`) }}</p>
              <button
                v-if="emptyKey === 'mine.personal.empty'"
                v-focusable
                type="button"
                class="action"
                @click="logWatch"
              >
                {{ t("mine.personal.logWatch") }}
              </button>
            </div>
            <button
              v-if="page?.newerCursor"
              v-focusable
              type="button"
              class="chip"
              :aria-label="t('catalog.nextPage')"
              @click="more('newer')"
            >
              <AppIcon name="chevronUp" />
            </button>
            <section
              v-for="group in groups"
              :key="String(group.day)"
              class="day-group"
              :data-month="group.day?.slice(0, 7)"
            >
              <h3 v-if="group.monthStart && group.day" class="month-heading">
                {{ monthLabel(group.day) }} · {{ group.monthCount }}
              </h3>
              <h3>{{ dayTitle(group.day) }}</h3>
              <button
                v-for="entry in group.entries"
                :key="entry.id"
                v-focusable
                data-long-press
                type="button"
                class="diary-row"
                :data-entry="entry.id"
                @click="openActions(entry, $event)"
                @longpress="openActions(entry, $event)"
              >
                <img
                  v-if="entry.metadata?.poster"
                  :src="entry.metadata.poster"
                  alt=""
                  loading="lazy"
                >
                <span v-else class="diary-row__poster" />
                <span class="diary-row__main">
                  <strong>{{ entry.metadata?.title ?? entry.titleId }}</strong>
                  <small>{{ entryMeta(entry) }}</small>
                </span>
                <span class="diary-row__flags">
                  <span v-if="entry.rewatch"><AppIcon name="recent" />
                    {{ t("mine.preview.diary.rewatch") }}</span>
                  <span v-if="entry.note"><AppIcon name="list" />
                    {{ t("mine.preview.diary.note") }}</span>
                  <span
                    v-if="
                      entry.origin === 'letterboxd' || entry.origin === 'trakt' || entry.origin === 'simkl'
                    "
                  ><AppIcon name="download" />
                    {{ t("mine.preview.diary.imported") }}</span>
                </span>
                <time v-if="entry.date.precision === 'instant'">{{
                  diaryClock(entry.date.instant, timeZone, locale)
                }}</time>
              </button>
            </section>
            <button
              v-if="page?.olderCursor"
              v-focusable
              type="button"
              class="chip"
              :aria-label="t('catalog.nextPage')"
              @click="more('older')"
            >
              <AppIcon name="chevronDown" />
            </button>
          </FocusSection>
        </div>
      </template>
    </MineSectionHeader>

    <OptionsPanel
      v-if="activeEntry"
      :title="activeEntry.metadata?.title ?? activeEntry.titleId"
      :options="actions"
      :focus-selected="false"
      @select="chooseAction"
      @close="closeActions"
    />

    <OptionsPanel
      v-if="monthPanel"
      :title="t('mine.preview.diary.jumpMonth')"
      :options="monthOptions"
      @select="jumpDiary"
      @close="closeActions"
    />
  </div>
</template>

<style scoped>
.diary {
  position: relative;
  height: 100%;
}

.diary__period {
  display: flex;
}

.period-button {
  min-width: calc(var(--u) * 270);
  margin-right: 0;
}

.diary__filters {
  display: flex;
  align-items: center;
  flex: 1;
  flex-wrap: nowrap;
}

.diary--scoped .diary__viewport {
  top: calc(var(--mine-content-top) + var(--u) * 96 - var(--focus-ring-gap));
}

.diary__filters .chip {
  font-size: var(--font-size-s);
}

.diary__total {
  margin-left: calc(var(--u) * 20);
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  white-space: nowrap;
}

.diary__viewport {
  /* Полная строка при масштабе 1.06 выходит на 38u с каждой стороны. */
  --diary-focus-room: calc(var(--u) * 48);

  position: absolute;
  top: calc(var(--mine-content-top) - var(--focus-ring-gap));
  right: calc(var(--diary-focus-room) * -1);
  bottom: 0;
  left: calc(var(--diary-focus-room) * -1);
  overflow: hidden;
}

.diary__list {
  height: 100%;
  padding: var(--focus-ring-gap) var(--diary-focus-room) calc(var(--u) * 100);
  overflow-y: auto;
}

.diary__list::-webkit-scrollbar {
  display: none;
}

.day-group {
  margin-bottom: calc(var(--u) * 24);
}

.month-heading {
  margin: 0 0 calc(var(--u) * 20) calc(var(--u) * 18);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.day-group h3 {
  margin: 0 0 calc(var(--u) * 12) calc(var(--u) * 18);
  font-size: var(--font-size-m);
  font-weight: 700;
  text-transform: capitalize;
}

.diary-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: calc(var(--u) * 136);
  margin-bottom: calc(var(--u) * 10);
  padding: calc(var(--u) * 8) calc(var(--u) * 20);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-surface);
  color: inherit;
  font: inherit;
  text-align: left;
}

.diary-row img {
  width: calc(var(--u) * 72);
  height: calc(var(--u) * 108);
  border-radius: calc(var(--u) * 8);
  object-fit: cover;
}

.diary-row__main {
  flex: 1;
  min-width: 0;
  margin-left: calc(var(--u) * 20);
}

.diary-row__main strong,
.diary-row__main small {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.diary-row__main strong {
  font-size: var(--font-size-m);
}

.diary-row__main small,
.diary-row__flags,
.diary-row time {
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.diary-row__main small {
  margin-top: calc(var(--u) * 5);
}

.diary-row__flags {
  display: flex;
  align-items: center;
  margin-left: calc(var(--u) * 20);
}

.diary-row__flags span {
  display: inline-flex;
  align-items: center;
  margin-left: calc(var(--u) * 14);
  white-space: nowrap;
}

.diary-row__flags .icon {
  margin-right: calc(var(--u) * 6);
}

.diary-row time {
  min-width: calc(var(--u) * 76);
  margin-left: calc(var(--u) * 24);
  text-align: right;
}

.period-button:focus,
.diary-row:focus {
  background: var(--color-focus);
  color: var(--color-bg);
  outline: 0;
  transform: scale(var(--focus-scale));
}

.diary-row:focus .diary-row__main small,
.diary-row:focus .diary-row__flags,
.diary-row:focus time {
  color: inherit;
}
.diary-row--skeleton {
  opacity: 0.5;
  min-height: calc(var(--u) * 108);
  pointer-events: none;
}

.diary-row__poster {
  flex: 0 0 calc(var(--u) * 56);
}

.diary__empty p {
  color: var(--color-text-muted);
}
</style>
