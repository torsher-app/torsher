<script setup lang="ts">
import type { Card, Person } from '@torsher/api-client'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import AppRail from '../components/AppRail.vue'
import FocusSection from '../components/FocusSection.vue'
import PersonCard from '../components/PersonCard.vue'
import PosterCard from '../components/PosterCard.vue'
import PosterSkeleton from '../components/PosterSkeleton.vue'
import ScreenState from '../components/ScreenState.vue'
import { useCatalogSearch } from '../composables/useCatalogSearch.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { useTrending } from '../composables/useTrending.ts'
import { useFocus } from '../focus/index.ts'
import { returnedBack } from '../lib/navigation.ts'
import { addRecent, loadRecent, saveRecent } from '../lib/recentSearches.ts'
import { stackOffset } from '../lib/rowStack.ts'

defineOptions({ name: 'SearchPage' })

// Две строки сетки: столько видно на экране без прокрутки
const SKELETON_COUNT = 8
const RAIL_SECTION = 'rail-search'
// Строка с фокусом встаёт под верх колонки с этим отступом (пиксели макета)
const ROW_GAP = 110

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const query = ref('')
const recent = ref(loadRecent())

const { status, items, people, error, retry } = useCatalogSearch(query)
const { trending } = useTrending()

const hasQuery = computed(() => query.value.trim().length > 0)
const isEmpty = computed(
  () =>
    hasQuery.value
    && status.value === 'ready'
    && items.value.length === 0
    && people.value.length === 0,
)
// Люди из того же поиска — строкой над тайтлами
const shownPeople = computed(() => (hasQuery.value ? people.value : []))
// Без запроса и при пустом результате сетка показывает популярное
const shown = computed<Card[]>(() =>
  hasQuery.value && !isEmpty.value ? items.value : (trending.value ?? []),
)
const showSkeleton = computed(
  () =>
    shown.value.length === 0 && (status.value === 'loading' || !trending.value),
)

const heading = computed(() => {
  if (!hasQuery.value)
    return t('search.popular')

  if (isEmpty.value)
    return t('search.nothing')

  return items.value.length > 0
    ? t('search.found', { n: items.value.length })
    : ''
})

// Влево и вправо в поле двигают курсор: из поля к сетке ведут вниз (через недавние)
const inputEdges = computed(() => ({
  left: RAIL_SECTION,
  down: recent.value.length > 0 ? 'search-recent' : 'search-results',
}))

const resultsEdges = computed(() => ({
  up: 'search-input',
  left: recent.value.length > 0 ? 'search-recent' : 'search-input',
}))

// Правая колонка: строка с фокусом встаёт под верх колонки (на ТВ — transform,
// в вебе колонка прокручивается нативно)
const screen = ref<HTMLElement>()
const column = ref<HTMLElement>()
const {
  native: nativeScroll,
  alignTo: scrollColumnTo,
  onScroll: onColumnScroll,
  transform: columnTransform,
} = useStackScroll(column)

function alignTo(el: HTMLElement) {
  if (!column.value || !screen.value)
    return

  const gap = (window.innerWidth / 1920) * ROW_GAP
  const card = el.closest<HTMLElement>('.poster-card, .person-card') ?? el
  const top = Math.max(0, card.offsetTop - gap)

  scrollColumnTo(
    nativeScroll
      ? stackOffset(top, column.value.scrollHeight, column.value.clientHeight)
      : stackOffset(
          top,
          column.value.offsetHeight,
          screen.value.clientHeight - column.value.offsetTop,
        ),
  )
}

const stopFocus = focus.onFocus((el, via) => {
  if (!column.value?.contains(el) || via === 'pointer')
    return

  alignTo(el)
})

// Новые результаты: колонка возвращается к началу
watch(shown, () => {
  scrollColumnTo(0)
})

// Запрос из недавних: после ответа фокус встаёт на первый результат
let focusResults = false

watch(status, async (value) => {
  if (!focusResults || value === 'loading')
    return

  focusResults = false
  await nextTick()

  if (shown.value.length > 0)
    focus.activate('search-results')
})

function pickRecent(text: string) {
  focusResults = true
  query.value = text
}

// Запрос попадает в недавние, когда из его результатов что-то открыли
function rememberQuery() {
  if (hasQuery.value && !isEmpty.value) {
    recent.value = addRecent(recent.value, query.value)
    saveRecent(recent.value)
  }
}

function open(card: Card) {
  rememberQuery()
  router.push(`/title/${card.id}`)
}

function openPerson(person: Person) {
  rememberQuery()
  router.push(`/person/${person.id}`)
}

// Открыли поиск заново (рейл) — фокус в поле, как в первый раз; вернулись из
// карточки по Back — на ту карточку, с которой ушли. «Назад» у записи может и
// не быть: рейл подменяет запись раздела, а не добавляет новую
onActivated(() => {
  if (!returnedBack(router.options.history.state)) {
    focus.activate('search-input')

    return
  }

  if (!focus.activate('search-results'))
    focus.activate('search-input')
})

onBeforeUnmount(stopFocus)
</script>

<template>
  <main ref="screen" class="search">
    <div class="search__left">
      <FocusSection name="search-input" :edges="inputEdges" autofocus>
        <label class="search__field">
          <AppIcon name="search" class="search__field-icon" />
          <input
            v-model="query"
            v-focusable
            class="field search__input"
            type="search"
            :aria-label="t('nav.search')"
            :placeholder="t('search.placeholder')"
          >
        </label>
      </FocusSection>

      <p class="search__note">
        {{ t("search.note") }}
      </p>

      <template v-if="recent.length > 0">
        <h2 class="search__label">
          {{ t("search.recent") }}
        </h2>
        <FocusSection
          name="search-recent"
          :edges="{
            up: 'search-input',
            left: RAIL_SECTION,
            right: 'search-results',
          }"
        >
          <button
            v-for="text in recent"
            :key="text"
            v-focusable
            class="recent"
            type="button"
            @click="pickRecent(text)"
          >
            <AppIcon name="recent" class="recent__icon" />
            <span class="recent__text">{{ text }}</span>
          </button>
        </FocusSection>
      </template>
    </div>

    <div
      ref="column"
      class="search__right"
      :class="{ 'search__right--native': nativeScroll }"
      :style="{ transform: columnTransform }"
      @scroll="onColumnScroll"
    >
      <FocusSection name="search-results" :edges="resultsEdges" manual-scroll>
        <ScreenState
          v-if="status === 'error' && error"
          :kind="error"
          @retry="retry"
        />
        <template v-else>
          <template v-if="shownPeople.length > 0">
            <h2 class="search__label search__label--results">
              {{ t("search.people") }}
            </h2>
            <!-- Те же четыре колонки, что у постеров: шаг вниз — в ту же колонку -->
            <div class="grid search__people">
              <PersonCard
                v-for="person in shownPeople"
                :key="person.id"
                :person="person"
                @select="openPerson(person)"
              />
            </div>
          </template>
          <h2 v-if="heading" class="search__label search__label--results">
            {{ heading }}
          </h2>
          <template v-if="isEmpty">
            <p class="search__empty">
              {{ t("search.nothingText", { query: query.trim() }) }}
            </p>
            <h2 v-if="shown.length > 0" class="search__label">
              {{ t("search.popular") }}
            </h2>
          </template>
          <div v-if="shown.length > 0" class="grid">
            <PosterCard
              v-for="item in shown"
              :key="item.id"
              :card="item"
              caption
              @select="open(item)"
            />
          </div>
          <div v-else-if="showSkeleton" class="grid">
            <PosterSkeleton v-for="index in SKELETON_COUNT" :key="index" />
          </div>
        </template>
      </FocusSection>
    </div>

    <AppRail current="search" :section="RAIL_SECTION" content="search-input" />
  </main>
</template>

<style scoped>
.search {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

.search__left {
  position: absolute;
  top: calc(var(--u) * 90);
  left: var(--content-x);
  width: calc(var(--u) * 600);
}

.search__field {
  position: relative;
  display: block;
  margin-bottom: calc(var(--u) * 18);
}

.search__field-icon {
  position: absolute;
  top: 50%;
  left: calc(var(--u) * 30);
  margin-top: calc(var(--u) * -20);
  font-size: calc(var(--u) * 40);
  pointer-events: none;
}

.search__input {
  width: 100%;
  height: calc(var(--u) * 104);
  padding: 0 calc(var(--u) * 30) 0 calc(var(--u) * 92);
  font-size: var(--font-size-l);
  font-weight: 600;
}

.search__note {
  margin: 0 0 calc(var(--u) * 40);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
  line-height: 1.45;
}

.search__label {
  margin: 0 0 calc(var(--u) * 12);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.search__label--results {
  margin-bottom: calc(var(--u) * 26);
}

/* Строка недавнего запроса: белая заливка в фокусе, как у кнопок и чипов */
.recent {
  display: flex;
  align-items: center;
  width: 100%;
  height: calc(var(--u) * 64);
  padding: 0 calc(var(--u) * 22);
  border: 0;
  border-radius: calc(var(--u) * 14);
  background: transparent;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--font-size-m);
  text-align: left;
}

.recent:focus {
  --bump-scale: var(--focus-scale);

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.recent__icon {
  margin-right: calc(var(--u) * 18);
}

.recent__text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.search__right {
  position: absolute;
  top: calc(var(--u) * 106);
  right: 0;
  left: calc(var(--u) * 840);
  padding-bottom: calc(var(--u) * 160);
  transition: transform var(--motion-base) var(--motion-easing);
}

/* Веб: колонка результатов прокручивается нативно */
.search__right--native {
  bottom: 0;
  overflow-y: auto;
  transition: none;
}

.search__right--native::-webkit-scrollbar {
  display: none;
}

.search__empty {
  max-width: calc(var(--u) * 960);
  margin: 0 0 calc(var(--u) * 48);
  color: var(--color-text-muted);
}

/* grid-gap, а не gap у flex: gap для flexbox появился только в Chromium 84 */
.grid {
  display: grid;
  grid-template-columns: repeat(4, var(--poster-width));
  grid-gap: calc(var(--u) * 36) calc(var(--u) * 34);
}

.search__people {
  margin-bottom: calc(var(--u) * 48);
  justify-items: center;
}
</style>
