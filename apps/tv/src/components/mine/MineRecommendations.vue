<script setup lang="ts">
import type { Card, MineRecommendationItem } from '@torsher/api-client'
import type { RecommendationFilters } from '../../composables/useMineRecommendations.ts'
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
import { api } from '../../api.ts'
import { useCatalogLanguage } from '../../composables/useCatalogLanguage.ts'
import {
  DEFAULT_RECOMMENDATION_FILTERS,
  useMineRecommendations,
} from '../../composables/useMineRecommendations.ts'
import { useStackScroll } from '../../composables/useStackScroll.ts'
import { useTitleChanges } from '../../composables/useTitleChanges.ts'
import { mutateTitleMine } from '../../composables/useTitleMineMutation.ts'
import { useTitleMeta } from '../../composables/useTitleMeta.ts'
import { useFocus } from '../../focus/index.ts'
import { formatMineDate } from '../../lib/mineDates.ts'
import { mineEditor, openMineEditor } from '../../lib/mineEditor.ts'
import { isMineViewer, mineViewer } from '../../lib/minePersonal.ts'
import { clearMineUndo, mineUndo, showMineUndo } from '../../lib/mineUndo.ts'
import { lastRowPadding, stackOffset } from '../../lib/rowStack.ts'
import {
  knownTitleMine,
  noteTitleProgress,
  titleActions,
} from '../../titleActions.ts'
import AppIcon from '../AppIcon.vue'
import AppToast from '../AppToast.vue'
import FocusSection from '../FocusSection.vue'
import MineSectionHeader from '../MineSectionHeader.vue'
import OptionsPanel from '../OptionsPanel.vue'
import PosterCard from '../PosterCard.vue'
import PosterSkeleton from '../PosterSkeleton.vue'
import ScreenState from '../ScreenState.vue'

type FilterPanel = 'type' | 'duration' | 'genre' | 'source'

const emit = defineEmits<{ open: [card: Card, opener: HTMLElement] }>()
const { locale, t } = useI18n()
const language = useCatalogLanguage()
const focus = useFocus()
const { metaParts } = useTitleMeta()
const root = ref<HTMLElement>()
const active = ref(false)
const removed = shallowRef(new Set<string>())
const { data, filters, loading, error, read, cancelRead }
  = useMineRecommendations(active, () => {
    if (removed.value.size)
      removed.value = new Set()
  })
const typeFilter = computed(() => filters.value.kind)
const durationFilter = computed(() => filters.value.maxMinutes)
const genreFilter = computed(() => filters.value.genre)
const sourceFilter = computed(() => filters.value.source)
const panel = ref<FilterPanel>()
const actionTarget = shallowRef<MineRecommendationItem>()
const hiddenPanel = ref(false)
const hiddenLoading = ref(false)
const hiddenError = ref(false)
const hiddenTotal = ref(0)
const exclusions = shallowRef<Card[]>([])
const selectedIndex = ref(0)
const flashId = ref<string>()
const toast = ref('')
const saving = ref(false)
let panelOpener: HTMLElement | undefined
let flashTimer: ReturnType<typeof setTimeout> | undefined
let exclusionsRevision = 0

const viewport = ref<HTMLElement>()
const column = ref<HTMLElement>()
const gridRoot = ref<HTMLElement>()
const {
  native: nativeScroll,
  followsFocus,
  alignTo: scrollGridTo,
  onScroll: onColumnScroll,
  onWheel: onScreenWheel,
  transform: columnTransform,
} = useStackScroll(column, {
  wheelHeld: () =>
    !!panel.value
    || !!actionTarget.value
    || hiddenPanel.value
    || !!mineEditor.value,
})

function measureRows() {
  if (!column.value?.isConnected || !viewport.value)
    return

  const cards = gridRoot.value?.querySelectorAll<HTMLElement>(
    '[data-recommendation]',
  )
  const last = cards?.[cards.length - 1]

  column.value.style.paddingBottom = last
    ? `${lastRowPadding(viewport.value.clientHeight, last.offsetHeight, 0)}px`
    : ''
}

function alignRow(el: HTMLElement) {
  const card = el.closest<HTMLElement>('[data-recommendation]')

  if (!card || !column.value?.isConnected || !viewport.value)
    return

  measureRows()
  followsFocus.value = true

  // В Schedule оставляют место под дату. Здесь перед постером только поле фокуса.
  const gap = (window.innerWidth / 1920) * 24
  const top = Math.max(0, card.offsetTop - gap)

  scrollGridTo(
    stackOffset(
      top,
      nativeScroll ? column.value.scrollHeight : column.value.offsetHeight,
      nativeScroll ? column.value.clientHeight : viewport.value.clientHeight,
    ),
  )
}

function refreshRows() {
  measureRows()

  if (!followsFocus.value)
    return

  const cards = gridRoot.value?.querySelectorAll<HTMLElement>(
    '[data-recommendation]',
  )
  const card = cards?.[Math.min(selectedIndex.value, cards.length - 1)]

  if (card)
    alignRow(card)
  else scrollGridTo(0)
}

const filtered = computed(() =>
  (data.value?.items ?? []).filter(item => !removed.value.has(item.card.id)),
)
const selected = computed(
  () =>
    filtered.value[
      Math.min(selectedIndex.value, Math.max(0, filtered.value.length - 1))
    ],
)
const screenError = computed(() => {
  const refresh = data.value?.refresh
  if (error.value)
    return error.value
  if (refresh?.state === 'unavailable')
    return refresh.cause === 'config' ? 'notConfigured' : 'unavailable'
  return refresh?.state === 'backoff' ? 'unavailable' : undefined
})
const showSkeletons = computed(
  () =>
    !screenError.value
    && (loading.value || data.value?.refresh.state === 'pending'),
)

watch(filtered, async () => {
  const context = mineViewer()
  const previous = focus.current()
  const owned = !!previous && !!gridRoot.value?.contains(previous)
  await nextTick()
  if (!isMineViewer(context) || !active.value)
    return
  refreshRows()
  if (
    owned
    && !previous.isConnected
    && !mineEditor.value
    && !panel.value
    && !hiddenPanel.value
    && !actionTarget.value
  ) {
    focusNeighbor(selectedIndex.value)
  }
})

function optionsOf(
  key: string,
  values: readonly string[],
  selected: string,
): PanelOption[] {
  return values.map(id => ({
    id,
    label: t(`mine.preview.recommendations.${key}.${id}`),
    selected: id === selected,
  }))
}

const panelOptions = computed<PanelOption[]>(() => {
  switch (panel.value) {
    case 'type':
      return optionsOf('type', ['all', 'movie', 'series'], typeFilter.value)
    case 'duration':
      return optionsOf(
        'duration',
        ['90', '120', '150', 'any'],
        durationFilter.value,
      )
    case 'genre':
      return [
        {
          id: 'any',
          label: genreLabel(),
          selected: genreFilter.value === undefined,
        },
        ...(data.value?.genres ?? []).map(row => ({
          id: String(row.id),
          label: row.name,
          selected: genreFilter.value === row.id,
        })),
      ]
    case 'source':
      return [
        ...optionsOf(
          'source',
          ['both', 'watchlist', 'new'],
          sourceFilter.value,
        ),
        {
          id: 'hidden',
          label: t('mine.preview.recommendations.source.hidden'),
          selected: false,
        },
      ]
    default:
      return []
  }
})
const hiddenOptions = computed<PanelOption[]>(() => [
  ...exclusions.value.map(card => ({
    id: card.id,
    label: card.title,
    detail: t('mine.preview.recommendations.undo'),
    selected: false,
    disabled: saving.value,
  })),
  ...(hiddenTotal.value > exclusions.value.length && !hiddenLoading.value
    ? [{ id: 'more', label: t('catalog.nextPage'), selected: false }]
    : []),
  ...(hiddenError.value
    ? [{ id: 'retry', label: t('state.retry'), selected: false }]
    : []),
])

const actionOptions = computed<PanelOption[]>(() => [
  {
    id: 'watchlist',
    label: t('mine.preview.recommendations.actions.watchlist'),
    selected: !!(
      actionTarget.value
      && knownTitleMine(actionTarget.value.card.id)?.watchlist
    ),
    disabled: saving.value,
  },
  {
    id: 'hide',
    label: t('mine.preview.recommendations.actions.hide'),
    selected: false,
    disabled: saving.value,
  },
  {
    id: 'watched',
    label: t('mine.preview.recommendations.actions.watched'),
    selected: false,
    disabled: saving.value,
  },
])

function genreLabel(id?: number) {
  return (
    data.value?.genres.find(row => row.id === id)?.name
    ?? t('mine.preview.recommendations.genre.any')
  )
}

function reason({ reason: value }: MineRecommendationItem) {
  if (!value)
    return ''
  switch (value.kind) {
    case 'ratedSeed':
      return t('mine.preview.recommendations.reason.rated', {
        title: value.title,
        rating: value.rating,
      })
    case 'favoriteSeed':
      return t('mine.preview.recommendations.reason.favorite', {
        title: value.title,
      })
    case 'watchedSeed':
      return t('mine.preview.recommendations.reason.watched', {
        title: value.title,
      })
    case 'watchlistSince':
      return t('mine.preview.recommendations.reason.watchlist', {
        date: formatMineDate(value.day, locale.value, {
          day: 'numeric',
          month: 'long',
        }),
      })
    case 'selectedGenre':
      return t('mine.preview.recommendations.reason.genre', {
        genre: value.genre.name,
      })
  }
}

const selectedReason = computed(() =>
  selected.value ? reason(selected.value) : '',
)

function meta(item: MineRecommendationItem) {
  return metaParts({
    year: item.card.year,
    kind: item.card.kind,
    runtime: item.runtimeMinutes ?? undefined,
    seasons: [],
    genres: item.genres.map(row => row.name),
  }).join(' · ')
}

function dismissRecommendationUndo() {
  const change = mineUndo.value
  if (change?.kind === 'recommendationHidden')
    clearMineUndo(change)
}

function openPanel(next: FilterPanel) {
  dismissRecommendationUndo()
  panelOpener = focus.current() ?? undefined
  panel.value = next
}

function restorePanelOpener() {
  const context = mineViewer()
  void nextTick(() => {
    if (isMineViewer(context) && active.value && panelOpener?.isConnected)
      focus.focusOn(panelOpener)
  })
}

function closePanel() {
  panel.value = undefined
  restorePanelOpener()
}

function changeFilters(next: RecommendationFilters) {
  selectedIndex.value = 0
  followsFocus.value = false
  scrollGridTo(0)
  filters.value = next
}

function chooseFilter(id: string) {
  if (!panel.value)
    return
  if (id === 'hidden') {
    panel.value = undefined
    hiddenPanel.value = true
    void loadHidden()
    return
  }
  const next = { ...filters.value }
  if (panel.value === 'type')
    next.kind = id as typeof next.kind
  else if (panel.value === 'duration')
    next.maxMinutes = id as typeof next.maxMinutes
  else if (panel.value === 'genre')
    next.genre = id === 'any' ? undefined : Number(id)
  else next.source = id as typeof next.source
  changeFilters(next)
  closePanel()
}

function resetFilters() {
  dismissRecommendationUndo()
  changeFilters({ ...DEFAULT_RECOMMENDATION_FILTERS })
  focus.activate('mine-preview')
}

function focusNeighbor(index: number) {
  const buttons = gridRoot.value?.querySelectorAll<HTMLElement>(
    '[data-recommendation] button',
  )
  const neighbor = buttons?.[Math.min(Math.max(0, index), buttons.length - 1)]
  if (neighbor && focus.focusOn(neighbor))
    return
  if (!focus.activate('mine-recommendations-grid'))
    focus.activate('mine-preview')
}

function random() {
  if (!filtered.value.length || !active.value)
    return
  const context = mineViewer()
  const length = filtered.value.length
  const next
    = length === 1
      ? 0
      : (selectedIndex.value + 1 + Math.floor(Math.random() * (length - 1)))
        % length
  selectedIndex.value = next
  flashId.value = filtered.value[next]?.card.id
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => {
    if (isMineViewer(context) && active.value)
      flashId.value = undefined
  }, 700)
  if (isMineViewer(context))
    focusNeighbor(next)
}

function openActions(item: MineRecommendationItem) {
  dismissRecommendationUndo()
  panelOpener = focus.current() ?? undefined
  actionTarget.value = item
}

function closeActions() {
  if (saving.value)
    return
  actionTarget.value = undefined
  restorePanelOpener()
}

async function chooseAction(id: string) {
  const target = actionTarget.value
  const context = mineViewer()
  if (!target || !context || saving.value || !active.value)
    return
  if (id === 'watched') {
    actionTarget.value = undefined
    openMineEditor(
      { kind: 'log', title: target.card, episode: target.episode ?? undefined },
      panelOpener,
    )
    return
  }
  saving.value = true
  const index = filtered.value.findIndex(
    item => item.card.id === target.card.id,
  )
  try {
    if (id === 'watchlist') {
      await mutateTitleMine(
        target.card.id,
        context.viewer,
        () =>
          api.titles.patchTitleMine(
            target.card.id,
            { watchlist: true },
            { language: language.value },
          ),
        current => ({ ...current, watchlist: true }),
      )
    }
    else {
      await api.mine.patchMineTitlePersonal(target.card.id, {
        expectedProfileId: context.expectedProfileId,
        language: language.value,
        notInterested: true,
      })
      if (isMineViewer(context)) {
        cancelRead()
        noteTitleProgress(context.viewer, target.card.id, false)
      }
    }
    if (!isMineViewer(context) || !active.value)
      return
    if (id === 'hide')
      removed.value = new Set([...removed.value, target.card.id])
    actionTarget.value = undefined
    if (id === 'hide') {
      await nextTick()
      if (active.value && isMineViewer(context)) {
        focusNeighbor(index)
        showMineUndo({
          kind: 'recommendationHidden',
          titleId: target.card.id,
          title: target.card.title,
          language: language.value,
          context,
          opener: focus.current(),
        })
      }
    }
    else {
      restorePanelOpener()
    }
  }
  catch {
    if (isMineViewer(context) && active.value)
      toast.value = t('actions.errors.save')
  }
  finally {
    if (isMineViewer(context))
      saving.value = false
  }
}

async function restore(id: string) {
  const context = mineViewer()
  if (!context || !active.value || saving.value)
    return false
  saving.value = true
  try {
    await api.mine.patchMineTitlePersonal(id, {
      expectedProfileId: context.expectedProfileId,
      language: language.value,
      notInterested: false,
    })
    if (!isMineViewer(context))
      return false
    cancelRead()
    noteTitleProgress(context.viewer, id, false)
    removed.value = new Set([...removed.value].filter(value => value !== id))
    if (!active.value)
      return false
    return true
  }
  catch {
    if (isMineViewer(context) && active.value)
      toast.value = t('actions.errors.save')
    return false
  }
  finally {
    if (isMineViewer(context))
      saving.value = false
  }
}

async function loadHidden(append = false) {
  const context = mineViewer()
  if (!context || !hiddenPanel.value || hiddenLoading.value)
    return
  const token = ++exclusionsRevision
  hiddenLoading.value = true
  hiddenError.value = false
  try {
    const page = await api.mine.getMineRecommendationExclusions({
      expectedProfileId: context.expectedProfileId,
      language: language.value,
      offset: append ? exclusions.value.length : 0,
    })
    if (
      !isMineViewer(context)
      || !active.value
      || token !== exclusionsRevision
      || !hiddenPanel.value
      || page.profileId !== context.expectedProfileId
    ) {
      return
    }
    exclusions.value = append
      ? [...exclusions.value, ...page.items]
      : page.items
    hiddenTotal.value = page.total
    await nextTick()
    if (
      isMineViewer(context)
      && active.value
      && hiddenPanel.value
      && token === exclusionsRevision
      && !focus.current()?.isConnected
    ) {
      focus.activate('options-panel')
    }
  }
  catch {
    if (isMineViewer(context) && active.value && token === exclusionsRevision)
      hiddenError.value = true
  }
  finally {
    if (isMineViewer(context) && token === exclusionsRevision)
      hiddenLoading.value = false
  }
}

function closeHidden() {
  hiddenPanel.value = false
  exclusionsRevision++
  hiddenLoading.value = false
  restorePanelOpener()
}

async function restoreHidden(id: string) {
  if (id === 'more' || id === 'retry') {
    void loadHidden(id === 'more')
    return
  }
  const context = mineViewer()
  if (
    (await restore(id))
    && isMineViewer(context)
    && active.value
    && hiddenPanel.value
  ) {
    await loadHidden()
    if (
      isMineViewer(context)
      && active.value
      && hiddenPanel.value
      && !exclusions.value.length
    ) {
      closeHidden()
    }
  }
}

const stopFocus = focus.onFocus((el, via) => {
  if (!active.value || !root.value?.contains(el))
    return
  const id = el.closest<HTMLElement>('[data-recommendation]')?.dataset.recommendation
  const index = filtered.value.findIndex(item => item.card.id === id)
  if (index >= 0) {
    selectedIndex.value = index
    if (via !== 'pointer')
      alignRow(el)
  }
})

useTitleChanges(
  () => titleActions.version,
  () => !loading.value && !saving.value,
  () => read('poll'),
  () => active.value,
  () =>
    !!panel.value
    || !!actionTarget.value
    || hiddenPanel.value
    || !!mineEditor.value,
)

onActivated(() => {
  active.value = true
  window.addEventListener('resize', refreshRows)
  const context = mineViewer()
  void nextTick(() => {
    if (active.value && isMineViewer(context))
      refreshRows()
  })
})
onDeactivated(() => {
  active.value = false
  dismissRecommendationUndo()
  window.removeEventListener('resize', refreshRows)
  clearTimeout(flashTimer)
  flashId.value = undefined
  if (hiddenPanel.value) {
    exclusionsRevision++
    hiddenPanel.value = false
    hiddenLoading.value = false
  }
})
onScopeDispose(() => {
  window.removeEventListener('resize', refreshRows)
  stopFocus()
  clearTimeout(flashTimer)
})
</script>

<template>
  <div ref="root" class="recommendations" @wheel.passive="onScreenWheel">
    <MineSectionHeader :title="t('mine.preview.sections.recommendations')">
      <FocusSection
        name="mine-preview"
        class="recommendations__filters"
        :edges="{
          left: 'mine-sections',
          up: 'mine-recommendations-actions',
          down: 'mine-recommendations-grid',
        }"
        manual-scroll
      >
        <button
          v-focusable
          type="button"
          class="chip"
          @click="openPanel('type')"
        >
          {{ t(`mine.preview.recommendations.type.${typeFilter}`) }}
          <AppIcon name="chevronDown" />
        </button>
        <button
          v-focusable
          type="button"
          class="chip"
          @click="openPanel('duration')"
        >
          {{ t(`mine.preview.recommendations.duration.${durationFilter}`) }}
          <AppIcon name="chevronDown" />
        </button>
        <button
          v-focusable
          type="button"
          class="chip"
          @click="openPanel('genre')"
        >
          {{ genreLabel(genreFilter) }} <AppIcon name="chevronDown" />
        </button>
        <button
          v-focusable
          type="button"
          class="chip"
          @click="openPanel('source')"
        >
          {{ t(`mine.preview.recommendations.source.${sourceFilter}`) }}
          <AppIcon name="chevronDown" />
        </button>
      </FocusSection>
      <template #actions>
        <FocusSection
          name="mine-recommendations-actions"
          :edges="{ left: 'mine-sections', down: 'mine-preview' }"
          manual-scroll
        >
          <button
            v-if="filtered.length"
            v-focusable
            type="button"
            class="chip chip--random"
            @click="random"
          >
            <AppIcon name="shuffle" class="chip__leading-icon" />
            {{ t("mine.preview.recommendations.random") }}
          </button>
        </FocusSection>
      </template>
      <template #content>
        <div class="recommendations__content">
          <section v-if="selected" class="recommendations__hero">
            <img v-if="selected.backdrop" :src="selected.backdrop" alt="">
            <div class="recommendations__shade" />
            <div class="recommendations__hero-copy">
              <h3>{{ selected.card.title }}</h3>
              <p>{{ meta(selected) }}</p>
              <strong v-if="selectedReason">{{ selectedReason }}</strong>
            </div>
          </section>

          <div ref="viewport" class="recommendations__viewport">
            <div
              ref="column"
              class="recommendations__column"
              :class="{ 'recommendations__column--native': nativeScroll }"
              :style="{ transform: columnTransform }"
              @scroll="onColumnScroll"
            >
              <div ref="gridRoot">
                <FocusSection
                  v-if="filtered.length"
                  name="mine-recommendations-grid"
                  class="recommendations__grid"
                  manual-scroll
                  :edges="{
                    left: 'mine-sections',
                    up: 'mine-preview',
                  }"
                >
                  <div
                    v-for="item in filtered"
                    :key="item.card.id"
                    class="recommendation-card"
                    :class="{
                      'recommendation-card--flash': flashId === item.card.id,
                    }"
                    :data-recommendation="item.card.id"
                  >
                    <PosterCard
                      :card="item.card"
                      :actions="false"
                      custom-menu
                      @select="
                        emit(
                          'open',
                          item.card,
                          $event.currentTarget as HTMLElement,
                        )
                      "
                      @menu="openActions(item)"
                    />
                    <span>{{ item.card.title }}</span>
                  </div>
                </FocusSection>

                <div
                  v-else-if="showSkeletons"
                  class="recommendations__grid"
                  aria-hidden="true"
                >
                  <PosterSkeleton v-for="index in 4" :key="index" />
                </div>
                <FocusSection
                  v-else
                  name="mine-recommendations-grid"
                  class="recommendations__empty"
                  manual-scroll
                  :edges="{ left: 'mine-sections', up: 'mine-preview' }"
                >
                  <ScreenState
                    v-if="screenError"
                    :kind="screenError"
                    @retry="read()"
                  />
                  <template v-else>
                    <h3>{{ t("mine.preview.recommendations.empty.title") }}</h3>
                    <p>{{ t("mine.preview.recommendations.empty.text") }}</p>
                    <button
                      v-focusable
                      type="button"
                      class="action"
                      @click="resetFilters"
                    >
                      {{ t("mine.preview.recommendations.empty.reset") }}
                    </button>
                  </template>
                </FocusSection>
              </div>
            </div>
          </div>
        </div>

        <OptionsPanel
          v-if="panel"
          :title="t(`mine.preview.recommendations.panels.${panel}`)"
          :options="panelOptions"
          @select="chooseFilter"
          @close="closePanel"
        />

        <OptionsPanel
          v-if="hiddenPanel"
          :title="t('mine.preview.recommendations.source.hidden')"
          :options="hiddenOptions"
          @select="restoreHidden"
          @close="closeHidden"
        />
        <AppToast :message="toast" @hide="toast = ''" />
        <OptionsPanel
          v-if="actionTarget"
          :title="actionTarget.card.title"
          :options="actionOptions"
          :focus-selected="false"
          @select="chooseAction"
          @close="closeActions"
        />
      </template>
    </MineSectionHeader>
  </div>
</template>

<style scoped>
.recommendations {
  position: relative;
  height: 100%;
}

.recommendations__content {
  position: absolute;
  top: calc(var(--mine-content-top) - var(--focus-ring-gap));
  right: calc(var(--focus-ring-gap) * -1);
  bottom: 0;
  left: calc(var(--focus-ring-gap) * -1);
  display: flex;
  flex-direction: column;
  padding: var(--focus-ring-gap) var(--focus-ring-gap) 0;
}

.recommendations__viewport {
  position: relative;
  flex: 1;
  min-height: 0;
  margin: 0 calc(var(--focus-ring-gap) * -1);
  overflow: hidden;
}

.recommendations__column {
  position: relative;
  padding: var(--focus-ring-gap) var(--focus-ring-gap) calc(var(--u) * 160);
  transition: transform var(--motion-base) var(--motion-easing);
}

.recommendations__column--native {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow-y: auto;
  transition: none;
}

.recommendations__column--native::-webkit-scrollbar {
  display: none;
}

.recommendations__filters {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
}

.recommendations__filters .chip {
  padding: 0 calc(var(--u) * 20);
  font-size: var(--font-size-s);
}

.chip--random {
  margin-right: 0;
  color: var(--color-accent);
}

.recommendations__hero {
  position: relative;
  flex-shrink: 0;
  height: calc(var(--u) * 238);
  margin-top: 0;
  overflow: hidden;
  border-radius: calc(var(--u) * 20);
  background: var(--color-surface);
}

.recommendations__hero > img,
.recommendations__shade {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.recommendations__hero > img {
  object-fit: cover;
  opacity: 0.62;
}

.recommendations__shade {
  background: linear-gradient(90deg, rgba(15, 17, 22, 0.98), rgba(15, 17, 22, 0.46) 72%, rgba(15, 17, 22, 0.72));
}

.recommendations__hero-copy {
  position: relative;
  z-index: 1;
  display: flex;
  justify-content: center;
  width: 75%;
  height: 100%;
  padding: calc(var(--u) * 28);
  flex-direction: column;
}

.recommendations__hero-copy h3,
.recommendations__hero-copy p,
.recommendations__hero-copy strong {
  margin: 0;
}

.recommendations__hero-copy h3 {
  font-size: var(--font-size-l);
  line-height: 1.1;
}

.recommendations__hero-copy p,
.recommendations__hero-copy strong {
  margin-top: calc(var(--u) * 12);
  font-size: var(--font-size-s);
}

.recommendations__hero-copy p {
  color: var(--color-text-muted);
}

.recommendations__hero-copy strong {
  color: var(--color-accent);
}

.recommendations__grid {
  display: grid;
  grid-template-columns: repeat(4, var(--poster-width));
  grid-gap: calc(var(--u) * 36) calc(var(--u) * 34);
}

.recommendation-card {
  width: var(--poster-width);
  transition: opacity var(--motion-base) var(--motion-easing);
}

.recommendation-card > span {
  display: block;
  min-height: calc(var(--font-size-s) * var(--line-height));
  margin-top: calc(var(--u) * 14);
  overflow: hidden;
  font-size: var(--font-size-s);
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.recommendation-card--flash {
  opacity: 0.45;
}

.recommendations__empty {
  margin-top: calc(var(--u) * 80);
}

.recommendations__empty h3 {
  margin: 0;
  font-size: var(--font-size-l);
}

.recommendations__empty p {
  max-width: calc(var(--u) * 760);
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
}
</style>
