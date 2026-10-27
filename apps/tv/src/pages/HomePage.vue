<script setup lang="ts">
import type {
  Card,
  ContinueCard as ContinueItem,
  EpisodeCard,
  FileCard as FileItem,
  HomeRow,
  ReleaseCard as ReleaseItem,
} from '@torsher/api-client'
import type { ComponentPublicInstance } from 'vue'
import type { RailItemId } from '../components/AppRail.vue'
import type { HomeMode } from '../composables/useHome.ts'
import type { FocusVia, SectionEdges } from '../focus/index.ts'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AllCard from '../components/AllCard.vue'
import AppRail from '../components/AppRail.vue'
import BackdropLayer from '../components/BackdropLayer.vue'
import ContentRow from '../components/ContentRow.vue'
import ContinueCard from '../components/ContinueCard.vue'
import FocusSection from '../components/FocusSection.vue'
import HeroPanel from '../components/HeroPanel.vue'
import NewEpisodeCard from '../components/NewEpisodeCard.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import AppToast from '../components/AppToast.vue'
import EpisodeListCard from '../components/EpisodeListCard.vue'
import FileCard from '../components/FileCard.vue'
import ReleaseCard from '../components/ReleaseCard.vue'
import ReleasePanel from '../components/ReleasePanel.vue'
import ScreenState from '../components/ScreenState.vue'
import TopCard from '../components/TopCard.vue'
import { useHero } from '../composables/useHero.ts'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useHome } from '../composables/useHome.ts'
import { useReleaseTexts } from '../composables/useReleaseTexts.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { useFocus } from '../focus/index.ts'
import { continueOrder, libraryRoute, resumeRoute } from '../lib/continue.ts'
import {
  noteReleaseOutcome,
  releaseMatch,
  setReleaseTitle,
} from '../releaseMatch.ts'
import { mineQueryOf, mineTargetOf } from '../lib/mineView.ts'
import { titleActions } from '../titleActions.ts'
import { firstVisibleRow, stackOffset } from '../lib/rowStack.ts'

defineOptions({ name: 'HomePage' })

const props = defineProps<{ mode: HomeMode }>()

const RAIL_ITEM: Record<HomeMode, RailItemId> = {
  all: 'home',
  movies: 'movies',
  series: 'series',
  library: 'library',
}
const SKELETON_ROWS = 2
const SKELETON_CARDS = 7

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const { status, rows, loads, error, retry, refresh, refreshContinue } = useHome(
  computed(() => props.mode),
)
const { hero, show, clear: clearHero } = useHero()
const releaseTexts = useReleaseTexts()

const railItem = computed(() => RAIL_ITEM[props.mode])
const railSection = computed(() => `rail-${railItem.value}`)

// Ряд, под который выставлен экран: меняется от пульта и колеса, не от наведения
const aligned = ref(0)
const firstVisible = ref(0)
const rowsElement = ref<HTMLElement>()
const {
  native: nativeScroll,
  offset: rowsOffset,
  alignTo: scrollRowsTo,
  onScroll: onRowsScroll,
  transform: rowsTransform,
} = useStackScroll(rowsElement)
const lastSection = ref<string>()
const rowElements: (HTMLElement | undefined)[] = []

// У рядов подборок один id: секцию и ключ различает подборка
function rowKey(row: HomeRow) {
  return row.kind !== 'continue' && 'ref' in row && row.ref
    ? `${row.id}-${row.ref}`
    : row.id
}

function sectionOf(row: HomeRow) {
  return `home-${props.mode}-${rowKey(row)}`
}

function rowTitle(row: HomeRow) {
  return ('name' in row && row.name) || t(row.title)
}

// Ряд серий 16:9 держит карточки серий, «Продолжить» и раздачи без тайтла —
// свои карточки 16:9, остальные — постеры
// Первая плитка ряда «Домашнее видео»: весь раздел — «По датам» и «Альбомы»
const HOME_VIDEO_TILE = { tile: 'homeVideo' } as const
// Последняя плитка ряда, за которым осталось больше: весь список в «Моё»
const ALL_TILE = { tile: 'all' } as const

type Tile = typeof HOME_VIDEO_TILE | typeof ALL_TILE
type RowItem
  = Card | ContinueItem | EpisodeCard | ReleaseItem | FileItem | Tile

function itemsOf(row: HomeRow): RowItem[] {
  if (row.kind === 'files' && row.id === 'libraryHomeVideo')
    return [HOME_VIDEO_TILE, ...row.items]

  if (row.kind === 'releases' || row.kind === 'files')
    return row.items

  if (row.kind === 'episodes')
    return row.episodes ?? []

  const items: RowItem[] = row.items

  return mineTargetOf(row, props.mode) ? [...items, ALL_TILE] : items
}

function isEpisode(item: RowItem): item is EpisodeCard {
  return 'titleId' in item
}

function isRelease(item: RowItem): item is ReleaseItem {
  return 'torrentId' in item
}

function isFile(item: RowItem): item is FileItem {
  return 'thumb' in item
}

function isTile(item: RowItem): item is Tile {
  return 'tile' in item
}

// Hero серии — её сериал, раздачи без тайтла — подсказка, если она есть
function heroCardOf(
  item: Exclude<RowItem, ReleaseItem | FileItem | Tile>,
): Card {
  return isEpisode(item)
    ? {
        id: item.titleId,
        kind: 'series',
        title: item.title,
        originalTitle: item.title,
      }
    : item
}

// «Продолжить» с новым порядком тайтлов пересоздаётся: просмотренный тайтл
// встаёт первым, без съезжающих карточек. Секция ряда остаётся той же
function renderKey(row: HomeRow) {
  return row.kind === 'continue'
    ? `continue:${continueOrder(rows.value)}`
    : rowKey(row)
}

function edgesOf(index: number): SectionEdges {
  const above = rows.value[index - 1]
  const below = rows.value[index + 1]

  return {
    left: railSection.value,
    up: above && sectionOf(above),
    down: below && sectionOf(below),
  }
}

// В вебе ряды прокручивают колесом мимо выравнивания: картинки — от верхнего видимого
const topVisibleRow = computed(() => {
  if (!nativeScroll)
    return aligned.value

  const tops = rows.value.map((_, index) => rowElements[index]?.offsetTop ?? 0)

  return Math.min(
    firstVisibleRow(tops, rowsOffset.value),
    rows.value.length - 1,
  )
})

// Картинки держат только ряды рядом с фокусным (в вебе — с видимыми): остальные их не грузят
function isNear(index: number) {
  const anchor = topVisibleRow.value

  return index >= anchor - 1 && index <= anchor + 2
}

function setRowElement(index: number) {
  return (instance: Element | ComponentPublicInstance | null) => {
    rowElements[index] = (instance as ComponentPublicInstance | null)?.$el
  }
}

const content = computed(() => {
  if (status.value === 'error' || rows.value.length === 0)
    return 'home-state'

  return lastSection.value ?? sectionOf(rows.value[0]!)
})

function alignRows() {
  const container = rowsElement.value
  const target = rowElements[aligned.value]

  if (!container || !target) {
    scrollRowsTo(0)
    firstVisible.value = 0

    return
  }

  // В вебе ряды прокручиваются в своём окне под hero и под него не заезжают
  if (nativeScroll) {
    scrollRowsTo(
      stackOffset(
        target.offsetTop,
        container.scrollHeight,
        container.clientHeight,
      ),
    )

    return
  }

  const tops = rows.value.map((_, index) => rowElements[index]?.offsetTop ?? 0)
  const next = stackOffset(
    target.offsetTop,
    container.offsetHeight,
    window.innerHeight - container.offsetTop,
  )

  scrollRowsTo(next)
  firstVisible.value = firstVisibleRow(tops, next)
}

function onFocusItem(rowIndex: number, index: number, via: FocusVia) {
  const row = rows.value[rowIndex]!

  lastSection.value = sectionOf(row)

  // Наведение не сдвигает экран; пульт и колесо ставят ряд на место фокусного
  if (via !== 'pointer')
    aligned.value = rowIndex

  const item = itemsOf(row)[index]!

  // У файла без тайтла (домашнее видео, «Без описания») описания нет — общий фон
  if (isFile(item) || isTile(item))
    clearHero()
  else if (!isRelease(item))
    show(heroCardOf(item), via)
  else if (item.suggestion)
    show(item.suggestion, via)
  else clearHero()
}

function itemKey(item: RowItem) {
  if (isTile(item))
    return `tile:${item.tile}`

  if (isRelease(item))
    return `release:${item.torrentId}`

  if (isFile(item))
    return `file:${item.id}`

  return isEpisode(item)
    ? `${item.titleId}:${item.season}:${item.episode}`
    : item.id
}

// Файл без тайтла — сразу плеер: карточки тайтла у него нет
function playFile(item: FileItem) {
  router.push(libraryRoute(item.id))
}

function open(item: Exclude<RowItem, ReleaseItem | FileItem | Tile>) {
  router.push(`/title/${isEpisode(item) ? item.titleId : item.id}`)
}

function openAll(row: HomeRow) {
  const target = mineTargetOf(row, props.mode)

  if (target)
    router.push({ path: '/mine', query: mineQueryOf(target) })
}

// «Продолжить» запускает просмотр сразу, без карточки тайтла
function resume(item: ContinueItem) {
  router.push(resumeRoute(item.id, item))
}

const heroResume = computed(() => !!hero.value && 'next' in hero.value.card)
// Hero подсказки раздачи — та же карточка, что в `suggestion`
const heroRelease = computed(() =>
  rows.value.some(
    row =>
      row.kind === 'releases'
      && row.items.some(item => item.suggestion === hero.value?.card),
  ),
)

// Раздача без тайтла: панель «Это …» / «Найти тайтл» / «Не фильм»
const release = ref<ReleaseItem>()
const releaseToast = ref('')
let releaseOrigin: HTMLElement | undefined
// Выбор из поиска «Библиотека» видит при возврате и перечитывает ряды
let seenRelease = releaseMatch.version

function openRelease(item: ReleaseItem) {
  releaseOrigin = focus.current() ?? undefined
  release.value = item
}

// Панель закрылась — фокус на карточке, с которой её открыли, если она ещё в ряду
function closeRelease() {
  release.value = undefined
  nextTick(() => {
    if (releaseOrigin?.isConnected)
      focus.focusOn(releaseOrigin)
    else restoreFocus()
  })
}

async function chooseRelease(titleId: string | null) {
  const target = release.value

  if (!target)
    return

  const outcome = await setReleaseTitle(target.torrentId, titleId)

  releaseToast.value = releaseTexts.outcomeOf(outcome)

  if (outcome === 'saved' || outcome === 'ignored') {
    seenRelease = releaseMatch.version
    closeRelease()
    void refresh()
  }
}

// Поиск в режиме выбора: тайтл выбирают там, итог — тостом здесь
function searchRelease() {
  const target = release.value

  if (!target)
    return

  release.value = undefined
  router.push({
    path: '/library/pick',
    query: { torrent: target.torrentId, q: target.query, name: target.name },
  })
}

// Экран в KeepAlive: ряды могут прийти, когда пользователь уже ушёл на другой экран
let isActive = false

function restoreFocus() {
  if (isActive)
    focus.activate(content.value)
}

watch(aligned, alignRows)

// Скелетон, который уже проявился, держится минимум: ряды и фокус ждут его
const showSkeleton = useHeldLoading(
  () => status.value === 'loading' && rows.value.length === 0,
)

watch(showSkeleton, async (value) => {
  if (value)
    return

  await nextTick()
  alignRows()
  restoreFocus()
})

// Новые ряды: экран встаёт на первый, фокус — в первый ряд. Тихое
// обновление (правка списков, «Продолжить» после плеера) оставляет экран на
// том же ряду, даже если ряды выше появились или пропали
watch([rows, loads], async ([next, count], [, prevCount]) => {
  const kept
    = count === prevCount
      ? next.findIndex(row => sectionOf(row) === lastSection.value)
      : -1

  aligned.value = Math.max(kept, 0)

  if (kept < 0)
    lastSection.value = undefined

  await nextTick()
  alignRows()
  restoreFocus()
})

// Правки «Позже» и подборок из меню видны на главной после возврата на неё
let seenVersion = titleActions.version

// Возврат из карточки и плеера: фокус на ту карточку, с которой ушли;
// «Продолжить» подтягивает свежий прогресс, правки списков — все ряды
onActivated(() => {
  isActive = true
  restoreFocus()

  if (releaseMatch.notice) {
    releaseToast.value = releaseTexts.outcomeOf(releaseMatch.notice)
    noteReleaseOutcome('')
  }

  // Ряды «Библиотеки» — свои, без каталога: дёшево перечитать при каждом
  // возврате, и новые загрузки и раздачи без тайтла видны сразу. Первый
  // показ ряды ещё грузит сам
  if (
    (props.mode === 'library' && status.value === 'ready')
    || seenVersion !== titleActions.version
    || seenRelease !== releaseMatch.version
  ) {
    seenVersion = titleActions.version
    seenRelease = releaseMatch.version
    void refresh()
  }
  else {
    void refreshContinue()
  }
})

onDeactivated(() => {
  isActive = false
})

// Колесо листает ряды от того, что на экране, а не от карточки под курсором,
// и не трогает ленты по горизонтали — куда бы ни указывал фокус (рейл, ряд ниже)
const stopWheel = focus.onWheel((direction) => {
  if (!isActive || rows.value.length === 0)
    return false

  if (direction !== 'up' && direction !== 'down')
    return true

  const row = rows.value[aligned.value + (direction === 'down' ? 1 : -1)]

  // Карточка в той же колонке: под неподвижным курсором, а не запомненная рядом
  if (row)
    focus.activate(sectionOf(row), 'wheel', focus.current())

  return true
})

onMounted(() => window.addEventListener('resize', alignRows))
onBeforeUnmount(() => {
  stopWheel()
  window.removeEventListener('resize', alignRows)
})
</script>

<template>
  <main class="home">
    <BackdropLayer :src="hero?.details?.backdrop" />

    <div class="home__hero">
      <HeroPanel
        v-if="hero"
        :hero="hero"
        :resume="heroResume"
        :release="heroRelease"
      />
    </div>

    <div
      v-if="status === 'error' && error && !showSkeleton"
      class="home__state"
    >
      <FocusSection name="home-state" :edges="{ left: railSection }" autofocus>
        <ScreenState :kind="error" @retry="retry" />
      </FocusSection>
    </div>

    <div
      v-else-if="rows.length > 0 && !showSkeleton"
      ref="rowsElement"
      class="home__rows"
      :class="{ 'home__rows--native': nativeScroll }"
      :style="{ transform: rowsTransform }"
      @scroll="onRowsScroll"
    >
      <ContentRow
        v-for="(row, index) in rows"
        :key="renderKey(row)"
        :ref="setRowElement(index)"
        :class="{ 'home__row--above': index < firstVisible }"
        :section="sectionOf(row)"
        :title="rowTitle(row)"
        :items="itemsOf(row)"
        :item-key="itemKey"
        :edges="edgesOf(index)"
        @focus-item="(item, via) => onFocusItem(index, item, via)"
      >
        <template #item="{ item, index: position }">
          <AllCard
            v-if="isTile(item) && item.tile === 'all'"
            :variant="row.kind === 'continue' ? 'wide' : 'poster'"
            :total="'total' in row ? (row.total ?? 0) : 0"
            @select="openAll(row)"
          />
          <ContinueCard
            v-else-if="row.kind === 'continue'"
            :item="item as ContinueItem"
            :load-image="isNear(index)"
            @select="resume(item as ContinueItem)"
          />
          <EpisodeListCard
            v-else-if="isTile(item)"
            :title="t('homeVideo.all')"
            :meta="t('homeVideo.count', row.kind === 'files' ? row.total : 0)"
            icon="homeVideo"
            @select="router.push('/home-video')"
          />
          <FileCard
            v-else-if="isFile(item)"
            :file="item"
            :dated="row.id === 'libraryHomeVideo'"
            :load-image="isNear(index)"
            @select="playFile(item)"
          />
          <ReleaseCard
            v-else-if="isRelease(item)"
            :release="item"
            :load-image="isNear(index)"
            @select="openRelease(item)"
          />
          <NewEpisodeCard
            v-else-if="isEpisode(item)"
            :episode="item"
            :load-image="isNear(index)"
            @select="open(item)"
          />
          <TopCard
            v-else-if="row.kind === 'top10'"
            :card="item"
            :rank="position + 1"
            :load-image="isNear(index)"
            @select="open(item)"
          />
          <PosterCard
            v-else
            :card="item"
            :load-image="isNear(index)"
            @select="open(item)"
          />
        </template>
      </ContentRow>
    </div>

    <div v-else-if="status === 'ready' && !showSkeleton" class="home__state">
      <FocusSection name="home-state" :edges="{ left: railSection }" autofocus>
        <ScreenState
          :kind="mode === 'library' ? 'libraryEmpty' : 'homeEmpty'"
          @retry="retry"
        />
      </FocusSection>
    </div>

    <div v-else class="home__rows" aria-hidden="true">
      <div v-for="row in SKELETON_ROWS" :key="row" class="home__skeleton-row">
        <span class="home__skeleton-title skeleton" />
        <div class="home__skeleton-track">
          <PosterSkeleton
            v-for="card in SKELETON_CARDS"
            :key="card"
            :caption="false"
          />
        </div>
      </div>
    </div>

    <AppRail :current="railItem" :section="railSection" :content="content" />

    <AppToast :message="releaseToast" @hide="releaseToast = ''" />
    <ReleasePanel
      v-if="release"
      :release="release"
      :subtitle="releaseTexts.factsOf(release)"
      @close="closeRelease"
      @confirm="chooseRelease"
      @search="searchRelease"
      @ignore="chooseRelease(null)"
    />
  </main>
</template>

<style scoped>
.home {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

.home__hero {
  position: absolute;
  z-index: 5;
  top: calc(var(--u) * 84);
  left: var(--content-x);
}

.home__state {
  position: absolute;
  z-index: 5;
  top: calc(var(--u) * 618);
  left: var(--content-x);
}

/* Фокусный ряд встаёт наверх области (с упором в конце), ряды под hero гаснут */
.home__rows {
  position: absolute;
  z-index: 4;
  top: calc(var(--u) * 618);
  right: 0;
  left: 0;
  transition: transform var(--motion-base) var(--motion-easing);
}

/* Веб: окно рядов под hero прокручивается нативно */
.home__rows--native {
  bottom: 0;
  overflow-y: auto;
  transition: none;
}

.home__rows--native::-webkit-scrollbar {
  display: none;
}

.home__row--above {
  opacity: 0;
  pointer-events: none;
}

.home__skeleton-row {
  margin-bottom: calc(var(--u) * 52);
  padding-left: var(--content-x);
}

.home__skeleton-title {
  display: block;
  width: calc(var(--u) * 320);
  height: var(--font-size-m);
  margin-bottom: calc(var(--u) * 18);
  border-radius: var(--radius-s);
}

.home__skeleton-track {
  display: flex;
  overflow: hidden;
}

.home__skeleton-track > * {
  margin-right: calc(var(--u) * 28);
}
</style>
