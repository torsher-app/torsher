<script setup lang="ts">
import type { FileCard as FileItem, HomeAlbum } from '@torsher/api-client'
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
import { api } from '../api.ts'
import AlbumCard from '../components/AlbumCard.vue'
import AppRail from '../components/AppRail.vue'
import FileCard from '../components/FileCard.vue'
import FocusSection from '../components/FocusSection.vue'
import ScreenState from '../components/ScreenState.vue'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useResource } from '../composables/useResource.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { useFocus } from '../focus/index.ts'
import { libraryRoute } from '../lib/continue.ts'
import { anchorSpan } from '../lib/gridWindow.ts'
import type { GridRow } from '../lib/homeVideo.ts'
import {
  albumName,
  formatMonth,
  gridRows,
  groupByMonth,
  rowAtOffset,
  rowWindow,
} from '../lib/homeVideo.ts'
import { returnedBack } from '../lib/navigation.ts'
import { stackOffset } from '../lib/rowStack.ts'

defineOptions({ name: 'HomeVideoPage' })

/**
 * Домашнее видео: «По датам» — сетка с заголовками месяцев, «Альбомы» —
 * папки. С `album` — видео одного альбома, Back возвращает к альбомам
 */
const props = defineProps<{
  libraryId?: string
  album?: string
}>()

const RAIL_SECTION = 'rail-homeVideo'
const COLUMNS = 3
// Строк в DOM до и после строки с фокусом
const ROWS_BEFORE = 3
const ROWS_AFTER = 5
// Строка с фокусом встаёт под верх окна с этим отступом (пиксели макета)
const ROW_GAP = 110

type View = 'dates' | 'albums'

const { t } = useI18n()
// Даты — в формате языка каталога (`ru-RU`), а не кода интерфейса
const locale = useCatalogLanguage()
const router = useRouter()
const focus = useFocus()
const view = ref<View>('dates')
const isAlbum = computed(() => props.album !== undefined)

const videos = useResource<FileItem[]>(
  computed(() =>
    isAlbum.value || view.value === 'dates'
      ? `${props.libraryId ?? ''}\u0000${props.album ?? ''}\u0000${isAlbum.value}`
      : undefined,
  ),
  async (_key, signal) =>
    (
      await api.library.getHomeVideos(
        isAlbum.value ? { libraryId: props.libraryId, album: props.album } : {},
        { signal },
      )
    ).items,
)

const albums = useResource<HomeAlbum[]>(
  computed(() =>
    !isAlbum.value && view.value === 'albums' ? 'albums' : undefined,
  ),
  async (_key, signal) => (await api.library.getHomeVideo({ signal })).albums,
)

const current = computed(() =>
  isAlbum.value || view.value === 'dates' ? videos : albums,
)

const months = computed(() =>
  groupByMonth(videos.data.value ?? []).map(group => ({
    ...group,
    label: group.sample
      ? formatMonth(group.sample, locale.value)
      : t('homeVideo.noDate'),
  })),
)

const gridRoot = ref<HTMLElement>()

type GridItem = FileItem | HomeAlbum

// Строки текущего вида: по датам — с заголовками месяцев, в альбоме и в
// «Альбомах» — карточки подряд
const rows = computed<GridRow<GridItem>[]>(() => {
  if (!isAlbum.value && view.value === 'albums') {
    return gridRows(
      [{ key: 'albums', items: albums.data.value ?? [] }],
      COLUMNS,
    )
  }

  if (isAlbum.value) {
    return gridRows(
      [{ key: 'album', items: videos.data.value ?? [] }],
      COLUMNS,
    )
  }

  return gridRows(months.value, COLUMNS)
})

// Сетка в окне под шапкой: строка с фокусом встаёт наверх окна
const viewport = ref<HTMLElement>()
const column = ref<HTMLElement>()
const {
  native: nativeScroll,
  offset: columnOffset,
  followsFocus,
  alignTo: scrollGridTo,
  onScroll: onColumnScroll,
  onWheel: onScreenWheel,
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
const windowed = computed(() =>
  rowWindow(kinds.value, anchors.value, ROWS_BEFORE, ROWS_AFTER, heights.value),
)
const visibleRows = computed(() =>
  rows.value.slice(windowed.value.from, windowed.value.to),
)

function isAlbumItem(item: GridItem): item is HomeAlbum {
  return 'coverId' in item
}

function itemKey(item: GridItem) {
  return isAlbumItem(item) ? `${item.libraryId}:${item.album}` : item.id
}

// Высоты строк — по DOM: размеры заданы в единицах макета и зависят от экрана
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
    header: step('.home-video__month') || heights.value.header,
    cards: step('.home-video__row') || heights.value.cards,
  }
}

watch(rows, async () => {
  await nextTick()
  measure()
})

const heading = computed(() =>
  isAlbum.value
    ? albumName(props.album ?? '') || t('homeVideo.noAlbum')
    : t('home.rows.libraryHomeVideo'),
)

const isEmpty = computed(() => {
  const resource = current.value

  return (
    resource.status.value === 'ready'
    && !(resource.data.value as unknown[] | undefined)?.length
  )
})

function play(item: FileItem) {
  router.push(libraryRoute(item.id))
}

function openAlbum(album: HomeAlbum) {
  router.push({
    path: '/home-video/album',
    query: { library: album.libraryId, album: album.album },
  })
}

function choose(next: View) {
  view.value = next
}

function alignTo(el: HTMLElement) {
  if (!column.value || !viewport.value)
    return

  followsFocus.value = true

  const gap = (window.innerWidth / 1920) * ROW_GAP
  const card = el.closest<HTMLElement>('.card') ?? el
  // Первая строка месяца — вместе с его заголовком
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

let lastCard: HTMLElement | undefined

const stopFocus = focus.onFocus((el, via) => {
  if (!gridRoot.value?.contains(el))
    return

  lastCard = el

  const row = Number(el.closest<HTMLElement>('[data-row]')?.dataset.row)

  if (Number.isFinite(row))
    focusedRow.value = row

  if (via !== 'pointer')
    alignTo(el)
})

// Фокус на чипах: окну строк держать его не нужно
watch(view, () => {
  lastCard = undefined
  focusedRow.value = 0
  followsFocus.value = false
  scrollGridTo(0)
})

onMounted(() => window.addEventListener('resize', measure))
onBeforeUnmount(() => window.removeEventListener('resize', measure))

let isActive = false

// Вернулись из плеера или альбома — на карточку, с которой ушли
onActivated(() => {
  isActive = true

  if (returnedBack(router.options.history.state) && lastCard?.isConnected) {
    focus.focusOn(lastCard)
    // Из плеера — с новой полосой просмотра
    void current.value.refresh()
    return
  }

  focus.activate(isAlbum.value ? 'home-video-grid' : 'home-video-views')
})

onDeactivated(() => {
  isActive = false
})

// Видео альбома пришли после показа экрана — фокус на первое
watch(
  () => videos.data.value,
  async (items) => {
    if (!isActive || !isAlbum.value || !items?.length)
      return

    await nextTick()

    if (!gridRoot.value?.contains(document.activeElement))
      focus.activate('home-video-grid')
  },
)

onBeforeUnmount(stopFocus)
</script>

<template>
  <main class="home-video" @wheel.passive="onScreenWheel">
    <div class="home-video__head">
      <h1 class="home-video__title">
        {{ heading }}
      </h1>
      <FocusSection
        v-if="!isAlbum"
        name="home-video-views"
        class="home-video__views"
        :edges="{ left: RAIL_SECTION, down: 'home-video-grid' }"
        autofocus
      >
        <button
          v-for="item in ['dates', 'albums'] as const"
          :key="item"
          v-focusable
          class="chip"
          :class="{ 'chip--selected': view === item }"
          type="button"
          :aria-pressed="view === item"
          @click="choose(item)"
        >
          {{ t(`homeVideo.${item}`) }}
        </button>
      </FocusSection>
    </div>

    <div ref="viewport" class="home-video__viewport">
      <div
        ref="column"
        class="home-video__column"
        :class="{ 'home-video__column--native': nativeScroll }"
        :style="{ transform: columnTransform }"
        @scroll="onColumnScroll"
      >
        <div ref="gridRoot">
          <FocusSection
            name="home-video-grid"
            manual-scroll
            :autofocus="isAlbum"
            :edges="{
              left: RAIL_SECTION,
              up: isAlbum ? undefined : 'home-video-views',
            }"
          >
            <ScreenState
              v-if="current.status.value === 'error' && current.error.value"
              :kind="current.error.value"
              @retry="current.retry()"
            />
            <p v-else-if="isEmpty" class="home-video__empty">
              {{ t("homeVideo.empty") }}
            </p>
            <!-- Окно строк: в DOM только строки вокруг фокуса, место
                 остальных держат отступы — тысячи видео не раздувают дерево ТВ -->
            <div
              v-else
              class="home-video__rows"
              :style="{
                paddingTop: `${windowed.top}px`,
                paddingBottom: `${windowed.bottom}px`,
              }"
            >
              <template v-for="(row, offset) in visibleRows" :key="row.key">
                <h2
                  v-if="row.kind === 'header'"
                  class="home-video__month"
                  :data-row="windowed.from + offset"
                >
                  {{ row.label }}
                </h2>
                <div
                  v-else
                  class="home-video__row"
                  :data-row="windowed.from + offset"
                >
                  <template v-for="item in row.items" :key="itemKey(item)">
                    <AlbumCard
                      v-if="isAlbumItem(item)"
                      :album="item"
                      @select="openAlbum(item)"
                    />
                    <FileCard v-else :file="item" dated @select="play(item)" />
                  </template>
                </div>
              </template>
            </div>
          </FocusSection>
        </div>
      </div>
    </div>

    <!-- Домашнее видео — часть «Библиотеки»: своего пункта в рейле нет -->
    <AppRail
      current="library"
      :section="RAIL_SECTION"
      content="home-video-grid"
    />
  </main>
</template>

<style scoped>
.home-video {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

.home-video__head {
  position: absolute;
  top: calc(var(--u) * 90);
  right: var(--content-x);
  left: var(--content-x);
}

.home-video__title {
  height: calc(var(--font-size-l) * var(--line-height));
  margin: 0;
  overflow: hidden;
  font-size: var(--font-size-l);
  font-weight: 700;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.home-video__views {
  display: flex;
  align-items: center;
  margin-top: calc(var(--u) * 20);
  padding: calc(var(--u) * 6) 0;
}

/* Сетка уезжает под шапку: окно обрезает её по верху; запас окна слева и
   сверху — кольцу фокуса */
.home-video__viewport {
  position: absolute;
  top: calc(var(--u) * 294 - var(--focus-ring-gap));
  right: 0;
  bottom: 0;
  left: calc(var(--content-x) - var(--focus-ring-gap));
  overflow: hidden;
}

.home-video__column {
  padding: var(--focus-ring-gap) 0 calc(var(--u) * 160) var(--focus-ring-gap);
  transition: transform var(--motion-base) var(--motion-easing);
}

.home-video__column--native {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow-y: auto;
  transition: none;
}

.home-video__column--native::-webkit-scrollbar {
  display: none;
}

/* Отступы карточек — margin: gap у flexbox появился только в Chromium 84 */
.home-video__row {
  display: flex;
  margin-bottom: calc(var(--u) * 40);
}

.home-video__row > * {
  margin-right: calc(var(--u) * 40);
}

.home-video__month {
  height: calc(var(--font-size-m) * var(--line-height));
  margin: calc(var(--u) * 12) 0 calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.home-video__empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
}
</style>
