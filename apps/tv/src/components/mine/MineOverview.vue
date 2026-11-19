<script setup lang="ts">
import type { Card, MineDiaryEntry } from '@torsher/api-client'
import type {
  DiaryFilter,
  DiaryScope,
  WatchedScope,
} from '../../lib/minePersonal.ts'
import type { PanelOption } from '../OptionsPanel.vue'
import {
  computed,
  onActivated,
  onDeactivated,
  onScopeDispose,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.ts'
import { useCatalogLanguage } from '../../composables/useCatalogLanguage.ts'
import { useResource } from '../../composables/useResource.ts'
import { useTitleChanges } from '../../composables/useTitleChanges.ts'
import { useTitleMeta } from '../../composables/useTitleMeta.ts'
import { useFocus } from '../../focus/index.ts'
import { episodeCode } from '../../lib/continue.ts'
import { createLatest } from '../../lib/latest.ts'
import {
  countryLabel,
  formatMineDate,
  mineDayLabel,
  monthCalendar,
  offsetMonthOrYear,
  validMineDay,
} from '../../lib/mineDates.ts'
import { mineEditor, openMineEditor } from '../../lib/mineEditor.ts'
import { diaryCard, isMineViewer, mineViewer } from '../../lib/minePersonal.ts'
import { platform } from '../../platform/index.ts'
import { titleActions } from '../../titleActions.ts'
import AppIcon from '../AppIcon.vue'
import FocusSection from '../FocusSection.vue'
import MineSectionHeader from '../MineSectionHeader.vue'
import OptionsPanel from '../OptionsPanel.vue'
import PosterCard from '../PosterCard.vue'
import ScreenState from '../ScreenState.vue'

const props = defineProps<{ today: string }>()
const emit = defineEmits<{
  open: [card: Card, opener: HTMLElement]
  diary: [filter: DiaryFilter, scope?: DiaryScope]
  watched: [scope: WatchedScope]
}>()
const { locale, t } = useI18n()
const { formatRuntime } = useTitleMeta()
const language = useCatalogLanguage()
const focus = useFocus()
const browser = platform === 'web'
const periodButton = ref<HTMLElement>()
const scroll = ref<HTMLElement>()
const active = ref(false)
const monthPanel = ref(false)
const monthRequest = createLatest()
const selectedPeriod = ref(props.today.slice(0, 7))
const selectedDay = ref(props.today)
const visibleDay = ref(props.today)
let dayTimer: ReturnType<typeof setTimeout> | undefined
let awaitingPeriodDay: string | undefined
const months = shallowRef<PanelOption[]>([])

function query() {
  return {
    expectedProfileId: mineViewer()!.expectedProfileId,
    language: language.value,
  }
}
const {
  data: overview,
  status: overviewStatus,
  error: overviewError,
  retry: retryOverview,
  refresh: refreshOverview,
  cancel: cancelOverview,
} = useResource(
  computed(() =>
    active.value && mineViewer()
      ? `${selectedPeriod.value}|${language.value}`
      : undefined,
  ),
  (key, signal) =>
    api.mine.getMineOverview(
      { ...query(), period: key.split('|')[0] },
      { signal },
    ),
)
const today = computed(() => overview.value?.today ?? props.today)
const counts = computed(() => {
  const values: Record<string, number> = {}
  for (const item of overview.value?.days ?? []) values[item.day] = item.count
  return values
})
const dayCount = computed(() => counts.value[selectedDay.value] ?? 0)
const {
  data: day,
  status: dayStatus,
  error: lastDayError,
  retry: retryDay,
  refresh: refreshDay,
  cancel: cancelDay,
} = useResource(
  computed(() =>
    active.value
    && visibleDay.value === selectedDay.value
    && dayCount.value
    && mineViewer()
      ? `${visibleDay.value}|${language.value}`
      : undefined,
  ),
  (key, signal) =>
    api.mine.getMineDiary(
      { ...query(), day: key.split('|')[0], limit: 4 },
      { signal },
    ),
)
const dayError = computed(() =>
  dayStatus.value === 'error' ? lastDayError.value : undefined,
)
const dayEntries = computed(() => day.value?.entries ?? [])
const firstDay = computed(
  () => overview.value?.interests.source === 'ratingsAndFavorites',
)
const missingMetadata = computed(() => {
  const summary = overview.value?.interests
  return summary ? summary.titles - summary.titlesWithMetadata : 0
})
const earlierCount = computed(
  () =>
    (overview.value?.previousMarks.movies ?? 0)
    + (overview.value?.previousMarks.series ?? 0),
)
const periodScope = () => ({ month: selectedPeriod.value })
const monthLabel = computed(() =>
  formatMineDate(`${selectedPeriod.value}-01`, locale.value, {
    month: 'long',
    year: 'numeric',
  }),
)

function periodOptions(monthIds: string[]) {
  const values = new Set(monthIds)
  values.add(selectedPeriod.value)
  values.add(today.value.slice(0, 7))
  return [...values]
    .sort()
    .reverse()
    .map(id => ({
      id,
      label: formatMineDate(`${id}-01`, locale.value, {
        month: 'long',
        year: 'numeric',
      }),
      selected: id === selectedPeriod.value,
    }))
}

async function openPeriod() {
  const context = mineViewer()
  if (!context || !active.value)
    return
  months.value = periodOptions([])
  monthPanel.value = true
  const outcome = await monthRequest.run(signal =>
    api.mine.getMineDiaryMonths({ ...query(), date: 'dated' }, { signal }),
  )
  if (
    outcome.status === 'done'
    && isMineViewer(context)
    && active.value
    && monthPanel.value
  ) {
    months.value = periodOptions(
      outcome.value.months
        .map(row => row.month)
        .filter(month => month !== null),
    )
  }
}

function closePeriod(restoreFocus = true) {
  monthRequest.cancel()
  monthPanel.value = false
  if (restoreFocus)
    focus.activate('mine-preview')
}

function chooseMonth(period: string) {
  if (period !== selectedPeriod.value) {
    clearTimeout(dayTimer)
    awaitingPeriodDay = period
    selectedPeriod.value = period
    selectedDay.value = `${period}-01`
    visibleDay.value = selectedDay.value
  }
  if (scroll.value)
    scroll.value.scrollTop = 0
  closePeriod()
}

function stepMonth(offset: number) {
  const next = offsetMonthOrYear(`${selectedPeriod.value}-01`, 'month', offset)
  if (validMineDay(next, today.value))
    chooseMonth(next.slice(0, 7))
}

const stopKey = focus.onKey((action) => {
  if (
    !active.value
    || focus.current() !== periodButton.value
    || action.type !== 'move'
    || !['left', 'right'].includes(action.direction)
  ) {
    return false
  }
  stepMonth(action.direction === 'left' ? -1 : 1)
  return true
})

const metrics = computed(() => {
  const stats = overview.value?.totals
  return [
    {
      id: 'movies' as const,
      value: stats?.movies ?? 0,
      distinct: stats?.distinctMovies,
    },
    {
      id: 'episodes' as const,
      value: stats?.episodes ?? 0,
      distinct: stats?.distinctEpisodes,
    },
    { id: 'rewatches' as const, value: stats?.rewatch ?? 0 },
    { id: 'days' as const, value: stats?.days ?? 0 },
  ]
})
const calendar = computed(() =>
  monthCalendar(selectedPeriod.value, counts.value, today.value),
)
const recent = computed(() => overview.value?.recent.slice(0, 5) ?? [])
const interests = computed(() => {
  const summary = overview.value?.interests
  return [
    {
      field: 'genre' as const,
      values: (summary?.genres ?? [])
        .slice(0, 6)
        .map(row => ({ id: row.value, count: row.count, label: row.label })),
    },
    {
      field: 'country' as const,
      values: (summary?.countries ?? [])
        .slice(0, 6)
        .map(row => ({
          id: row.value,
          count: row.count,
          label: countryLabel(row.value, locale.value),
        })),
    },
  ]
})
const weekdays = computed(() => t('mine.preview.calendar.weekdays').split(','))

function openInterest(
  field: 'genre' | 'country',
  interest: { id: string | number, label: string },
) {
  const target
    = field === 'genre'
      ? { genre: Number(interest.id) }
      : { country: String(interest.id) }
  if (firstDay.value) {
    emit('watched', {
      ...target,
      source: 'ratingsAndFavorites',
      label: interest.label,
    })
  }
  else {
    emit('diary', 'all', {
      ...periodScope(),
      ...target,
      label: interest.label,
    })
  }
}

function previewDay(value: string) {
  awaitingPeriodDay = undefined
  selectedDay.value = value
  clearTimeout(dayTimer)
  const context = mineViewer()
  dayTimer = setTimeout(() => {
    if (active.value && isMineViewer(context))
      visibleDay.value = value
  }, 150)
}

function metricAction(id: 'movies' | 'episodes' | 'rewatches' | 'days') {
  if (id === 'days') {
    const selected = scroll.value?.querySelector<HTMLElement>(
      '.calendar__day--selected',
    )
    if (selected)
      focus.focusOn(selected)
    else focus.activate('mine-overview-calendar')
    return
  }
  emit('diary', id, periodScope())
}

function dayTitle(day: string, short = false) {
  return mineDayLabel(day, locale.value, t, today.value, short)
}

function dayLabel(day: string, count: number) {
  return t('mine.preview.calendar.dayLabel', {
    day: dayTitle(day),
    count,
    today: day === today.value ? t('mine.preview.calendar.today') : '',
  })
}

function entryMeta(entry: MineDiaryEntry) {
  return [
    entry.kind === 'movie'
      ? t('title.movie')
      : entry.kind === 'series'
        ? t('title.series')
        : episodeCode(entry.season, entry.episode),
    entry.kind === 'movie' && entry.metadata?.runtimeMinutes
      ? formatRuntime(entry.metadata.runtimeMinutes)
      : '',
    entry.metadata?.episodeTitle ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
}

useTitleChanges(
  () => titleActions.version,
  () => overviewStatus.value === 'ready',
  async () => {
    const context = mineViewer()
    const refreshed = await refreshOverview()
    if (!isMineViewer(context) || !active.value)
      return false
    if (dayCount.value)
      void refreshDay()
    return refreshed
  },
  () => active.value,
  () => !!mineEditor.value || monthPanel.value,
)
onActivated(() => {
  active.value = true
  visibleDay.value = selectedDay.value
})
onDeactivated(() => {
  active.value = false
  cancelOverview()
  cancelDay()
  closePeriod(false)
  clearTimeout(dayTimer)
})
watch(overview, (data) => {
  if (
    !data
    || data.period !== selectedPeriod.value
    || data.period !== awaitingPeriodDay
  ) {
    return
  }
  awaitingPeriodDay = undefined
  let latest = `${data.period}-01`
  for (const item of data.days) {
    if (item.count && item.day > latest)
      latest = item.day
  }
  selectedDay.value = latest
  visibleDay.value = latest
})
onScopeDispose(() => {
  clearTimeout(dayTimer)
  monthRequest.cancel()
  stopKey()
})
</script>

<template>
  <div class="overview">
    <MineSectionHeader :title="t('mine.preview.sections.overview')">
      <template #actions>
        <FocusSection
          name="mine-preview"
          class="overview__period"
          :edges="{ left: 'mine-sections', down: 'mine-overview-metrics' }"
          manual-scroll
        >
          <button
            ref="periodButton"
            v-focusable
            type="button"
            class="chip period-button"
            @click="openPeriod"
          >
            <AppIcon name="chevronLeft" class="chip__leading-icon" />
            {{ monthLabel }} <AppIcon name="chevronRight" />
          </button>
        </FocusSection>
      </template>
      <template #content>
        <div ref="scroll" class="overview__scroll">
          <ScreenState
            v-if="overviewError"
            :kind="overviewError"
            @retry="retryOverview"
          />
          <div
            v-if="overviewStatus === 'loading' && !overview"
            class="overview__metrics"
            aria-hidden="true"
          >
            <div
              v-for="index in 4"
              :key="index"
              class="metric metric--skeleton"
            />
          </div>
          <template v-if="overview">
            <FocusSection
              v-if="firstDay"
              name="mine-overview-metrics"
              :edges="{
                left: 'mine-sections',
                up: 'mine-preview',
                down: 'mine-overview-interests',
              }"
            >
              <h3>{{ t("mine.personal.empty.title") }}</h3>
              <p>{{ t("mine.personal.empty.text") }}</p>
              <button
                v-focusable
                type="button"
                class="action"
                @click="openMineEditor({ kind: 'log' }, focus.current())"
              >
                {{ t("mine.personal.logWatch") }}
              </button>
              <button
                v-if="earlierCount"
                v-focusable
                type="button"
                class="chip overview__earlier"
                @click="
                  emit('watched', {
                    source: 'earlierMarks',
                    label: t('mine.personal.legacyMarks'),
                  })
                "
              >
                {{ t("mine.personal.legacyMarks") }} · {{ earlierCount }}
              </button>
            </FocusSection>
            <template v-else>
              <FocusSection
                name="mine-overview-metrics"
                class="overview__metrics"
                :edges="{
                  left: 'mine-sections',
                  up: 'mine-preview',
                  down: 'mine-overview-calendar',
                }"
              >
                <div
                  v-for="metric in metrics"
                  :key="metric.id"
                  class="metric-item"
                >
                  <button
                    v-focusable
                    type="button"
                    class="metric"
                    :aria-describedby="
                      browser && metric.distinct !== undefined
                        ? `mine-overview-${metric.id}-detail`
                        : undefined
                    "
                    @click="metricAction(metric.id)"
                  >
                    <strong>{{ metric.value }}</strong>
                    <span>{{
                      t(`mine.preview.metrics.${metric.id}`, metric.value)
                    }}</span>
                  </button>
                  <span
                    v-if="browser && metric.distinct !== undefined"
                    :id="`mine-overview-${metric.id}-detail`"
                    class="metric__distinct"
                    role="tooltip"
                  >
                    {{
                      t(
                        metric.id === "movies"
                          ? "mine.personal.distinctMovies"
                          : "mine.personal.distinctEpisodes",
                        metric.distinct,
                      )
                    }}
                  </span>
                </div>
              </FocusSection>

              <div class="overview__middle">
                <section class="calendar-card">
                  <div class="calendar">
                    <span
                      v-for="weekday in weekdays"
                      :key="weekday"
                      class="calendar__weekday"
                    >{{ weekday }}</span>
                    <FocusSection
                      name="mine-overview-calendar"
                      class="calendar__days"
                      :edges="{
                        left: 'mine-sections',
                        up: 'mine-overview-metrics',
                        right: 'mine-overview-day',
                        down: 'mine-overview-recent',
                      }"
                    >
                      <template v-for="(item, index) in calendar" :key="index">
                        <span
                          v-if="!item.current"
                          class="calendar__day calendar__day--other"
                        />
                        <button
                          v-else-if="!item.future"
                          v-focusable
                          type="button"
                          class="calendar__day"
                          :class="[
                            `calendar__day--level-${Math.min(item.count, 3)}`,
                            {
                              'calendar__day--active': item.count > 0,
                              'calendar__day--selected':
                                item.day === selectedDay,
                            },
                          ]"
                          :aria-label="dayLabel(item.day, item.count)"
                          @focus="previewDay(item.day)"
                          @click="
                            item.count
                              && emit('diary', 'all', { day: item.day })
                          "
                        >
                          <span
                            class="calendar__number"
                            :class="{
                              'calendar__number--today': item.day === today,
                            }"
                          >{{ item.number }}</span>
                          <strong v-if="item.count">{{ item.count }}</strong>
                        </button>
                        <span v-else class="calendar__day">
                          <span
                            class="calendar__number"
                            :class="{
                              'calendar__number--today': item.day === today,
                            }"
                          >{{ item.number }}</span>
                        </span>
                      </template>
                    </FocusSection>
                  </div>
                </section>

                <section class="day-card">
                  <div v-if="dayEntries.length" class="day-card__entries">
                    <div
                      v-for="entry in dayEntries.slice(0, 4)"
                      :key="entry.id"
                      class="day-entry"
                    >
                      <img
                        v-if="entry.metadata?.poster"
                        :src="entry.metadata.poster"
                        alt=""
                        loading="lazy"
                      >
                      <span>
                        <strong>{{
                          entry.metadata?.title || entry.titleId
                        }}</strong>
                        <small>{{ entryMeta(entry) }}</small>
                      </span>
                    </div>
                  </div>
                  <ScreenState
                    v-else-if="dayError"
                    :kind="dayError"
                    @retry="retryDay"
                  />
                  <div v-else class="day-card__empty">
                    <AppIcon name="calendar" />
                    <p class="day-card__count">
                      <template v-if="!dayCount">
                        {{ t("mine.preview.calendar.emptyDay") }}
                      </template>
                    </p>
                  </div>
                  <FocusSection
                    v-if="dayCount"
                    name="mine-overview-day"
                    class="day-card__action"
                    :edges="{
                      left: 'mine-overview-calendar',
                      up: 'mine-overview-calendar',
                      down: 'mine-overview-recent',
                    }"
                  >
                    <button
                      v-focusable
                      type="button"
                      class="day-card__all"
                      @click="emit('diary', 'all', { day: selectedDay })"
                    >
                      {{
                        t("mine.preview.calendar.allDay", { count: dayCount })
                      }}
                    </button>
                  </FocusSection>
                </section>
              </div>

              <section class="overview__recent">
                <h3>{{ t("mine.preview.recent") }}</h3>
                <FocusSection
                  name="mine-overview-recent"
                  class="recent-row"
                  :edges="{
                    left: 'mine-sections',
                    up: 'mine-overview-calendar',
                    down: 'mine-overview-interests',
                  }"
                >
                  <div
                    v-for="entry in recent"
                    :key="entry.id"
                    class="recent-card"
                  >
                    <PosterCard
                      :card="diaryCard(entry)"
                      :actions="false"
                      @select="
                        emit(
                          'open',
                          diaryCard(entry),
                          $event.currentTarget as HTMLElement,
                        )
                      "
                    />
                    <span>{{
                      entry.calendarDay ? dayTitle(entry.calendarDay, true) : ""
                    }}</span>
                  </div>
                  <button
                    v-focusable
                    type="button"
                    class="all-diary"
                    @click="emit('diary', 'all')"
                  >
                    <strong>›</strong>
                    <span>{{ t("mine.preview.allDiary") }}</span>
                  </button>
                </FocusSection>
              </section>
            </template>
            <section
              v-if="
                missingMetadata
                  || interests.some((group) => group.values.length)
              "
              class="overview__interests"
            >
              <h3 v-if="!firstDay">
                {{ t("mine.preview.interests") }}
              </h3>
              <p v-if="firstDay" class="overview__interest-detail">
                {{ t("mine.personal.interestsSource") }}
              </p>
              <FocusSection
                v-for="group in interests.filter(
                  (group) => group.values.length,
                )"
                :key="group.field"
                :name="
                  group.field === 'genre'
                    ? 'mine-overview-interests'
                    : 'mine-overview-countries'
                "
                class="interest-row"
                :edges="{
                  left: 'mine-sections',
                  up: firstDay
                    ? 'mine-overview-metrics'
                    : group.field === 'genre'
                      ? 'mine-overview-recent'
                      : 'mine-overview-interests',
                  down:
                    group.field === 'genre'
                      ? 'mine-overview-countries'
                      : undefined,
                }"
              >
                <button
                  v-for="interest in group.values"
                  :key="interest.id"
                  v-focusable
                  type="button"
                  class="interest-chip"
                  @click="openInterest(group.field, interest)"
                >
                  {{ interest.label }} · {{ interest.count }}
                </button>
              </FocusSection>
              <p v-if="missingMetadata" class="overview__interest-detail">
                {{ t("mine.personal.metadataMissing", { n: missingMetadata }) }}
              </p>
            </section>
          </template>
        </div>
      </template>
    </MineSectionHeader>
    <OptionsPanel
      v-if="monthPanel"
      :title="monthLabel"
      :options="months"
      @select="chooseMonth"
      @close="closePeriod"
    />
  </div>
</template>

<style scoped>
.overview {
  position: relative;
  height: 100%;
}

.overview__scroll {
  position: absolute;
  top: calc(var(--mine-content-top) - var(--focus-ring-gap));
  right: calc(var(--focus-ring-gap) * -1);
  bottom: 0;
  left: calc(var(--focus-ring-gap) * -1);
  padding: var(--focus-ring-gap) var(--focus-ring-gap) var(--safe-y);
  overflow-y: auto;
  scroll-padding: var(--focus-ring-gap);
}

.overview__scroll::-webkit-scrollbar {
  display: none;
}

.overview__period {
  display: flex;
}

.metric,
.calendar__day,
.all-diary,
.interest-chip {
  border: 0;
  color: inherit;
  font: inherit;
}

.period-button {
  min-width: calc(var(--u) * 270);
  margin-right: 0;
}

.overview__metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-gap: calc(var(--u) * 18);
}

.metric {
  display: block;
  width: 100%;
  height: calc(var(--u) * 152);
  padding: calc(var(--u) * 18) calc(var(--u) * 24);
  border-radius: calc(var(--u) * 18);
  background: var(--color-surface-raised);
  text-align: left;
}

.metric strong,
.metric span {
  display: block;
}

.metric strong {
  color: var(--color-accent);
  font-size: var(--font-size-xl);
  line-height: 0.85;
}

.metric span {
  margin-top: calc(var(--u) * 12);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.overview__middle {
  --calendar-day-size: calc(var(--u) * 80);
  display: grid;
  /* Семь ячеек, шесть зазоров по 4u, поля по 20u и две границы по 1px. */
  grid-template-columns:
    calc(var(--calendar-day-size) * 7 + var(--u) * 64 + 2px)
    minmax(0, 1fr);
  grid-gap: calc(var(--u) * 20);
  margin-top: calc(var(--u) * 16);
}

.calendar-card,
.day-card {
  height: calc(var(--u) * 592);
  padding: calc(var(--u) * 20);
  border: 1px solid rgba(242, 244, 248, 0.08);
  border-radius: calc(var(--u) * 18);
  background: var(--color-surface);
}

.day-card {
  position: relative;
  padding: calc(var(--u) * 12);
}

.calendar {
  display: grid;
  grid-template-columns: repeat(7, var(--calendar-day-size));
  grid-gap: calc(var(--u) * 4);
}

.calendar__weekday {
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
  text-align: center;
}

.calendar__days {
  display: contents;
}

.calendar__day {
  position: relative;
  height: var(--calendar-day-size);
  border-radius: calc(var(--u) * 9);
  background: transparent;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
}

.calendar__day--active {
  padding: 0;
  color: var(--color-text);
}

.calendar__day--active strong {
  position: absolute;
  right: calc(var(--u) * 3);
  bottom: calc(var(--u) * 3);
  min-width: calc(var(--u) * 30);
  padding: 0 calc(var(--u) * 3);
  border-radius: calc(var(--u) * 16);
  background: rgba(0, 0, 0, 0.65);
  color: var(--color-text);
  font-size: var(--font-size-s);
  line-height: 1.15;
}

.calendar__number {
  transform: translateY(calc(var(--u) * -8));
}

.calendar__day--level-1 {
  background: rgba(232, 184, 74, 0.14);
}

.calendar__day--level-2 {
  background: rgba(232, 184, 74, 0.25);
}

.calendar__day--level-3 {
  background: rgba(232, 184, 74, 0.38);
}

.calendar__day--selected:not(:focus) {
  box-shadow: inset 0 calc(var(--u) * -3) 0 var(--color-accent);
}

.calendar__number--today {
  color: var(--color-accent);
  font-weight: 700;
}

.day-card__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}

.day-card__empty .icon {
  margin-bottom: calc(var(--u) * 16);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 64);
}

.day-card__count {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.day-entry {
  display: flex;
  align-items: center;
  height: calc(var(--u) * 96);
}

.day-entry img {
  width: calc(var(--u) * 36);
  height: calc(var(--u) * 54);
  border-radius: calc(var(--u) * 5);
  object-fit: cover;
}

.day-entry > span {
  display: block;
  flex: 1;
  min-width: 0;
  margin-left: calc(var(--u) * 12);
}

.day-entry strong,
.day-entry small {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.day-entry strong {
  flex: 1;
  min-width: 0;
  font-size: var(--font-size-m);
}

.day-entry small {
  flex-shrink: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  white-space: normal;
  text-overflow: clip;
}

.day-card__action {
  position: absolute;
  right: calc(var(--u) * 12);
  bottom: calc(var(--u) * 12);
  left: calc(var(--u) * 12);
}

.day-card__all {
  width: 100%;
  height: calc(var(--u) * 44);
  border: 0;
  border-radius: calc(var(--u) * 10);
  background: var(--color-surface-raised);
  color: inherit;
  font: inherit;
  font-size: var(--font-size-s);
}

.day-card__all:focus {
  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--focus-scale));
}

.overview__recent,
.overview__interests {
  margin-top: calc(var(--u) * 16);
}

.overview__recent h3,
.overview__interests h3 {
  margin: 0 0 calc(var(--u) * 12);
  font-size: var(--font-size-m);
}

.overview__interest-detail {
  margin: 0 0 calc(var(--u) * 12);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.recent-row,
.interest-row {
  display: flex;
  align-items: flex-start;
}

.recent-row {
  --poster-width: calc(var(--u) * 160);
}

.recent-card {
  width: var(--poster-width);
  flex-shrink: 0;
  margin-right: calc(var(--u) * 24);
}

.recent-card > span {
  display: block;
  margin-top: calc(var(--u) * 8);
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  white-space: nowrap;
}

.all-diary {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 160);
  height: calc(var(--u) * 240);
  border-radius: calc(var(--u) * 14);
  background: var(--color-surface-raised);
  flex-direction: column;
}

.all-diary strong {
  color: var(--color-accent);
  font-size: var(--font-size-xl);
}

.all-diary span {
  margin-top: calc(var(--u) * 8);
  font-size: var(--font-size-s);
}

.interest-chip {
  min-height: calc(var(--u) * 54);
  margin-right: calc(var(--u) * 14);
  padding: 0 calc(var(--u) * 20);
  border-radius: calc(var(--u) * 14);
  background: var(--color-surface-raised);
  font-size: var(--font-size-s);
  white-space: nowrap;
}

.interest-row {
  flex-wrap: wrap;
  margin-top: calc(var(--u) * 16);
}

.interest-chip {
  margin-bottom: calc(var(--u) * 12);
}

.period-button:focus,
.metric:focus,
.calendar__day:focus,
.all-diary:focus,
.interest-chip:focus {
  background: var(--color-focus);
  color: var(--color-bg);
  outline: 0;
  transform: scale(var(--focus-scale));
}

.metric:focus strong,
.metric:focus span,
.all-diary:focus strong {
  color: inherit;
}

.calendar__day:focus {
  background: var(--color-surface-raised);
  color: var(--color-text);
  outline: var(--focus-ring-width) solid var(--color-focus);
  outline-offset: calc(var(--u) * 2);
}
.metric--skeleton {
  opacity: 0.5;
}

.metric-item {
  position: relative;
  min-width: 0;
}

.metric__distinct {
  position: absolute;
  z-index: 1;
  top: 100%;
  left: 0;
  padding: calc(var(--u) * 8) calc(var(--u) * 12);
  border-radius: calc(var(--u) * 9);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font-size: var(--font-size-s);
  visibility: hidden;
  white-space: nowrap;
}

.metric-item:hover .metric__distinct,
.metric:focus + .metric__distinct {
  visibility: visible;
}

.overview__earlier {
  margin-left: var(--space-2);
}
</style>
