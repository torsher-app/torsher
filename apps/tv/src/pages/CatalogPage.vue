<script setup lang="ts">
import type { Card } from '@torsher/api-client'
import type { PanelOption } from '../components/OptionsPanel.vue'
import type { ComponentPublicInstance } from 'vue'
import type { FocusVia } from '../focus/index.ts'
import type {
  CatalogFilter,
  CatalogSort,
  CatalogType,
} from '../lib/catalogFilter.ts'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import ActionButton from '../components/ActionButton.vue'
import AppIcon from '../components/AppIcon.vue'
import AppRail from '../components/AppRail.vue'
import FocusSection from '../components/FocusSection.vue'
import OptionsPanel from '../components/OptionsPanel.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import { useCatalogDiscover } from '../composables/useCatalogDiscover.ts'
import { useCatalogGenres } from '../composables/useCatalogGenres.ts'
import { useChipRibbon } from '../composables/useChipRibbon.ts'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { loaderHoldMs } from '../lib/loader.ts'
import { useFocus } from '../focus/index.ts'
import {
  CATALOG_SORTS,
  CATALOG_TYPES,
  COUNTRIES,
  DECADES,
  discoverParams,
  filterOf,
  isChanged,
  normalized,
  ORIGINAL_LANGUAGES,
  queryOf,
  RATING_STEPS,
  recentYears,
  withType,
} from '../lib/catalogFilter.ts'
import {
  hasImages,
  needsMore,
  rowAt,
  rowsOf,
  windowOf,
} from '../lib/gridWindow.ts'
import { stackOffset } from '../lib/rowStack.ts'

defineOptions({ name: 'CatalogPage' })

const COLUMNS = 6
// Две строки скелетонов: столько сетки видно до первого ответа
const SKELETON_ROWS = 2
// Оценка TMDB — бренд, не переводится
const RATING_LABEL = 'TMDB'

type Control
  = | 'type'
    | 'genre'
    | 'year'
    | 'rating'
    | 'language'
    | 'country'
    | 'studio'
    | 'keyword'
    | 'sort'

const SORT_LABEL: Record<CatalogSort, string> = {
  popularity: 'catalog.sorts.popularity',
  rating: 'catalog.sorts.rating',
  date: 'catalog.sorts.date',
}

const { t, te } = useI18n()
const route = useRoute()
const router = useRouter()
const focus = useFocus()

const RAIL_SECTION = 'rail-catalog'

// Экран живёт в KeepAlive: query чужого маршрута фильтр не меняет
const ownPath = route.path
const query = shallowRef(route.query)

watch(
  () => route.fullPath,
  () => {
    if (route.path === ownPath)
      query.value = route.query
  },
)

const filter = computed(() => filterOf(query.value))
const changed = computed(() => isChanged(filter.value))

function apply(next: CatalogFilter) {
  void router.replace({
    path: ownPath,
    query: queryOf(normalized(next)),
    state: { forward: null },
  })
}

const params = computed(() => discoverParams(filter.value))
const {
  status,
  items,
  total,
  error,
  hasMore,
  moreFailed,
  resets,
  retry,
  loadMore,
} = useCatalogDiscover(params)
const { genres } = useCatalogGenres(computed(() => filter.value.type))

// Скелетон — только пока показать нечего; прежняя выдача остаётся на экране
// и приглушается, если загрузка затянулась
const showSkeleton = useHeldLoading(
  () => status.value === 'loading' && items.value.length === 0,
)
const stale = useHeldLoading(
  () => status.value === 'loading' && items.value.length > 0,
)
const isEmpty = computed(
  () => status.value === 'ready' && items.value.length === 0,
)

// Число в шапке меняется вместе с выдачей, а не на время загрузки
const count = ref<number>()

watch(resets, () => {
  count.value = total.value
})

// TMDB отдаёт не больше 500 страниц по 20, а на большой выборке вместо точного
// числа пишет условное (20 001): выше предела показываем «больше 10 000»
const REACHABLE = 10_000

const countText = computed(() => {
  const value = count.value

  if (value === undefined)
    return ''

  if (value > REACHABLE)
    return t('catalog.countMany', { n: REACHABLE.toLocaleString() })

  return t('catalog.count', { n: value.toLocaleString() }, value)
})

// Подписи значений

function typeName(type: CatalogType) {
  return t(`catalog.types.${type}`)
}

function languageName(code: string) {
  const key = `languages.${ORIGINAL_LANGUAGES[code]}`

  return te(key) ? t(key) : code
}

function countryName(code: string) {
  const key = `countries.${code}`

  return te(key) ? t(key) : code
}

// Название из списка жанров на языке профиля, до его прихода — из query
const genreName = computed(() => {
  const genre = filter.value.genre

  if (!genre)
    return undefined

  return genres.value?.find(item => item.id === genre.id)?.name ?? genre.name
})

const periodName = computed(() => {
  const { year, decade } = filter.value

  if (year !== undefined)
    return String(year)

  return decade !== undefined ? t('catalog.decade', { decade }) : undefined
})

const ratingName = computed(() =>
  filter.value.rating
    ? t('catalog.ratingFrom', { n: filter.value.rating.min })
    : undefined,
)

interface ControlChip {
  id: Control
  label: string
  // Значение задано: чип отмечен и без фокуса
  active: boolean
}

function chip(
  id: Control,
  value: string | undefined,
  any: string,
): ControlChip {
  return {
    id,
    label: t(`catalog.control.${id}`, { value: value ?? any }),
    active: value !== undefined,
  }
}

const controls = computed<ControlChip[]>(() => {
  const value = filter.value
  const list: ControlChip[] = [
    {
      id: 'type',
      label: t('catalog.control.type', { value: typeName(value.type) }),
      active: false,
    },
    chip('genre', genreName.value, t('catalog.anyShort.genre')),
    chip('year', periodName.value, t('catalog.anyShort.year')),
    {
      ...chip('rating', ratingName.value, t('catalog.anyShort.rating')),
      label: t('catalog.control.rating', {
        source: RATING_LABEL,
        value: ratingName.value ?? t('catalog.anyShort.rating'),
      }),
    },
  ]

  // Язык аниме задан типом
  if (value.type !== 'anime') {
    list.push(
      chip(
        'language',
        value.language && languageName(value.language),
        t('catalog.anyShort.language'),
      ),
    )
  }

  list.push(
    chip(
      'country',
      value.country && countryName(value.country),
      t('catalog.anyShort.country'),
    ),
  )

  // Студия и тег приходят из карточки тайтла: выбрать их здесь не из чего
  if (value.studio)
    list.push(chip('studio', value.studio.name, ''))

  if (value.keyword)
    list.push(chip('keyword', value.keyword.name, ''))

  list.push({
    id: 'sort',
    label: t('catalog.control.sort', { value: t(SORT_LABEL[value.sort]) }),
    active: false,
  })

  return list
})

// Панель выбора

const panel = ref<Control>()
let panelOpener: HTMLElement | undefined

const panelTitle = computed(() =>
  panel.value
    ? t(`catalog.panel.${panel.value}`, { source: RATING_LABEL })
    : '',
)

function anyOption(control: Control, selected: boolean): PanelOption {
  return { id: 'any', label: t(`catalog.any.${control}`), selected }
}

const panelOptions = computed<PanelOption[]>(() => {
  const value = filter.value

  switch (panel.value) {
    case 'type':
      return CATALOG_TYPES.map(type => ({
        id: type,
        label: typeName(type),
        selected: value.type === type,
      }))
    case 'genre':
      return [
        anyOption('genre', !value.genre),
        ...(genres.value ?? (value.genre ? [value.genre] : [])).map(item => ({
          id: item.id,
          label: item.name,
          selected: value.genre?.id === item.id,
        })),
      ]
    case 'year':
      return [
        anyOption(
          'year',
          value.year === undefined && value.decade === undefined,
        ),
        ...recentYears(new Date()).map(year => ({
          id: `y${year}`,
          label: String(year),
          selected: value.year === year,
        })),
        ...DECADES.map(decade => ({
          id: `d${decade}`,
          label: t('catalog.decade', { decade }),
          selected: value.decade === decade,
        })),
      ]
    case 'rating':
      return [
        anyOption('rating', !value.rating),
        ...RATING_STEPS.map(min => ({
          id: String(min),
          label: t('catalog.ratingFrom', { n: min }),
          selected: value.rating?.min === min,
        })),
      ]
    case 'language':
      return [
        anyOption('language', !value.language),
        ...Object.keys(ORIGINAL_LANGUAGES).map(code => ({
          id: code,
          label: languageName(code),
          selected: value.language === code,
        })),
      ]
    case 'country':
      return [
        anyOption('country', !value.country),
        ...COUNTRIES.map(code => ({
          id: code,
          label: countryName(code),
          selected: value.country === code,
        })),
      ]
    case 'studio':
      return [
        anyOption('studio', !value.studio),
        ...(value.studio
          ? [{ id: value.studio.id, label: value.studio.name, selected: true }]
          : []),
      ]
    case 'keyword':
      return [
        anyOption('keyword', !value.keyword),
        ...(value.keyword
          ? [
              {
                id: value.keyword.id,
                label: value.keyword.name,
                selected: true,
              },
            ]
          : []),
      ]
    case 'sort':
      return CATALOG_SORTS.map(sort => ({
        id: sort,
        label: t(`catalog.sortOptions.${sort}`),
        selected: value.sort === sort,
      }))
    default:
      return []
  }
})

function openPanel(id: Control) {
  panelOpener = focus.current() ?? undefined
  panel.value = id
}

function closePanel() {
  panel.value = undefined

  nextTick(() => {
    if (panelOpener?.isConnected)
      focus.focusOn(panelOpener)
    else focus.activate('catalog-controls')
  })
}

function choose(id: string) {
  const value = filter.value
  const any = id === 'any'
  let next: CatalogFilter = value

  switch (panel.value) {
    case 'type':
      next = withType(value, id as CatalogType)
      break
    case 'genre': {
      // До прихода списка жанров в панели только текущий жанр
      const genre
        = genres.value?.find(item => item.id === id)
          ?? (value.genre?.id === id ? value.genre : undefined)

      next = { ...value, genre: any || !genre ? undefined : genre }
      break
    }
    case 'year':
      next = {
        ...value,
        year: id.startsWith('y') ? Number(id.slice(1)) : undefined,
        decade: id.startsWith('d') ? Number(id.slice(1)) : undefined,
      }
      break
    case 'rating':
      next = {
        ...value,
        rating: any ? undefined : { source: 'tmdb', min: Number(id) },
      }
      break
    case 'language':
      next = { ...value, language: any ? undefined : id }
      break
    case 'country':
      next = { ...value, country: any ? undefined : id }
      break
    case 'studio':
      next = { ...value, studio: any ? undefined : value.studio }
      break
    case 'keyword':
      next = { ...value, keyword: any ? undefined : value.keyword }
      break
    case 'sort':
      next = { ...value, sort: id as CatalogSort }
      break
  }

  apply(next)
  closePanel()
}

function reset() {
  apply(filterOf({}))
  focus.activate('catalog-controls')
}

// Лента чипов: все фильтры в ширину экрана не помещаются
const {
  view: chipsView,
  native: nativeChips,
  trackStyle: chipsTrackStyle,
  reveal: revealChip,
  onScroll: onChipsScroll,
} = useChipRibbon()

// Сетка: строки по COLUMNS, в DOM — окно строк вокруг опорной

interface Cell {
  key: string
  card?: Card
}

// Следующая страница сменяет хвост-скелетоны не раньше, чем проявившийся
// скелетон отдержится (`loaderHoldMs`): иначе ответ сразу после его проявления
// даёт вспышку. Отсчёт — от появления последнего скелетона хвоста: строки
// окна монтируются по мере прокрутки. Новая выдача встаёт сразу
const shownCount = ref(items.value.length)
const seenTail = new WeakSet<Element>()
let tailShownAt = 0
let tailTimer: ReturnType<typeof setTimeout> | undefined

function noteTail(instance: Element | ComponentPublicInstance | null) {
  const el = (instance as ComponentPublicInstance | null)?.$el as
    Element | undefined

  if (el && !seenTail.has(el)) {
    seenTail.add(el)
    tailShownAt = performance.now()
  }
}

watch([() => items.value.length, resets], ([length, reset], [, prevReset]) => {
  clearTimeout(tailTimer)

  const hold
    = length > shownCount.value && reset === prevReset
      ? loaderHoldMs(tailShownAt, performance.now())
      : 0

  if (hold === 0) {
    shownCount.value = length
    return
  }

  tailTimer = setTimeout(() => {
    shownCount.value = length
  }, hold)
})

// Пока есть ещё страницы, хвост сетки — скелетоны: пришедшие карточки встают
// на их место, и сетка не сдвигается
const cells = computed<Cell[]>(() => {
  const list: Cell[] = items.value
    .slice(0, shownCount.value)
    .map(card => ({ key: card.id, card }))
  const pending = hasMore.value || shownCount.value < items.value.length

  if (pending && !moreFailed.value) {
    const fill = ((COLUMNS - (list.length % COLUMNS)) % COLUMNS) + COLUMNS

    for (let index = 0; index < fill; index += 1)
      list.push({ key: `skeleton-${index}` })
  }

  return list
})

const rows = computed(() => rowsOf(cells.value, COLUMNS))
const loadedRows = computed(() => Math.ceil(items.value.length / COLUMNS))

const screen = ref<HTMLElement>()
const area = ref<HTMLElement>()
const grid = ref<HTMLElement>()
const {
  native: nativeScroll,
  offset,
  alignTo: scrollAreaTo,
  onScroll: onAreaScroll,
  transform: areaTransform,
} = useStackScroll(area)

// Строка, под которую выставлен экран: меняется от пульта и колеса, не от наведения
const aligned = ref(0)
const rowHeight = ref(0)

// В вебе сетку прокручивают колесом мимо выравнивания: окно — от верхней видимой
const anchor = computed(() =>
  nativeScroll
    ? rowAt(offset.value, rowHeight.value, rows.value.length)
    : aligned.value,
)

const view = computed(() => windowOf(anchor.value, rows.value.length))
const visibleRows = computed(() =>
  rows.value
    .slice(view.value.start, view.value.end)
    .map((cellsOfRow, index) => ({
      index: view.value.start + index,
      cells: cellsOfRow,
    })),
)

const gridPadding = computed(() => ({
  paddingTop: `${view.value.start * rowHeight.value}px`,
  paddingBottom: `${(rows.value.length - view.value.end) * rowHeight.value}px`,
}))

// На ТВ строки, ушедшие выше выровненной, гаснут: под ними чипы и шапка
function isAbove(index: number) {
  return !nativeScroll && index * rowHeight.value < offset.value - 1
}

// У всех строк одна высота: шаг — расстояние между соседними строками
function measure() {
  const list = grid.value?.querySelectorAll<HTMLElement>('.catalog__row')

  if (!list || list.length < 2)
    return

  rowHeight.value = list[1]!.offsetTop - list[0]!.offsetTop
}

function alignRow(index: number) {
  const container = area.value
  const content = grid.value

  if (!container || !content || !screen.value)
    return

  const top = index * rowHeight.value

  scrollAreaTo(
    nativeScroll
      ? stackOffset(top, container.scrollHeight, container.clientHeight)
      : stackOffset(
          top,
          content.offsetHeight,
          screen.value.clientHeight - container.offsetTop,
        ),
  )
}

function rowOf(el: HTMLElement) {
  const row = el.closest<HTMLElement>('[data-row]')

  return row ? Number(row.dataset.row) : undefined
}

function onFocusGrid(el: HTMLElement, via: FocusVia) {
  const index = rowOf(el)

  // Наведение не сдвигает экран; пульт и колесо ставят строку на место
  if (index === undefined || via === 'pointer')
    return

  if (!nativeScroll)
    aligned.value = index

  alignRow(index)
}

const stopFocus = focus.onFocus((el, via) => {
  if (!screen.value?.contains(el))
    return

  // Наведение только подсвечивает: лента под указкой не едет
  if (chipsView.value?.contains(el)) {
    if (via !== 'pointer')
      revealChip(el)
  }
  else if (area.value?.contains(el)) {
    onFocusGrid(el, via)
  }
})

watch(visibleRows, () => nextTick(measure))

// Следующая страница — заранее, пока до конца загруженного несколько строк
watch([anchor, loadedRows], () => {
  if (needsMore(anchor.value, loadedRows.value))
    void loadMore()
})

function open(card: Card) {
  router.push(`/title/${card.id}`)
}

// Фокус и экран

const content = computed(() => {
  if (status.value === 'error' || isEmpty.value)
    return 'catalog-state'

  return items.value.length > 0 ? 'catalog-grid' : 'catalog-controls'
})

let isActive = false
// Экран открыли до первого ответа: фокус ждёт в чипах и уходит в сетку с ответом
let focusPending = false

// Новая выдача: сетка — в начало. Фокус уходит в неё при открытии экрана и
// когда он не в чипах и не в панели: фильтры меняют подряд, не теряя чип.
// Пока держится скелетон, сетки ещё нет — выдача ждёт его
let resetWaiting = false

watch(resets, () => {
  if (showSkeleton.value)
    resetWaiting = true
  else void applyReset()
})

watch(showSkeleton, (value) => {
  if (value || !resetWaiting)
    return

  resetWaiting = false
  void applyReset()
})

async function applyReset() {
  aligned.value = 0
  alignRow(0)
  await nextTick()

  const current = focus.current()
  const inControls = !!chipsView.value?.contains(current ?? null)

  if (isActive && !panel.value && (focusPending || !inControls))
    focus.activate(content.value)

  focusPending = false
}

onActivated(() => {
  isActive = true
  focusPending = status.value === 'loading' && items.value.length === 0
  focus.activate(content.value)
})

onDeactivated(() => {
  isActive = false
  panel.value = undefined
})

function onResize() {
  measure()
  alignRow(anchor.value)
}

onMounted(() => window.addEventListener('resize', onResize))
onBeforeUnmount(() => {
  clearTimeout(tailTimer)
  stopFocus()
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <main ref="screen" class="catalog">
    <header class="catalog__head">
      <h1 class="catalog__title">
        {{ t("nav.catalog") }}
      </h1>
      <p class="catalog__count">
        {{ countText }}
      </p>
    </header>

    <div
      ref="chipsView"
      class="catalog__chips-view"
      :class="{ 'catalog__chips-view--native': nativeChips }"
      @scroll="onChipsScroll"
    >
      <FocusSection
        name="catalog-controls"
        manual-scroll
        class="catalog__chips"
        :style="chipsTrackStyle"
        :edges="{ left: RAIL_SECTION, down: content }"
      >
        <button
          v-for="control in controls"
          :key="control.id"
          v-focusable
          class="chip"
          :class="{ 'chip--selected': control.active }"
          type="button"
          @click="openPanel(control.id)"
        >
          {{ control.label }}
        </button>
        <!-- Сброс — значком, как в «Источниках» -->
        <button
          v-if="changed"
          v-focusable
          class="chip catalog__reset"
          type="button"
          :aria-label="t('catalog.reset')"
          :title="t('catalog.reset')"
          @click="reset"
        >
          <AppIcon name="close" />
        </button>
      </FocusSection>
    </div>

    <div
      v-if="status === 'error' && error && !showSkeleton"
      class="catalog__state"
    >
      <FocusSection
        name="catalog-state"
        :edges="{ left: RAIL_SECTION, up: 'catalog-controls' }"
      >
        <ScreenState :kind="error" @retry="retry" />
      </FocusSection>
    </div>

    <div v-else-if="isEmpty && !showSkeleton" class="catalog__state">
      <FocusSection
        name="catalog-state"
        :edges="{ left: RAIL_SECTION, up: 'catalog-controls' }"
      >
        <ScreenState kind="catalogEmpty">
          <ActionButton
            v-if="changed"
            v-focusable
            :label="t('catalog.reset')"
            @click="reset"
          />
        </ScreenState>
      </FocusSection>
    </div>

    <div
      v-else-if="items.length > 0 && !showSkeleton"
      ref="area"
      class="catalog__area"
      :class="{ 'catalog__area--native': nativeScroll }"
      :style="{ transform: areaTransform }"
      @scroll="onAreaScroll"
    >
      <div
        ref="grid"
        class="catalog__grid"
        :class="{ 'catalog__grid--stale': stale }"
        :style="gridPadding"
      >
        <FocusSection
          name="catalog-grid"
          manual-scroll
          :edges="{ up: 'catalog-controls', left: RAIL_SECTION }"
          autofocus
        >
          <div
            v-for="row in visibleRows"
            :key="row.index"
            class="catalog__row"
            :class="{ 'catalog__row--above': isAbove(row.index) }"
            :data-row="row.index"
          >
            <template v-for="cell in row.cells" :key="cell.key">
              <PosterCard
                v-if="cell.card"
                :card="cell.card"
                caption
                :load-image="hasImages(row.index, anchor)"
                @select="open(cell.card)"
              />
              <PosterSkeleton v-else :ref="noteTail" />
            </template>
          </div>

          <div v-if="moreFailed" class="catalog__more">
            <p class="catalog__more-text">
              {{ t("catalog.moreFailed") }}
            </p>
            <ActionButton
              v-focusable
              :label="t('state.retry')"
              @click="loadMore"
            />
          </div>
        </FocusSection>
      </div>
    </div>

    <div v-else class="catalog__area" aria-hidden="true">
      <div class="catalog__grid">
        <div v-for="row in SKELETON_ROWS" :key="row" class="catalog__row">
          <PosterSkeleton v-for="cell in COLUMNS" :key="cell" />
        </div>
      </div>
    </div>

    <AppRail current="catalog" :section="RAIL_SECTION" :content="content" />

    <OptionsPanel
      v-if="panel"
      :title="panelTitle"
      :options="panelOptions"
      @select="choose"
      @close="closePanel"
    />
  </main>
</template>

<style scoped>
.catalog {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

.catalog__head {
  position: absolute;
  z-index: 6;
  top: var(--safe-y);
  right: var(--safe-x);
  left: var(--content-x);
  display: flex;
  align-items: baseline;
}

.catalog__title {
  margin: 0 calc(var(--u) * 28) 0 0;
  font-size: var(--font-size-l);
  font-weight: 700;
}

/* Строка держит высоту и без числа: шапка не прыгает, когда приходит ответ */
.catalog__count {
  min-height: calc(var(--font-size-s) * var(--line-height));
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-variant-numeric: tabular-nums;
}

/* Лента чипов в окне: фокусный чип пульт держит в окне (useChipRibbon) */
.catalog__chips-view {
  position: absolute;
  z-index: 6;
  top: calc(var(--u) * 156 - var(--focus-ring-gap));
  right: 0;
  left: var(--content-x);
  padding: var(--focus-ring-gap) var(--safe-x) var(--focus-ring-gap) var(--focus-ring-gap);
  margin-left: calc(var(--focus-ring-gap) * -1);
  overflow: hidden;
}

/* position: relative — offsetLeft чипа считается от ленты */
/* Веб: окно прокручивается нативно, поля под кольцо и safe area те же */
.catalog__chips-view--native {
  overflow-x: auto;
  overflow-y: hidden;
}

.catalog__chips-view--native::-webkit-scrollbar {
  display: none;
}

/* Дорожка шириной по чипам: иначе правое поле окна не входит в прокрутку */
.catalog__chips-view--native .catalog__chips {
  width: max-content;
}

.catalog__chips {
  position: relative;
  display: flex;
  transition: transform var(--motion-base) var(--motion-easing);
}

/* Лента шире окна: чипы не сжимаются, а уезжают за край */
.catalog__chips > .chip {
  flex-shrink: 0;
}

.catalog__reset {
  justify-content: center;
  width: calc(var(--u) * 64);
  padding: 0;
}

.catalog__state {
  position: absolute;
  top: calc(var(--u) * 270);
  left: var(--content-x);
}

/* Выровненная строка встаёт под ленту чипов; строки выше гаснут */
.catalog__area {
  position: absolute;
  z-index: 4;
  top: calc(var(--u) * 246);
  right: 0;
  left: 0;
  transition: transform var(--motion-base) var(--motion-easing);
}

/* Веб: область сетки прокручивается нативно; сверху — место кольцу фокуса */
.catalog__area--native {
  bottom: 0;
  overflow-y: auto;
  transition: none;
}

.catalog__area--native::-webkit-scrollbar {
  display: none;
}

/* position: relative — offsetTop строки считается от сетки */
.catalog__grid {
  position: relative;
  padding-left: var(--content-x);
  transition: opacity var(--motion-base) var(--motion-easing);
  will-change: opacity;
}

/* Прежняя выдача, пока грузится новая: видно, что фильтр уже применяется.
   Приглушение — тоже лоадер: проявляется через --loader-delay */
.catalog__grid--stale {
  opacity: 0.4;
  transition-delay: var(--loader-delay);
}

/* grid-gap, а не gap у flex: gap для flexbox появился только в Chromium 84 */
.catalog__row {
  display: grid;
  grid-template-columns: repeat(6, var(--poster-width));
  grid-column-gap: calc(var(--u) * 34);
  padding: calc(var(--u) * 24) 0 calc(var(--u) * 12);
  transition: opacity var(--motion-base) var(--motion-easing);
  will-change: opacity;
}

.catalog__row--above {
  opacity: 0;
  pointer-events: none;
}

.catalog__more {
  display: flex;
  align-items: center;
  padding: calc(var(--u) * 24) 0 var(--safe-y);
}

.catalog__more-text {
  margin: 0 calc(var(--u) * 28) 0 0;
  color: var(--color-text-muted);
}
</style>
