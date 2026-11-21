<script setup lang="ts">
import { showMineUndo } from '../../lib/mineUndo.ts'
import type { Card } from '@torsher/api-client'
import type { DiaryDate } from '../../lib/minePersonal.ts'
import type { PanelOption } from '../OptionsPanel.vue'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api, loadErrorOf } from '../../api.ts'
import { useCatalogLanguage } from '../../composables/useCatalogLanguage.ts'
import { useFocus } from '../../focus/index.ts'
import { resolveRoute, withPlaybackCycle } from '../../lib/continue.ts'
import { createLatest } from '../../lib/latest.ts'
import {
  diaryClock,
  formatMineDate,
  offsetDay,
  offsetMonthOrYear,
  validMineDay,
} from '../../lib/mineDates.ts'
import { isMineEditor, mineEditor } from '../../lib/mineEditor.ts'
import { diaryCard, mineRequestId } from '../../lib/minePersonal.ts'
import { platform } from '../../platform/index.ts'
import { isTitleViewer, noteTitleProgress } from '../../titleActions.ts'
import AppIcon from '../AppIcon.vue'
import OptionsPanel from '../OptionsPanel.vue'
import ScreenState from '../ScreenState.vue'
import SearchField from '../SearchField.vue'

const props = defineProps<{ session: NonNullable<typeof mineEditor.value> }>()
const { t, locale } = useI18n()
const language = useCatalogLanguage()
const focus = useFocus()
const router = useRouter()
const { request, context } = props.session
const original = 'entry' in request ? request.entry : undefined
const title = shallowRef(
  'title' in request
    ? request.title
    : original
      ? diaryCard(original)
      : undefined,
)
const step = ref<'search' | 'season' | 'episode' | 'date' | 'note' | 'delete'>(
  request.kind === 'delete'
    ? 'delete'
    : request.kind === 'titleNote' || request.kind === 'diaryNote'
      ? 'note'
      : request.kind === 'cycle'
        || (request.kind === 'log'
          && title.value?.kind === 'series'
          && !request.episode)
        ? 'season'
        : request.kind === 'log' && !title.value
          ? 'search'
          : 'date',
)
const target = shallowRef(request.kind === 'log' ? request.episode : undefined)
const day = ref(original?.calendarDay ?? '')
const date = shallowRef<DiaryDate | undefined>(original?.date)
const dateControls = ref<HTMLElement>()
const dateSave = ref<HTMLButtonElement>()
const dateCancel = ref<HTMLButtonElement>()
const dateNote = ref<HTMLTextAreaElement>()
const today = ref('')
const timeZone = ref('')
const note = ref(original?.note ?? '')
const rewatch = ref(false)
const search = ref('')
const searchField = ref<HTMLInputElement>()
const results = shallowRef<Card[]>([])
const seasons = shallowRef<PanelOption[]>([])
const episodes = shallowRef<PanelOption[]>([])
const selectedSeason = ref(0)
const failure = ref<ReturnType<typeof loadErrorOf>>()
const error = ref('')
const loading = ref(false)
const saving = ref(false)
const latest = createLatest()
let receipt: { id: string, payload: string } | undefined
let searchTimer: ReturnType<typeof setTimeout> | undefined
const canUseKeyboard = platform === 'web'
const validDate = computed(
  () =>
    !!date.value
    && (date.value.precision !== 'day'
      || (!!today.value && validMineDay(date.value.day, today.value))),
)

function option(
  id: string,
  label: string,
  selected = false,
  disabled = false,
): PanelOption {
  return { id, label, selected, disabled }
}

function current() {
  return isMineEditor(props.session)
}

function query() {
  return {
    expectedProfileId: context.expectedProfileId,
    language: language.value,
  }
}

async function runLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  apply: (data: T) => void,
) {
  failure.value = undefined
  loading.value = true
  const outcome = await latest.run(load)
  if (!current() || outcome.status === 'cancelled')
    return
  loading.value = false
  if (outcome.status === 'failed')
    failure.value = loadErrorOf(outcome.error)
  else apply(outcome.value)
  await nextTick()
  if (!current())
    return
  const dayRow = step.value === 'date' ? dateRow('day') : undefined
  if (dayRow && focus.focusOn(dayRow))
    return
  if (!focus.current()?.closest('.options__panel'))
    focus.activate('options-panel')
}

function loadStep() {
  if (!current())
    return
  if (step.value === 'search') {
    if (search.value.trim()) {
      void runLoad(
        signal =>
          api.catalog.getCatalogSearch(
            { query: search.value.trim(), language: language.value },
            { signal },
          ),
        (data) => {
          results.value = data.items
        },
      )
    }
  }
  else if (step.value === 'season' && title.value) {
    const id = title.value.id
    void runLoad(
      signal =>
        api.catalog.getCatalogTitle(
          id,
          { language: language.value },
          { signal },
        ),
      (data) => {
        seasons.value = (data.seasons ?? [])
          .filter(season => season.airedEpisodeCount > 0)
          .map(season => option(String(season.number), season.name))
      },
    )
  }
  else if (step.value === 'episode' && title.value) {
    const id = title.value.id
    void runLoad(
      signal =>
        api.catalog.getCatalogSeason(
          id,
          String(selectedSeason.value),
          { language: language.value },
          { signal },
        ),
      (data) => {
        episodes.value = data.episodes
          .filter(
            episode =>
              episode.number > 0
              && (!episode.airDate
                || !today.value
                || episode.airDate <= today.value),
          )
          .map(episode =>
            option(
              String(episode.number),
              `S${selectedSeason.value}E${episode.number} · ${episode.title}`,
            ),
          )
      },
    )
  }
  else if (step.value === 'date') {
    void runLoad(
      signal =>
        api.mine.getMineBootstrap(
          { expectedProfileId: context.expectedProfileId },
          { signal },
        ),
      (data) => {
        if (data.profileId !== context.expectedProfileId)
          return
        today.value = data.today
        timeZone.value = data.timeZone
        if (!date.value)
          setDay(data.today)
        if (!day.value)
          day.value = data.today
      },
    )
  }
  else if (
    step.value === 'note'
    && title.value
    && request.kind === 'titleNote'
  ) {
    const id = title.value.id
    void runLoad(
      signal => api.mine.getMineTitlePersonal(id, query(), { signal }),
      (data) => {
        note.value = data.note ?? ''
      },
    )
  }
}

watch(
  step,
  () => {
    latest.cancel()
    clearTimeout(searchTimer)
    error.value = ''
    failure.value = undefined
    loading.value = false
    loadStep()
  },
  { immediate: true },
)
watch(
  search,
  () => {
    clearTimeout(searchTimer)
    latest.cancel()
    results.value = []
    failure.value = undefined
    loading.value = !!search.value.trim()
    searchTimer = setTimeout(loadStep, 300)
  },
  { flush: 'sync' },
)
watch(
  searchField,
  (field) => {
    if (field && current())
      focus.focusOn(field)
  },
  { flush: 'post' },
)
watch(
  dateNote,
  (field) => {
    if (field && step.value === 'note' && current())
      focus.focusOn(field)
  },
  { flush: 'post' },
)

function close(force = false) {
  if ((!force && saving.value) || mineEditor.value !== props.session)
    return
  mineEditor.value = undefined
  void nextTick(() => {
    if (
      isTitleViewer(context.viewer)
      && !mineEditor.value
      && props.session.opener?.isConnected
    ) {
      focus.focusOn(props.session.opener)
    }
  })
}

function back() {
  if (saving.value)
    return
  if (step.value === 'episode') {
    step.value = 'season'
  }
  else if (
    step.value === 'date'
    && request.kind === 'log'
    && title.value?.kind === 'series'
    && !request.episode
  ) {
    step.value = target.value ? 'episode' : 'season'
  }
  else if (
    step.value === 'season'
    && request.kind === 'log'
    && !request.title
  ) {
    title.value = undefined
    step.value = 'search'
  }
  else {
    close()
  }
}

function dateEditable() {
  return current() && step.value === 'date' && !saving.value
}

function setDay(value: string) {
  if (!dateEditable())
    return
  day.value = value
  date.value = { precision: 'day', day: value }
}

function setUnknownDate() {
  if (dateEditable())
    date.value = { precision: 'unknown' }
}

function toggleRewatch() {
  if (dateEditable())
    rewatch.value = !rewatch.value
}

function shiftDate(part: 'day' | 'month' | 'year', amount: number) {
  if (!dateEditable())
    return
  const value = day.value || today.value
  if (!validMineDay(value, today.value))
    return
  const shifted
    = part === 'day'
      ? offsetDay(value, amount)
      : offsetMonthOrYear(value, part, amount)
  if (validMineDay(shifted, today.value))
    setDay(shifted)
}

const dateParts = ['day', 'month', 'year'] as const
function dateRow(part: (typeof dateParts)[number]) {
  return dateControls.value?.querySelector<HTMLElement>(
    `[data-date-part="${part}"]`,
  )
}

function focusDateRow(event: MouseEvent) {
  if (!dateEditable())
    return
  const row = (event.currentTarget as HTMLElement).closest<HTMLElement>(
    '[data-date-part]',
  )
  if (row && !row.matches(':focus'))
    focus.focusOn(row, event.detail ? 'pointer' : 'nav')
}

function onDateWheel(part: (typeof dateParts)[number], event: WheelEvent) {
  if (canUseKeyboard || !event.deltaY || !dateEditable())
    return
  event.preventDefault()
  shiftDate(part, event.deltaY < 0 ? 1 : -1)
}

function syncDateFocus(event: FocusEvent) {
  const element = event.target
  if (
    (canUseKeyboard || element === dateNote.value)
    && (dateEditable() || (step.value === 'note' && current()))
    && element instanceof HTMLElement
    && element !== focus.current()
  ) {
    focus.focusOn(element, 'pointer')
  }
}

function keepDateTextKeys(event: KeyboardEvent) {
  const direction
    = event.key === 'ArrowDown' || event.keyCode === 40
      ? 1
      : event.key === 'ArrowUp' || event.keyCode === 38
        ? -1
        : 0
  if (!direction)
    return
  if (canUseKeyboard || event.isComposing) {
    event.stopPropagation()
    return
  }

  const field = dateNote.value
  if (!field || !current() || saving.value)
    return
  const maximum = Math.max(0, field.scrollHeight - field.clientHeight)
  const next = Math.max(
    0,
    Math.min(maximum, field.scrollTop + (direction * field.clientHeight) / 2),
  )
  // At the edge, let the usual remote navigation reach the actions/date rows.
  if (Math.abs(next - field.scrollTop) < 1)
    return
  event.preventDefault()
  event.stopPropagation()
  field.scrollTop = next
}

function focusDateWithKeys(element: HTMLElement) {
  if (focus.mode !== 'pointer')
    return focus.focusOn(element)

  const focused = focus.focusOn(element, 'pointer')
  if (focused)
    element.scrollIntoView({ block: 'nearest' })
  return focused
}

const stopDateKeys = focus.onKey((action, event) => {
  if (!current() || saving.value || action.type !== 'move')
    return false
  const selected
    = dateNote.value && event?.target === dateNote.value
      ? dateNote.value
      : focus.current()
  const { direction } = action
  if (step.value === 'note') {
    let next: HTMLElement | undefined
    if (selected === dateNote.value && direction === 'down') {
      next = dateSave.value
    }
    else if (selected === dateSave.value || selected === dateCancel.value) {
      if (direction === 'up')
        next = dateNote.value
      else if (direction === 'right' && selected === dateSave.value)
        next = dateCancel.value
      else if (direction === 'left' && selected === dateCancel.value)
        next = dateSave.value
    }
    return next ? focusDateWithKeys(next) : false
  }
  if (!dateEditable())
    return false
  const controls = dateControls.value
  if (!selected || !controls)
    return false

  const part = controls.contains(selected)
    ? dateParts.indexOf(selected.dataset.datePart as (typeof dateParts)[number])
    : -1
  const repeatButton = controls.querySelector<HTMLElement>(
    '[data-date-rewatch]',
  )
  let next: HTMLElement | null | undefined
  if (part >= 0) {
    if (direction === 'left' || direction === 'right') {
      if (canUseKeyboard && focus.mode === 'pointer')
        focusDateWithKeys(selected)
      shiftDate(dateParts[part]!, direction === 'right' ? 1 : -1)
      return true
    }
    if (direction === 'up') {
      const previous = dateParts[part - 1]
      next = previous
        ? dateRow(previous)
        : controls.querySelector<HTMLElement>('[data-date-quick]')
    }
    else {
      const following = dateParts[part + 1]
      next = following ? dateRow(following) : (repeatButton ?? dateSave.value)
    }
  }
  else if (selected === repeatButton) {
    next
      = direction === 'up'
        ? dateRow('year')
        : direction === 'down'
          ? (dateNote.value ?? dateSave.value)
          : undefined
  }
  else if (selected === dateNote.value) {
    next
      = direction === 'up'
        ? (repeatButton ?? dateRow('year'))
        : direction === 'down'
          ? dateSave.value
          : undefined
  }
  else if (selected === dateSave.value || selected === dateCancel.value) {
    if (direction === 'up') {
      next = dateNote.value ?? repeatButton ?? dateRow('year')
    }
    else if (direction === 'right' && selected === dateSave.value) {
      next = dateCancel.value
    }
    else if (direction === 'left' && selected === dateCancel.value) {
      next = dateSave.value
    }
  }
  else if (
    direction === 'down'
    && controls.contains(selected)
    && 'dateQuick' in selected.dataset
  ) {
    next = dateRow('day')
  }
  return next ? focusDateWithKeys(next) : false
})
const dateValues = computed(() => ({
  day: day.value.slice(8),
  month: day.value
    ? formatMineDate(day.value, locale.value, { month: 'short' })
    : '',
  year: day.value.slice(0, 4),
}))

function requestId(payload: object) {
  const serialized = JSON.stringify(payload)
  if (receipt?.payload !== serialized)
    receipt = { payload: serialized, id: mineRequestId() }
  return receipt.id
}

async function save() {
  if (saving.value || loading.value || !current())
    return
  const id = title.value?.id
  const point = target.value
  saving.value = true
  error.value = ''

  try {
    const body = query()
    if (request.kind === 'log' && id && date.value && validDate.value) {
      const entry = {
        target: { titleId: id, ...(point ?? { season: 0, episode: 0 }) },
        date: date.value,
        rewatch: rewatch.value,
        note: note.value.trim() || null,
      }
      const created = await api.mine.postMineDiary({
        ...body,
        ...entry,
        requestId: requestId(entry),
      })
      if (isTitleViewer(context.viewer))
        noteTitleProgress(context.viewer, id)
      if (current()) {
        close(true)
        if (created.entry) {
          showMineUndo({
            kind: 'logged',
            entryId: created.entry.id,
            day: created.entry.calendarDay,
            titleId: id,
            title: title.value?.title ?? id,
            language: language.value,
            context,
            opener: props.session.opener,
          })
        }
      }
      return
    }
    else if (request.kind === 'cycle' && id && point) {
      const cycle = await api.mine.postMineCycle(id, {
        ...body,
        ...point,
        requestId: requestId(point),
      })
      if (isTitleViewer(context.viewer))
        noteTitleProgress(context.viewer, id)
      if (current()) {
        close(true)
        void router.push(
          withPlaybackCycle(
            resolveRoute(id, cycle.target.season, cycle.target.episode),
            cycle.id,
          ),
        )
      }
      return
    }
    else if (request.kind === 'titleNote' && id) {
      await api.mine.patchMineTitlePersonal(id, {
        ...body,
        note: note.value.trim() || null,
      })
    }
    else if (request.kind === 'diaryNote' && original) {
      await api.mine.patchMineDiaryEntry(original.id, {
        ...body,
        note: note.value.trim() || null,
      })
    }
    else if (
      request.kind === 'diaryDate'
      && original
      && date.value
      && validDate.value
    ) {
      await api.mine.patchMineDiaryEntry(original.id, {
        ...body,
        date: date.value,
      })
    }
    else if (request.kind === 'delete' && original) {
      await api.mine.deleteMineDiaryEntry(original.id, {
        expectedProfileId: context.expectedProfileId,
      })
    }
    else {
      return
    }

    if (isTitleViewer(context.viewer))
      noteTitleProgress(context.viewer, id, request.kind !== 'titleNote')
    if (current())
      close(true)
  }
  catch {
    if (current())
      error.value = t('actions.errors.save')
  }
  finally {
    if (current())
      saving.value = false
  }
}

function select(id: string) {
  if (!current() || saving.value)
    return
  if (step.value === 'search') {
    title.value = results.value.find(result => result.id === id)
    if (title.value)
      step.value = title.value.kind === 'series' ? 'season' : 'date'
  }
  else if (id === 'whole') {
    target.value = undefined
    step.value = 'date'
  }
  else if (step.value === 'season') {
    selectedSeason.value = Number(id)
    step.value = 'episode'
  }
  else if (step.value === 'episode') {
    target.value = { season: selectedSeason.value, episode: Number(id) }
    if (request.kind === 'cycle')
      void save()
    else step.value = 'date'
  }
}

const options = computed(() => {
  if (step.value === 'search')
    return results.value.map(card => option(card.id, card.title))
  if (step.value === 'season') {
    return request.kind === 'log'
      ? [
          option('whole', t('mine.personal.seriesWithoutEpisodes')),
          ...seasons.value,
        ]
      : seasons.value
  }
  if (step.value === 'episode')
    return episodes.value
  return []
})
const heading = computed(() => {
  if (step.value === 'delete')
    return t('mine.personal.deleteEntry')
  if (request.kind === 'titleNote')
    return t('mine.personal.titleNote')
  if (step.value === 'note')
    return t('mine.preview.diary.actions.note')
  if (request.kind === 'cycle')
    return t('mine.personal.startingEpisode')
  return t(
    step.value === 'date' && original
      ? 'mine.personal.watchDate'
      : 'mine.personal.logWatch',
  )
})

onBeforeUnmount(() => {
  clearTimeout(searchTimer)
  latest.cancel()
  stopDateKeys()
})
</script>

<template>
  <OptionsPanel
    :key="step"
    :title="heading"
    :subtitle="title?.title"
    :options="options"
    :focus-selected="false"
    @select="select"
    @close="back"
  >
    <template v-if="step === 'search'" #top>
      <SearchField>
        <input
          ref="searchField"
          v-model="search"
          v-focusable
          class="field"
          type="search"
          :aria-label="t('search.title')"
          :placeholder="t('search.placeholder')"
          maxlength="200"
        >
      </SearchField>
    </template>
    <template
      v-if="
        step === 'date'
          || step === 'note'
          || step === 'delete'
          || failure
          || loading
          || (step === 'search' && !options.length)
      "
      #default
    >
      <ScreenState v-if="failure" :kind="failure" @retry="loadStep" />
      <template v-else-if="!loading">
        <p v-if="step === 'search' && search.trim()">
          {{ t("search.nothing") }}
        </p>
        <div
          v-if="step === 'date'"
          ref="dateControls"
          class="mine-editor"
          @focusin="syncDateFocus"
        >
          <div class="mine-editor__buttons mine-editor__quick">
            <button
              v-focusable
              type="button"
              class="chip"
              data-date-quick
              :tabindex="canUseKeyboard ? 0 : undefined"
              :aria-disabled="saving"
              @click="setDay(today)"
            >
              {{ t("mine.schedule.today") }}
            </button>
            <button
              v-focusable
              type="button"
              class="chip"
              data-date-quick
              :tabindex="canUseKeyboard ? 0 : undefined"
              :aria-disabled="saving"
              @click="setDay(offsetDay(today, -1))"
            >
              {{ t("mine.schedule.yesterday") }}
            </button>
            <button
              v-focusable
              type="button"
              class="chip"
              data-date-quick
              :tabindex="canUseKeyboard ? 0 : undefined"
              :aria-disabled="saving"
              :aria-pressed="date?.precision === 'unknown'"
              @click="setUnknownDate"
            >
              {{ t("mine.preview.diary.undated") }}
            </button>
          </div>
          <p v-if="date?.precision === 'instant' && original?.calendarDay">
            {{
              formatMineDate(original.calendarDay, locale, {
                dateStyle: "long",
              })
            }}
            · {{ diaryClock(date.instant, timeZone, locale) }}
          </p>
          <div class="mine-editor__date">
            <button
              v-for="part in dateParts"
              :key="part"
              v-focusable
              type="button"
              class="mine-editor__date-row"
              :data-date-part="part"
              :tabindex="canUseKeyboard ? 0 : undefined"
              @click="focusDateRow"
              @wheel="onDateWheel(part, $event)"
            >
              <span>{{ t(`mine.personal.dateParts.${part}`) }}</span>
              <span class="mine-editor__date-value">
                <span
                  @click.stop="
                    focusDateRow($event);
                    shiftDate(part, -1);
                  "
                ><AppIcon name="chevronLeft" /></span>
                <strong>{{
                  date?.precision === "unknown" ? "—" : dateValues[part]
                }}</strong>
                <span
                  @click.stop="
                    focusDateRow($event);
                    shiftDate(part, 1);
                  "
                ><AppIcon name="chevronRight" /></span>
              </span>
            </button>
          </div>
          <button
            v-if="request.kind === 'log'"
            v-focusable
            type="button"
            class="chip"
            data-date-rewatch
            :tabindex="canUseKeyboard ? 0 : undefined"
            :aria-disabled="saving"
            :aria-pressed="rewatch"
            :class="{ 'chip--selected': rewatch }"
            @click="toggleRewatch"
          >
            {{ t("mine.preview.diary.rewatch") }}
          </button>
        </div>

        <div
          v-if="step === 'note' || (step === 'date' && request.kind === 'log')"
          class="mine-editor"
          @focusin="syncDateFocus"
        >
          <label>
            {{
              t(
                request.kind === "titleNote"
                  ? "mine.personal.titleNote"
                  : "mine.preview.diary.actions.note",
              )
            }}
            <textarea
              ref="dateNote"
              v-model="note"
              v-focusable
              class="mine-editor__field"
              rows="8"
              maxlength="10000"
              :disabled="saving"
              :tabindex="canUseKeyboard ? 0 : undefined"
              @keydown="keepDateTextKeys"
            />
          </label>
        </div>

        <div
          v-if="step === 'date' || step === 'note' || step === 'delete'"
          class="mine-editor__buttons"
          @focusin="syncDateFocus"
        >
          <button
            ref="dateSave"
            v-focusable
            type="button"
            class="action"
            :class="{ 'action--primary': step !== 'delete' }"
            :tabindex="canUseKeyboard ? 0 : undefined"
            :aria-disabled="saving || (step === 'date' && !validDate)"
            @click="save"
          >
            {{
              t(step === "delete" ? "panel.common.delete" : "panel.common.save")
            }}
          </button>
          <button
            ref="dateCancel"
            v-focusable
            type="button"
            class="action"
            :tabindex="canUseKeyboard ? 0 : undefined"
            @click="back"
          >
            {{ t("panel.common.cancel") }}
          </button>
        </div>
      </template>
      <p v-if="error" role="alert">
        {{ error }}
      </p>
    </template>
  </OptionsPanel>
</template>

<style scoped>
.mine-editor {
  display: block;
  margin-bottom: var(--space-2);
  white-space: pre-wrap;
  overflow-wrap: break-word;
}
.mine-editor label {
  display: block;
  margin-bottom: var(--space-2);
}
.mine-editor__buttons {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  margin-bottom: var(--space-2);
}
.mine-editor__quick {
  margin-bottom: calc(var(--u) * 38);
}
.mine-editor__date {
  display: flex;
  flex-direction: column;
  margin-bottom: calc(var(--u) * 40);
}
.mine-editor__date-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: calc(var(--u) * 88);
  margin-bottom: calc(var(--u) * 12);
  padding: 0 calc(var(--u) * 24);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-m);
  font-weight: 600;
  cursor: pointer;
}
.mine-editor__date-row:focus {
  outline: 0;
  background: var(--color-focus);
  color: var(--color-bg);
}
.mine-editor__date-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-width: calc(var(--u) * 200);
}
.mine-editor__date-value > span {
  display: inline-flex;
}
.mine-editor__date-value strong {
  font: inherit;
  font-variant-numeric: tabular-nums;
}
.mine-editor__date-value .icon {
  width: calc(var(--u) * 28);
  height: calc(var(--u) * 28);
  color: var(--color-text-muted);
}
.mine-editor__date-row:focus .icon {
  color: inherit;
}
.mine-editor__buttons .action {
  min-width: calc(var(--u) * 160);
  margin-right: calc(var(--u) * 16);
  justify-content: center;
}
.mine-editor__field {
  display: block;
  width: 100%;
  margin: var(--space-1) 0 var(--space-2);
  padding: var(--space-2);
  border: 0;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  resize: none;
}
.mine-editor__field:focus {
  outline: var(--focus-ring-size) solid var(--color-focus);
}
</style>
