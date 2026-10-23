<script setup lang="ts">
import { goBack } from '../lib/navigation.ts'
import type { Card, Episode, Person, TitleSeason } from '@torsher/api-client'
import type { SectionEdges } from '../focus/index.ts'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import AppIcon from '../components/AppIcon.vue'
import ContentRow from '../components/ContentRow.vue'
import EpisodeCard from '../components/EpisodeCard.vue'
import EpisodeList from '../components/EpisodeList.vue'
import EpisodeListCard from '../components/EpisodeListCard.vue'
import FocusSection from '../components/FocusSection.vue'
import PersonCard from '../components/PersonCard.vue'
import PosterCard from '../components/PosterCard.vue'
import AppToast from '../components/AppToast.vue'
import ScreenState from '../components/ScreenState.vue'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useCatalogTitle } from '../composables/useCatalogTitle.ts'
import { useTitleMeta } from '../composables/useTitleMeta.ts'
import { api } from '../api.ts'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import {
  useTitleExtras,
  useTitleSeason,
} from '../composables/useTitleSections.ts'
import { useStackScroll } from '../composables/useStackScroll.ts'
import { useTitleProgress } from '../composables/useTitleProgress.ts'
import { useFocus } from '../focus/index.ts'
import {
  knownTitleMine,
  noteTitleMine,
  openTitleActions,
  rememberTitleMine,
} from '../titleActions.ts'
import { stackOffset } from '../lib/rowStack.ts'
import { revealOffset } from '../lib/rowTrack.ts'
import {
  formatAirDate,
  formatPublishDate,
  formatYears,
  isUpcoming,
  seasonAired,
} from '../lib/titleInfo.ts'

const props = defineProps<{ id: string }>()

const MAX_GENRES = 3
// Пролёт пультом по чипам не запрашивает каждый сезон: ждём, пока фокус остановится
const SEASON_DELAY_MS = 200
// Секция встаёт под верхний край экрана с этим отступом (пиксели макета)
const BLOCK_GAP = 110

const { t, te } = useI18n()
const router = useRouter()
const focus = useFocus()
const language = useCatalogLanguage()
const { formatRating, formatRuntime } = useTitleMeta()

const id = computed(() => props.id)
const { status, title, error, retry } = useCatalogTitle(id)

const isSeries = computed(() => title.value?.kind === 'series')
const seasons = computed(() => title.value?.seasons ?? [])

// Выбранный сезон отмечен сразу, серии запрашиваются после паузы
const selectedSeason = ref<number>()
const requestedSeason = ref<number>()
let seasonTimer: ReturnType<typeof setTimeout> | undefined

const {
  season,
  status: seasonStatus,
  error: seasonError,
  retry: retrySeason,
} = useTitleSeason(id, requestedSeason)

// Нижние секции грузятся после первого экрана
const extrasId = computed(() => (title.value ? props.id : undefined))
const {
  extras,
  status: extrasStatus,
  error: extrasError,
  retry: retryExtras,
} = useTitleExtras(extrasId)

// Индекс фокусной серии; -1 — плитка «Все серии» перед ними
const focusedEpisode = ref(0)

// Логотип не загрузился — пишем название текстом
const logoFailed = ref(false)

watch(
  () => title.value?.logo,
  () => {
    logoFailed.value = false
  },
)

// Первая загрузка сериала: сезон по умолчанию — первый
watch(
  seasons,
  (list) => {
    if (selectedSeason.value === undefined && list[0]) {
      selectedSeason.value = list[0].number
      requestedSeason.value = list[0].number
    }
  },
  { immediate: true },
)

function selectSeason(number: number, immediate: boolean) {
  if (selectedSeason.value === number)
    return

  selectedSeason.value = number
  focusedEpisode.value = 0
  clearTimeout(seasonTimer)

  if (immediate) {
    requestedSeason.value = number

    return
  }

  seasonTimer = setTimeout(() => {
    requestedSeason.value = number
  }, SEASON_DELAY_MS)
}

const episodes = computed<Episode[]>(() =>
  season.value && season.value.number === selectedSeason.value
    ? season.value.episodes
    : [],
)
const episodesLoading = computed(
  () =>
    requestedSeason.value !== selectedSeason.value
    || seasonStatus.value === 'loading',
)
const currentSeason = computed(() =>
  seasons.value.find(item => item.number === selectedSeason.value),
)
const episode = computed(() => episodes.value[focusedEpisode.value])

// Ряд серий начинается с плитки полного списка, как «Еще» у Лампы
const LIST_TILE = 'all' as const
const episodeItems = computed<(Episode | typeof LIST_TILE)[]>(() => [
  LIST_TILE,
  ...episodes.value,
])
const listTileFocused = computed(() => focusedEpisode.value < 0)
const showEpisodeList = ref(false)

const cast = computed(() => extras.value?.cast ?? [])
const similar = computed(() => extras.value?.similar ?? [])

const meta = computed(() => {
  const value = title.value

  if (!value)
    return []

  const parts = [
    formatYears(value, t('title.ongoing')),
    t(value.kind === 'movie' ? 'title.movie' : 'title.series'),
  ]

  if (value.genres.length > 0)
    parts.push(value.genres.slice(0, MAX_GENRES).join(', '))

  if (value.seasons?.length)
    parts.push(t('title.seasonCount', value.seasons.length))
  else if (value.runtime)
    parts.push(formatRuntime(value.runtime))

  return parts.filter(Boolean)
})

// Что запустит главная кнопка: ждём прогресс, чтобы не искать раздачи дважды
const { progress } = useTitleProgress(id)
const { historyOf } = useSourceLabels()

// Отметки «просмотрено», поставленные сейчас: сразу видны, без перезапроса прогресса
const marks = ref(new Map<string, boolean>())

function progressKey(season: number | undefined, episode: number) {
  return `${season ?? 0}:${episode}`
}

const episodeProgress = computed(() => {
  const map = new Map<string, { watched: boolean, share: number }>()

  for (const item of progress.value?.episodes ?? []) {
    map.set(progressKey(item.season, item.episode), {
      watched: item.watched,
      share: item.watched
        ? 1
        : item.duration
          ? Math.min(1, item.position / item.duration)
          : 0,
    })
  }

  for (const [key, watched] of marks.value)
    map.set(key, { watched, share: watched ? 1 : 0 })

  return map
})

function progressOfEpisode(item: Episode) {
  return episodeProgress.value.get(
    progressKey(selectedSeason.value, item.number),
  )
}

// Вторая строка «Смотреть» — что смотрели последний раз; та же строка открывает «Источники»
const primaryHint = computed(() => {
  const line = historyOf(progress.value)?.line

  return line ? t('title.history', { line }) : ''
})

function openSources() {
  router.push(`/title/${props.id}/sources`)
}

// Списки и своя оценка: меню действий правит то же состояние
const mine = computed(() => knownTitleMine(props.id))
const mineError = ref('')

watch(
  [id, language],
  async ([current]) => {
    try {
      const fresh = await api.titles.getTitleMine(current, {
        language: language.value,
      })

      if (current === props.id)
        rememberTitleMine(current, fresh)
    }
    catch {
      // Без состояния кнопки работают через меню, когда оно загрузится
    }
  },
  { immediate: true },
)

async function toggleWatchlist() {
  const current = mine.value

  if (!current)
    return

  const watchlist = !current.watchlist

  noteTitleMine(props.id, { ...current, watchlist })

  try {
    noteTitleMine(
      props.id,
      await api.titles.patchTitleMine(
        props.id,
        { watchlist },
        { language: language.value },
      ),
    )
  }
  catch {
    noteTitleMine(props.id, current)
    mineError.value = t('actions.errors.save')
  }
}

function openActions(step?: 'rating') {
  if (title.value) {
    openTitleActions(
      { id: props.id, title: title.value.title, kind: title.value.kind },
      step,
    )
  }
}

// OK на серии ставит или снимает «просмотрено»: смотреть — через «Смотреть»
const okHint = computed(() => {
  const item = episode.value

  if (!item || isUpcoming(item.airDate))
    return ''

  return progressOfEpisode(item)?.watched
    ? t('title.okUnmark')
    : t('title.okMark')
})

async function toggleWatched(item: Episode) {
  const number = selectedSeason.value

  if (number === undefined || isUpcoming(item.airDate))
    return

  const watched = !progressOfEpisode(item)?.watched

  try {
    await api.titles.putTitleWatched(props.id, {
      season: number,
      episode: item.number,
      watched,
    })
  }
  catch {
    // Не сохранилось — отметка остаётся прежней
    return
  }

  marks.value = new Map(marks.value).set(
    progressKey(number, item.number),
    watched,
  )
}

function countryName(code: string) {
  const key = `countries.${code}`

  return te(key) ? t(key) : code
}

const facts = computed(() => {
  const value = title.value

  if (!value)
    return []

  const list: { label: string, value: string, mono?: boolean }[] = []
  const add = (label: string, items: string[], mono = false) => {
    if (items.length > 0)
      list.push({ label: t(label), value: items.join(', '), mono })
  }

  add('title.facts.originalTitle', [value.originalTitle])
  add('title.facts.countries', value.countries.map(countryName))
  add(
    isSeries.value ? 'title.facts.network' : 'title.facts.studio',
    value.studios,
  )
  add('title.facts.creators', value.creators)
  add('title.facts.directors', extras.value?.directors ?? [])
  add('title.facts.aka', extras.value?.aka ?? [], true)
  list.push({ label: t('title.facts.data'), value: 'TMDB' })

  return list
})

function seasonBadge(item: TitleSeason) {
  const aired = seasonAired(item)

  return aired ? t('title.seasonAired', aired) : String(item.episodeCount)
}

function episodeMeta(item: Episode) {
  if (isUpcoming(item.airDate) && item.airDate) {
    return t('title.airs', {
      date: formatAirDate(item.airDate, language.value),
    })
  }

  return item.runtime ? formatRuntime(item.runtime) : ''
}

function episodeDetail(item: Episode) {
  const parts = []

  if (item.runtime)
    parts.push(formatRuntime(item.runtime))

  // Вышедшая — дата с годом, как в «Файлах»; будущая — с днём недели
  if (item.airDate) {
    parts.push(
      isUpcoming(item.airDate)
        ? formatAirDate(item.airDate, language.value)
        : formatPublishDate(item.airDate, language.value),
    )
  }

  return parts.join(' · ')
}

function episodeKey(item: Episode | typeof LIST_TILE) {
  return item === LIST_TILE ? LIST_TILE : item.number
}

// Полный список: та же карта отметок и тот же выбранный сезон, что у ряда
const seasonOptions = computed(() =>
  seasons.value.map(item => ({
    id: String(item.number),
    label: item.name,
    selected: item.number === selectedSeason.value,
  })),
)

const seasonLine = computed(() => {
  const value = currentSeason.value

  if (!value)
    return ''

  return [t('title.episodeList.count', value.episodeCount), value.year]
    .filter(Boolean)
    .join(' · ')
})

// Открыть список на серии из ряда, а с плитки — на первой непросмотренной
const listFocusNumber = computed(() => {
  if (episode.value)
    return episode.value.number

  return (
    episodes.value.find(
      item => !isUpcoming(item.airDate) && !progressOfEpisode(item)?.watched,
    ) ?? episodes.value[0]
  )?.number
})

function listDetail(item: Episode) {
  if (isUpcoming(item.airDate) && item.airDate) {
    return [
      item.runtime ? formatRuntime(item.runtime) : '',
      t('title.airs', { date: formatAirDate(item.airDate, language.value) }),
    ]
      .filter(Boolean)
      .join(' · ')
  }

  return episodeDetail(item)
}

function listStatus(item: Episode) {
  const progress = progressOfEpisode(item)

  if (progress?.watched)
    return t('files.watched')

  if (progress && progress.share > 0 && item.runtime) {
    return t('title.left', {
      n: Math.max(1, Math.round(item.runtime * (1 - progress.share))),
    })
  }

  return ''
}

function listHint(item: Episode) {
  if (isUpcoming(item.airDate))
    return ''

  return progressOfEpisode(item)?.watched
    ? t('title.okUnmark')
    : t('title.okMark')
}

function personKey(item: Person) {
  return item.id
}

function cardKey(item: Card) {
  return item.id
}

/*
 * Экран сам ставит секцию на место (transform), поэтому все его секции —
 * manual-scroll: scrollIntoView прокрутил бы контейнер с overflow: hidden.
 *
 * Секции экрана сверху вниз: их порядок задаёт переходы стрелками вверх и вниз.
 * Нижние секции появляются, когда для них пришли данные или ошибка.
 */
const order = computed(() => {
  const list: string[] = []

  if (status.value === 'error')
    return ['title-state']

  if (!title.value)
    return list

  list.push('title-actions')

  if (seasons.value.length > 0) {
    list.push('title-seasons')

    if (seasonStatus.value === 'error')
      list.push('title-season-state')
    else if (episodes.value.length > 0)
      list.push('title-episodes')
  }

  if (extrasStatus.value === 'error') {
    list.push('title-extras-state')
  }
  else {
    if (cast.value.length > 0)
      list.push('title-cast')

    if (similar.value.length > 0)
      list.push('title-similar')
  }

  if (facts.value.length > 0)
    list.push('title-facts')

  return list
})

function edgesOf(name: string): SectionEdges {
  const index = order.value.indexOf(name)

  return {
    up: index > 0 ? order.value[index - 1] : 'title-back',
    down: order.value[index + 1],
  }
}

// Вертикальная прокрутка экрана: фокусная секция встаёт под верхний край
const stack = ref<HTMLElement>()
const screen = ref<HTMLElement>()
const {
  native: nativeScroll,
  offset,
  alignTo: scrollStackTo,
  onScroll: onScreenScroll,
  transform: stackTransform,
} = useStackScroll(screen)
const alignedSection = ref<string>()
// На ТВ блоки, начатые выше выровненного, гаснут, как ряды главной под hero:
// их хвост лез бы под кнопку «Назад». В вебе страница прокручивается свободно
const blocksAbove = ref<string[]>([])

function alignTo(el: HTMLElement) {
  const block = el.closest<HTMLElement>('[data-block]')

  if (!block || !stack.value || !screen.value)
    return

  const gap = (window.innerWidth / 1920) * BLOCK_GAP
  const top = block.offsetTop === 0 ? 0 : block.offsetTop - gap

  const next = stackOffset(
    top,
    stack.value.offsetHeight,
    screen.value.clientHeight,
  )

  scrollStackTo(next)

  if (nativeScroll)
    return

  const line = next + gap - 1

  blocksAbove.value
    = next > 0
      ? Array.from(stack.value.querySelectorAll<HTMLElement>('[data-block]'))
          .filter(item => item.offsetTop < line)
          .map(item => item.dataset.block ?? '')
      : []
}

function sectionName(el: HTMLElement) {
  return el
    .closest<HTMLElement>('[data-focus-section]')
    ?.getAttribute('data-focus-section')
}

// Лента чипов: у долгих сериалов десятки сезонов, фокусный чип держим в окне
const chipsView = ref<HTMLElement>()
const chipsOffset = ref(0)
const CHIP_GAP = 24

function revealChip(chip: HTMLElement) {
  const track = chip.parentElement

  if (!chipsView.value || !track)
    return

  chipsOffset.value = revealOffset(
    chipsOffset.value,
    { left: chip.offsetLeft, width: chip.offsetWidth },
    chipsView.value.clientWidth,
    track.scrollWidth,
    (window.innerWidth / 1920) * CHIP_GAP,
  )
}

// Секция прошлого фокуса: вход в чипы сезонов отличается от шага по ним
let previousSection: string | undefined

const stopFocus = focus.onFocus((el, via) => {
  if (!screen.value?.contains(el))
    return

  const name = sectionName(el) ?? undefined
  const entered = name !== previousSection

  previousSection = name

  if (name === 'title-seasons' && via !== 'pointer') {
    // В чипы входим на выбранный сезон, а не на чип в той же колонке:
    // иначе шаг вниз с кнопок сам переключил бы сезон
    const selected = screen.value.querySelector<HTMLElement>('.chip--selected')

    if (entered && selected && selected !== el && focus.focusOn(selected, via))
      return

    revealChip(el)

    // Под пультом фокус на чипе сразу переключает серии; указка только подсвечивает
    const number = Number(el.dataset.season)

    if (!entered && via === 'nav' && number)
      selectSeason(number, false)
  }

  // В ряд серий входим на первую серию, а не на плитку списка перед ней:
  // шагнувший вниз хочет серию, плитка — шаг влево
  if (
    name === 'title-episodes'
    && entered
    && via !== 'pointer'
    && el.classList.contains('episode-list-card')
  ) {
    const first = el
      .closest('.row__item')
      ?.nextElementSibling
      ?.querySelector<HTMLElement>('[data-focusable]')

    if (first && focus.focusOn(first, via))
      return
  }

  if (via === 'pointer')
    return

  alignedSection.value = name ?? undefined
  alignTo(el)
})

// Колесо листает секции на одну от выровненной, элемент — в той же колонке
const stopWheel = focus.onWheel((direction) => {
  // Колесо над открытым списком серий не листает карточку под ним
  if (showEpisodeList.value || (direction !== 'up' && direction !== 'down'))
    return true

  const index = order.value.indexOf(alignedSection.value ?? 'title-actions')
  const next = order.value[index + (direction === 'down' ? 1 : -1)]

  if (next)
    focus.activate(next, 'wheel', focus.current())

  return true
})

function onSeasonClick(number: number) {
  selectSeason(number, true)

  // OK пульта на чипе ведёт к сериям; клик мышью оставляет фокус на чипе
  if (focus.mode === 'remote') {
    nextTick(() => focus.activate('title-episodes'))
  }
}

function openEpisodeList() {
  showEpisodeList.value = true
}

function closeEpisodeList() {
  showEpisodeList.value = false

  nextTick(() => {
    const tile = screen.value?.querySelector<HTMLElement>('.episode-list-card')

    if (tile)
      focus.focusOn(tile)
  })
}

function onEpisodeFocus(index: number) {
  // Вход в ряд переводит фокус с плитки на серию прямо в обработчике фокуса,
  // и событие плитки приходит после события серии: верен фокус в DOM
  const current = focus
    .current()
    ?.closest<HTMLElement>('.row__item')
    ?.getAttribute('data-index')

  focusedEpisode.value = (current ? Number(current) : index) - 1
}

function openTitle(card: Card) {
  router.push(`/title/${card.id}`)
}

function back() {
  goBack(router)
}

function onResize() {
  const current = focus.current()

  if (current && screen.value?.contains(current))
    alignTo(current)
}

onMounted(() => window.addEventListener('resize', onResize))

onBeforeUnmount(() => {
  stopFocus()
  stopWheel()
  clearTimeout(seasonTimer)
  window.removeEventListener('resize', onResize)
})
</script>

<template>
  <main
    ref="screen"
    class="title"
    :class="{ 'title--native': nativeScroll }"
    @scroll="onScreenScroll"
  >
    <img
      v-if="title?.backdrop"
      class="title__backdrop"
      :src="title.backdrop"
      alt=""
      decoding="async"
    >
    <div class="title__shade" />
    <div class="title__dim" :class="{ 'title__dim--on': offset > 0 }" />

    <!--
      Видна всегда и доступна стрелкой вверх с кнопок, и на ТВ: кнопка, которая
      пропадает при переходе на пульт, выглядит сломанной
    -->
    <FocusSection name="title-back" :edges="{ down: order[0] }">
      <button v-focusable class="screen-back" type="button" @click="back">
        <AppIcon name="chevronLeft" />
        <span class="screen-back__label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>

    <FocusSection
      v-if="status === 'error' && error"
      name="title-state"
      class="title__state"
      :edges="{ up: 'title-back' }"
      autofocus
    >
      <ScreenState :kind="error" @retry="retry" />
    </FocusSection>

    <div
      v-else-if="title"
      ref="stack"
      class="title__stack"
      :style="{ transform: stackTransform }"
    >
      <section
        class="title__head"
        :class="{ 'block--above': blocksAbove.includes('head') }"
        data-block="head"
      >
        <div class="title__info">
          <h1 class="title__name">
            <img
              v-if="title.logo && !logoFailed"
              class="title__logo"
              :src="title.logo"
              :alt="title.title"
              decoding="async"
              @error="logoFailed = true"
            >
            <template v-else>
              {{ title.title }}
            </template>
          </h1>

          <div class="title__meta-row">
            <p class="title__meta">
              {{ meta.join(" · ") }}
              <span v-if="title.certification" class="title__age">
                {{ title.certification }}
              </span>
            </p>
            <p v-if="title.rating" class="title__rating">
              {{ formatRating(title.rating) }}
            </p>
          </div>

          <p v-if="title.overview" class="title__overview">
            {{ title.overview }}
          </p>
        </div>

        <FocusSection
          name="title-actions"
          manual-scroll
          class="title__actions"
          :edges="edgesOf('title-actions')"
          autofocus
        >
          <button
            v-focusable
            class="action action--primary title__primary"
            type="button"
            @click="openSources"
          >
            <AppIcon name="play" class="title__action-icon" />
            <span class="title__primary-text">
              {{ t("title.watch") }}
              <small v-if="primaryHint" class="title__primary-hint">
                {{ primaryHint }}
              </small>
            </span>
          </button>
          <button
            v-focusable
            class="action title__secondary"
            type="button"
            :aria-pressed="!!mine?.watchlist"
            @click="toggleWatchlist"
          >
            <AppIcon
              :name="mine?.watchlist ? 'check' : 'plus'"
              class="title__action-icon"
            />
            {{ t("actions.watchlist") }}
          </button>
          <button
            v-focusable
            class="action title__secondary"
            type="button"
            @click="openActions('rating')"
          >
            <AppIcon name="star" class="title__action-icon" />
            <!-- Звезда уже нарисована иконкой: рядом только число -->
            {{ mine?.rating ?? t("actions.rate") }}
          </button>
          <button
            v-focusable
            class="action title__secondary title__more"
            type="button"
            :aria-label="t('actions.more')"
            @click="openActions()"
          >
            <AppIcon name="more" />
          </button>
        </FocusSection>

        <!-- Подсказка о том, что ниже, нужна только у верхнего края -->
        <p class="title__peek" :class="{ 'title__peek--hidden': offset > 0 }">
          <AppIcon name="chevronDown" class="title__peek-icon" />
          {{ t(isSeries ? "title.peekSeries" : "title.peekMovie") }}
        </p>
      </section>

      <section
        v-if="seasons.length > 0"
        class="block"
        :class="{ 'block--above': blocksAbove.includes('episodes') }"
        data-block="episodes"
      >
        <div class="block__inner">
          <h2 class="block__title">
            {{ t("title.episodes") }}
            <small v-if="currentSeason" class="block__sub">
              {{
                t("title.airedOf", {
                  aired: currentSeason.airedEpisodeCount,
                  total: currentSeason.episodeCount,
                })
              }}
            </small>
          </h2>
          <div ref="chipsView" class="title__chips-view">
            <FocusSection
              name="title-seasons"
              manual-scroll
              class="title__chips"
              :style="{ transform: `translateX(${-chipsOffset}px)` }"
              :edges="edgesOf('title-seasons')"
            >
              <button
                v-for="item in seasons"
                :key="item.number"
                v-focusable
                class="chip"
                :class="{ 'chip--selected': item.number === selectedSeason }"
                type="button"
                :data-season="item.number"
                @click="onSeasonClick(item.number)"
              >
                {{ item.name }}
                <span class="chip__count">{{ seasonBadge(item) }}</span>
              </button>
            </FocusSection>
          </div>
        </div>

        <FocusSection
          v-if="seasonStatus === 'error' && seasonError"
          name="title-season-state"
          manual-scroll
          class="block__inner"
          :edges="edgesOf('title-season-state')"
        >
          <ScreenState :kind="seasonError" @retry="retrySeason" />
        </FocusSection>

        <template v-else-if="episodes.length > 0 && !episodesLoading">
          <ContentRow
            :key="selectedSeason"
            section="title-episodes"
            :items="episodeItems"
            :item-key="episodeKey"
            :edges="edgesOf('title-episodes')"
            @focus-item="onEpisodeFocus"
          >
            <template #item="{ item }">
              <EpisodeListCard
                v-if="item === LIST_TILE"
                :meta="t('title.episodeList.count', episodes.length)"
                @select="openEpisodeList"
              />
              <EpisodeCard
                v-else
                :episode="item"
                :meta="episodeMeta(item)"
                :progress="progressOfEpisode(item)?.share ?? 0"
                :watched="!!progressOfEpisode(item)?.watched"
                @select="toggleWatched(item)"
              />
            </template>
          </ContentRow>

          <div v-if="listTileFocused" class="block__inner episode-detail">
            <div class="episode-detail__text">
              <h3 class="episode-detail__title">
                {{ t("title.episodeList.detail") }}
              </h3>
              <p class="episode-detail__hint">
                {{ t("title.episodeList.okOpen") }}
              </p>
            </div>
          </div>
          <div v-else-if="episode" class="block__inner episode-detail">
            <div class="episode-detail__text">
              <h3 class="episode-detail__title">
                S{{ selectedSeason }}E{{ episode.number }} · {{ episode.title }}
                <span
                  v-if="episodeDetail(episode)"
                  class="episode-detail__meta"
                >
                  {{ episodeDetail(episode) }}
                </span>
              </h3>
              <p v-if="okHint" class="episode-detail__hint">
                {{ okHint }}
              </p>
              <p v-if="episode.overview" class="episode-detail__overview">
                {{ episode.overview }}
              </p>
            </div>
          </div>
        </template>

        <div v-else class="block__inner skeleton-track" aria-hidden="true">
          <span
            v-for="index in 4"
            :key="index"
            class="skeleton-track__episode skeleton"
          />
        </div>
      </section>

      <section
        v-if="extrasStatus === 'error' && extrasError"
        class="block"
        :class="{ 'block--above': blocksAbove.includes('extras') }"
        data-block="extras"
      >
        <FocusSection
          name="title-extras-state"
          manual-scroll
          class="block__inner"
          :edges="edgesOf('title-extras-state')"
        >
          <ScreenState :kind="extrasError" @retry="retryExtras" />
        </FocusSection>
      </section>

      <template v-else-if="extras">
        <section
          v-if="cast.length > 0"
          class="block"
          :class="{ 'block--above': blocksAbove.includes('cast') }"
          data-block="cast"
        >
          <ContentRow
            section="title-cast"
            :title="t('title.cast')"
            :items="cast"
            :item-key="personKey"
            :edges="edgesOf('title-cast')"
          >
            <template #item="{ item }">
              <PersonCard :person="item" />
            </template>
          </ContentRow>
        </section>

        <section
          v-if="similar.length > 0"
          class="block"
          :class="{ 'block--above': blocksAbove.includes('similar') }"
          data-block="similar"
        >
          <ContentRow
            section="title-similar"
            :title="t('title.similar')"
            :items="similar"
            :item-key="cardKey"
            :edges="edgesOf('title-similar')"
          >
            <template #item="{ item }">
              <PosterCard :card="item" @select="openTitle(item)" />
            </template>
          </ContentRow>
        </section>
      </template>

      <div v-else class="block block__inner skeleton-track" aria-hidden="true">
        <span
          v-for="index in 7"
          :key="index"
          class="skeleton-track__person skeleton"
        />
      </div>

      <section
        v-if="facts.length > 0"
        class="block"
        :class="{ 'block--above': blocksAbove.includes('facts') }"
        data-block="facts"
      >
        <div class="block__inner">
          <h2 class="block__title">
            {{ t(isSeries ? "title.aboutSeries" : "title.aboutMovie") }}
          </h2>
          <FocusSection
            name="title-facts"
            manual-scroll
            :edges="edgesOf('title-facts')"
          >
            <dl v-focusable class="facts" tabindex="-1">
              <div v-for="fact in facts" :key="fact.label" class="facts__row">
                <dt class="facts__label">
                  {{ fact.label }}
                </dt>
                <dd
                  class="facts__value"
                  :class="{ 'facts__value--mono': fact.mono }"
                >
                  {{ fact.value }}
                </dd>
              </div>
            </dl>
          </FocusSection>
        </div>
      </section>
    </div>

    <div v-else class="title__stack" aria-hidden="true">
      <div class="title__head">
        <div class="title__info">
          <div class="skeleton-line skeleton-line--name skeleton" />
          <div class="skeleton-line skeleton" />
          <div class="skeleton-line skeleton-line--wide skeleton" />
          <div class="skeleton-line skeleton-line--wide skeleton" />
        </div>
      </div>
    </div>
    <AppToast :message="mineError" @hide="mineError = ''" />

    <!-- Вне стека карточки: у него transform, и fixed внутри встал бы относительно него -->
    <Teleport to="body">
      <EpisodeList
        v-if="showEpisodeList && title"
        :name="title.title"
        :poster="title.poster"
        :meta="meta.join(' · ')"
        :season-label="currentSeason?.name ?? ''"
        :season-line="seasonLine"
        :season-options="seasonOptions"
        :episodes="episodes"
        :loading="episodesLoading"
        :focus-number="listFocusNumber"
        :detail-of="listDetail"
        :status-of="listStatus"
        :progress-of="(item) => progressOfEpisode(item)?.share ?? 0"
        :watched-of="(item) => !!progressOfEpisode(item)?.watched"
        :hint-of="listHint"
        @toggle="toggleWatched"
        @season="(number) => selectSeason(number, true)"
        @close="closeEpisodeList"
      />
    </Teleport>
  </main>
</template>

<style scoped>
/* Свой полноэкранный экран: секции едут transform, фон — под safe area */
.title {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
}

.title__backdrop,
.title__shade,
.title__dim {
  /* fixed, а не absolute: в вебе экран прокручивается, а фон стоит */
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.title__backdrop {
  object-fit: cover;
}

.title__shade {
  background-image:
    linear-gradient(
      90deg,
      var(--color-bg) 0%,
      rgba(11, 13, 18, 0.94) 22%,
      rgba(11, 13, 18, 0.55) 44%,
      rgba(11, 13, 18, 0) 66%
    ),
    linear-gradient(
      0deg,
      rgba(11, 13, 18, 0.75) 0%,
      rgba(11, 13, 18, 0.7) 36%,
      rgba(11, 13, 18, 0.3) 56%,
      rgba(11, 13, 18, 0) 72%
    );
}

/* Первый экран ушёл вверх: фон гаснет, секции читаются на ровной подложке */
.title__dim {
  background: var(--color-bg);
  opacity: 0;
  transition: opacity var(--motion-base) var(--motion-easing);
}

.title__dim--on {
  opacity: 0.86;
}

.title__state {
  position: relative;
  padding: calc(var(--u) * 132) var(--safe-x) 0 var(--content-x);
}

/* Веб: экран прокручивается нативно, полоса прокрутки не нужна */
.title--native {
  overflow-y: auto;
}

.title--native::-webkit-scrollbar {
  display: none;
}

.title__stack {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  padding-bottom: calc(var(--u) * 260);
  transition: transform var(--motion-base) var(--motion-easing);
}

.title__head {
  position: relative;
  height: calc(var(--u) * 1080);
}

.title__head,
.block {
  transition: opacity var(--motion-base) var(--motion-easing);
  will-change: opacity;
}

.block--above {
  opacity: 0;
  pointer-events: none;
}

.title__info {
  position: absolute;
  top: calc(var(--u) * 132);
  left: var(--content-x);
  width: calc(var(--u) * 1100);
}

.title__name {
  margin: 0 0 calc(var(--u) * 26);
  font-size: var(--font-size-xl);
  line-height: 1.05;
}

.title__logo {
  display: block;
  max-width: calc(var(--u) * 760);
  max-height: calc(var(--u) * 200);
  object-fit: contain;
  object-position: left bottom;
}

.title__meta-row {
  display: flex;
  align-items: center;
  margin-bottom: calc(var(--u) * 24);
  font-size: var(--font-size-s);
}

.title__meta {
  display: flex;
  align-items: center;
  margin: 0 calc(var(--u) * 30) 0 0;
  color: var(--color-text-muted);
}

.title__age {
  margin-left: calc(var(--u) * 14);
  padding: 0 calc(var(--u) * 8);
  border: calc(var(--u) * 2) solid var(--color-text-dim);
  border-radius: calc(var(--u) * 6);
  font-size: calc(var(--u) * 20);
  font-weight: 600;
  line-height: calc(var(--u) * 28);
}

.title__rating {
  margin: 0;
  font-weight: 600;
}

/* -webkit-line-clamp работает и в Chromium 68 */
.title__overview {
  display: -webkit-box;
  max-width: calc(var(--u) * 900);
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  line-height: 1.42;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}

.title__actions {
  position: absolute;
  top: calc(var(--u) * 742);
  left: var(--content-x);
  display: flex;
  /* Кнопки ряда — одной высоты с двухстрочной главной */
  align-items: stretch;
}

.title__actions .action {
  display: flex;
  align-items: center;
  height: auto;
  min-height: calc(var(--u) * 84);
}

.title__action-icon {
  margin-right: calc(var(--u) * 14);
}

.title__secondary {
  margin-left: calc(var(--u) * 18);
}

/* «Ещё» — только значок: квадратная кнопка высотой ряда */
.title__more {
  justify-content: center;
  min-width: calc(var(--u) * 84);
  padding: 0;
}

/* Главная кнопка говорит, что вы получите: вторая строка — качество и озвучка */
.title__primary {
  height: auto;
  min-height: calc(var(--u) * 84);
  padding-top: calc(var(--u) * 12);
  padding-bottom: calc(var(--u) * 12);
}

.title__primary-text {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}

.title__primary-hint {
  max-width: calc(var(--u) * 640);
  overflow: hidden;
  font-size: var(--font-size-s);
  font-weight: 500;
  text-overflow: ellipsis;
  opacity: 0.75;
}

.title__peek {
  position: absolute;
  top: calc(var(--u) * 978);
  left: var(--content-x);
  display: flex;
  align-items: center;
  margin: 0;
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
  transition: opacity var(--motion-fast) var(--motion-easing);
}

.title__peek--hidden {
  opacity: 0;
}

.title__peek-icon {
  margin-right: calc(var(--u) * 12);
  font-size: calc(var(--u) * 26);
}

.block {
  position: relative;
  margin-bottom: calc(var(--u) * 40);
}

.block__inner {
  padding: 0 var(--safe-x) 0 var(--content-x);
}

.block__title {
  display: flex;
  align-items: baseline;
  margin: 0 0 calc(var(--u) * 24);
  font-size: var(--font-size-l);
  font-weight: 700;
}

.block__sub {
  margin-left: calc(var(--u) * 18);
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
  font-weight: 400;
}

/*
 * Окно ленты чипов: слева обрезаем по краю контента, справа — по краю экрана;
 * запас вокруг — под масштаб фокуса
 */
.title__chips-view {
  margin-bottom: calc(var(--u) * 36);
  clip-path: inset(calc(var(--u) * -16) calc(var(--safe-x) * -1) calc(var(--u) * -16) calc(var(--u) * -16));
}

/* position: relative — offsetLeft чипа считается от ленты */
.title__chips {
  position: relative;
  display: flex;
  transition: transform var(--motion-base) var(--motion-easing);
}

.chip__count {
  margin-left: calc(var(--u) * 12);
  color: var(--color-text-dim);
}

.chip:focus .chip__count {
  color: var(--color-surface-raised-2);
}

/*
 * Высота постоянная: описание у серий разной длины, а секции ниже не должны
 * прыгать при шаге по ряду — от их положения считается прокрутка экрана
 */
.episode-detail {
  display: flex;
  align-items: flex-start;
  max-width: calc(var(--u) * 1240 + var(--content-x));
  height: calc(var(--u) * 160);
  margin-top: calc(var(--u) * -12);
  overflow: hidden;
}

.episode-detail__text {
  flex: 1;
  min-width: 0;
}

.episode-detail__title {
  margin: 0 0 var(--space-1);
  font-size: var(--font-size-m);
  font-weight: 600;
}

/* Подсказка, что сделает OK: заранее, до нажатия */
.episode-detail__hint {
  margin: 0 0 var(--space-1);
  color: var(--color-info);
  font-size: var(--font-size-s);
  font-weight: 500;
}

/* Две строки: блок постоянной высоты делят заголовок, подсказка OK и описание */
.episode-detail__overview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  line-height: 1.45;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* Длительность и дата — в строке заголовка, тише него */
.episode-detail__meta {
  margin-left: calc(var(--u) * 16);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-weight: 400;
}

.facts {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-gap: calc(var(--u) * 14) calc(var(--u) * 40);
  max-width: calc(var(--u) * 1240);
  margin: 0;
  padding: var(--space-4);
  border-radius: var(--radius-l);
  background: var(--color-glass);
  font-size: var(--font-size-s);
  transition: box-shadow var(--motion-fast) var(--motion-easing);
}

/* Блок-список: кольцо, как у поля ввода, без масштаба */
.facts:focus {
  box-shadow: 0 0 0 var(--focus-ring-width) var(--color-focus);
}

/* Строка — обёртка для пары dt/dd: в сетку попадают сами dt и dd */
.facts__row {
  display: contents;
}

.facts__label {
  color: var(--color-text-dim);
}

.facts__value {
  margin: 0;
}

.facts__value--mono {
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
}

.skeleton-track {
  display: flex;
  overflow: hidden;
}

.skeleton-track__episode {
  flex-shrink: 0;
  width: calc(var(--u) * 420);
  height: calc(var(--u) * 236);
  margin-right: calc(var(--u) * 28);
  border-radius: var(--radius-m);
}

.skeleton-track__person {
  flex-shrink: 0;
  width: calc(var(--u) * 140);
  height: calc(var(--u) * 140);
  margin: calc(var(--u) * 60) calc(var(--u) * 88) 0 calc(var(--u) * 30);
  border-radius: 50%;
}

.skeleton-line {
  width: calc(var(--u) * 400);
  height: var(--font-size-m);
  margin-bottom: var(--space-3);
  border-radius: var(--radius-s);
}

.skeleton-line--name {
  width: calc(var(--u) * 600);
  height: var(--font-size-xl);
}

.skeleton-line--wide {
  width: calc(var(--u) * 900);
}
</style>
