<script setup lang="ts">
import { goBack } from '../lib/navigation.ts'
import type { TitleSources } from '@torsher/api-client'
import type { Quality, SourceSort, SourceView } from '../lib/sources.ts'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api.ts'
import type { PanelOption } from '../components/OptionsPanel.vue'
import AppIcon from '../components/AppIcon.vue'
import AppLoader from '../components/AppLoader.vue'
import AppToast from '../components/AppToast.vue'
import LibraryRow from '../components/LibraryRow.vue'
import FocusSection from '../components/FocusSection.vue'
import OptionsPanel from '../components/OptionsPanel.vue'
import SourceRow from '../components/SourceRow.vue'
import { useCatalogTitle } from '../composables/useCatalogTitle.ts'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useResource } from '../composables/useResource.ts'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import { useTitleLibrary } from '../composables/useTitleLibrary.ts'
import { useTitleSeason } from '../composables/useTitleSections.ts'
import { useTitleProgress } from '../composables/useTitleProgress.ts'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../focus/index.ts'
import {
  allIndexersFailed,
  arrangeCandidates,
  isQuality,
  minutesSince,
  profileParts,
  qualityOptions,
  seasonOptions,
  videoClassLabel,
} from '../lib/sources.ts'
import { libraryRoute } from '../lib/continue.ts'
import { libraryTarget } from '../lib/library.ts'
import { loadSourceView, saveSourceView } from '../lib/sourceView.ts'
import { formatYears } from '../lib/titleInfo.ts'

defineOptions({ name: 'SourcesPage' })

/**
 * «Источники» тайтла: все раздачи всех сезонов, история просмотра, сортировка и
 * фильтры. Выбор раздачи подключает её и открывает «Файлы».
 */
const props = defineProps<{
  id: string
  // Открыли с «Скачать»: выбранная раздача откроет «Файлы» с отметками
  download?: boolean
  season?: string
}>()

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const id = toRef(props, 'id')
const { title } = useCatalogTitle(id)
const { progress, status: progressStatus } = useTitleProgress(id)
const { voiceLabel, historyOf } = useSourceLabels()

const isSeries = computed(() => title.value?.kind === 'series')

const storedView = loadSourceView(props.id)
// Вид, сохранённый до классов разрешения (`1080i`, `480p`), — на «любое»
const view = ref<Partial<SourceView>>({
  ...storedView,
  quality: isQuality(storedView.quality) ? storedView.quality : undefined,
})
const query = computed(() => view.value.query)

// Обновить — мимо кэша сервера; ключ меняется, и запрос уходит заново
const nonce = ref(0)
let forceRefresh = false
const { data: sources, status } = useResource<TitleSources>(
  computed(() => `${id.value}:${nonce.value}:${query.value ?? ''}`),
  (_, signal) => {
    const refresh = forceRefresh

    forceRefresh = false

    return api.titles.getTitleSources(
      id.value,
      { all: '1', refresh: refresh ? '1' : undefined, query: query.value },
      { signal },
    )
  },
)

function refresh() {
  forceRefresh = true
  nonce.value += 1
}

// Время для «обновлено N мин назад» берём при открытии экрана
const openedAt = new Date()

const sort = computed<SourceSort>(
  () => view.value.sort ?? (isSeries.value ? 'seasons' : 'best'),
)

function setView(patch: Partial<SourceView>) {
  view.value = { ...view.value, ...patch }
  saveSourceView(props.id, view.value)
}

function resetFilters() {
  setView({ season: undefined, voice: undefined, quality: undefined })
}

// «Скачать сезон N» — список сразу по этому сезону
watch(
  () => (props.download ? props.season : undefined),
  (season) => {
    if (season && Number(season) !== view.value.season)
      setView({ season: Number(season) })
  },
  { immediate: true },
)

// Поиск для экрана: показавшийся лоадер держится минимум, шапка и список
// приходят вместе с ним одним шагом
const searching = useHeldLoading(
  () => status.value === 'loading' || status.value === 'idle',
)

const candidates = computed(() => sources.value?.candidates ?? [])
const rows = computed(() =>
  arrangeCandidates(candidates.value, { ...view.value, sort: sort.value }),
)
const seasons = computed(() =>
  isSeries.value ? seasonOptions(candidates.value) : [],
)
const qualities = computed<Quality[]>(() => qualityOptions(candidates.value))

function qualityLabel(quality: Quality) {
  return quality === 'unknown'
    ? t('sources.unknownQuality')
    : videoClassLabel(quality)
}
const voices = computed(() => sources.value?.voices ?? [])

const sorts = computed<SourceSort[]>(() =>
  isSeries.value
    ? ['seasons', 'best', 'seeders', 'size', 'date']
    : ['best', 'seeders', 'size', 'date'],
)
const SORT_LABEL: Record<SourceSort, string> = {
  seasons: 'sources.sortSeasons',
  best: 'sources.sortBest',
  seeders: 'sources.sortSeeders',
  size: 'sources.sortSize',
  date: 'sources.sortDate',
}

// Сортировка и фильтры — одной строкой кнопок, выбор — в правой панели: список
// остаётся на весь экран
type Control = 'query' | 'sort' | 'season' | 'voice' | 'quality'

const panel = ref<Control>()
let panelOpener: HTMLElement | undefined

const voiceName = computed(() => {
  const option = voices.value.find(item => item.key === view.value.voice)

  return option ? voiceLabel(option) : ''
})

// «Запрос» есть всегда, и пока идёт поиск, и без раздач: это запасной путь,
// когда по названиям из TMDB ничего не нашлось
const controls = computed(() => {
  const list: { id: Control, label: string }[] = [
    {
      id: 'query',
      label: t('sources.controlQuery', {
        value: query.value ?? t('sources.query.autoValue'),
      }),
    },
  ]

  if (candidates.value.length === 0)
    return list

  list.push({
    id: 'sort',
    label: t('sources.controlSort', { value: t(SORT_LABEL[sort.value]) }),
  })

  if (seasons.value.length > 1) {
    list.push({
      id: 'season',
      label: t('sources.controlSeason', {
        value: view.value.season ?? t('sources.anySeason'),
      }),
    })
  }

  if (voices.value.length > 0) {
    list.push({
      id: 'voice',
      label: t('sources.controlVoice', {
        value: voiceName.value || t('sources.anyVoice'),
      }),
    })
  }

  if (qualities.value.length > 1) {
    list.push({
      id: 'quality',
      label: t('sources.controlQuality', {
        value: view.value.quality
          ? qualityLabel(view.value.quality)
          : t('sources.anyQuality'),
      }),
    })
  }

  return list
})

const panelTitle = computed(() =>
  panel.value ? t(`sources.panel.${panel.value}`) : '',
)

// Готовые строки сервера; своя строка зрителя, которой среди них нет, — тоже пункт
const queryOptions = computed<PanelOption[]>(() => {
  const current = query.value
  const suggestions = sources.value?.query.suggestions ?? []
  const values
    = current && !suggestions.includes(current)
      ? [current, ...suggestions]
      : suggestions

  return [
    {
      id: 'auto',
      label: t('sources.query.auto'),
      hint: t('sources.query.autoHint'),
      selected: !current,
    },
    ...values.map(value => ({
      id: `q:${value}`,
      label: value,
      selected: current === value,
    })),
  ]
})

const queryDraft = ref('')

function submitDraft() {
  const value = queryDraft.value.trim()

  if (value)
    choose(`q:${value}`)
}

const panelOptions = computed<PanelOption[]>(() => {
  switch (panel.value) {
    case 'query':
      return queryOptions.value
    case 'sort':
      return sorts.value.map(item => ({
        id: item,
        label: t(SORT_LABEL[item]),
        selected: sort.value === item,
      }))
    case 'season':
      return [
        {
          id: 'all',
          label: t('sources.allSeasons'),
          selected: view.value.season === undefined,
        },
        ...seasons.value.map(item => ({
          id: String(item),
          label: t('sources.seasonN', { n: item }),
          selected: view.value.season === item,
        })),
      ]
    case 'voice':
      return [
        {
          id: 'all',
          label: t('sources.allVoices'),
          selected: !view.value.voice,
        },
        ...voices.value.map(item => ({
          id: item.key,
          label: voiceLabel(item),
          selected: view.value.voice === item.key,
        })),
      ]
    case 'quality':
      return [
        {
          id: 'all',
          label: t('sources.allQualities'),
          selected: !view.value.quality,
        },
        ...qualities.value.map(item => ({
          id: item,
          label:
            item === 'unknown'
              ? t('sources.unknownQualityOption')
              : videoClassLabel(item),
          selected: view.value.quality === item,
        })),
      ]
    default:
      return []
  }
})

function openPanel(id: Control) {
  panelOpener = focus.current() ?? undefined
  queryDraft.value = query.value ?? ''
  panel.value = id
}

function closePanel() {
  panel.value = undefined

  nextTick(() => {
    if (panelOpener?.isConnected)
      focus.focusOn(panelOpener)
    else focus.activate('sources-list')
  })
}

function choose(id: string) {
  const all = id === 'all'

  switch (panel.value) {
    case 'query':
      setView({ query: all || id === 'auto' ? undefined : id.slice(2) })
      break
    case 'sort':
      setView({ sort: id as SourceSort })
      break
    case 'season':
      setView({ season: all ? undefined : Number(id) })
      break
    case 'voice':
      setView({ voice: all ? undefined : id })
      break
    case 'quality':
      setView({ quality: all ? undefined : (id as Quality) })
      break
  }

  closePanel()
}

const hasFilter = computed(
  () =>
    view.value.season !== undefined
    || !!view.value.voice
    || !!view.value.quality,
)

const emptyKind = computed(() => {
  if (!sources.value || rows.value.length > 0)
    return undefined

  if (sources.value.indexers.total === 0)
    return 'noIndexers'

  if (hasFilter.value)
    return 'filtered'

  if (allIndexersFailed(sources.value))
    return 'failed'

  return query.value ? 'nothingQuery' : 'nothing'
})

// Поиск ничего не дал: следующий шаг — уточнить, что искать
const canRefine = computed(
  () =>
    emptyKind.value === 'nothing'
    || emptyKind.value === 'nothingQuery'
    || emptyKind.value === 'failed',
)

const headerMeta = computed(() => {
  if (!sources.value || searching.value)
    return ''

  const minutes = minutesSince(sources.value.updatedAt, openedAt)

  return [
    t('sources.count', sources.value.candidates.length),
    minutes === 0
      ? t('sources.updatedNow')
      : t('sources.updated', { n: minutes }),
  ].join(' · ')
})

// По этому правилу выбрана раздача с меткой «По профилю»
const profileLine = computed(() => {
  if (!sources.value || searching.value)
    return ''

  const { qualities, voiceTypes, moreVoices } = profileParts(
    sources.value.profile,
  )
  const voices = voiceTypes.map(type => t(`sources.voiceTypes.${type}`))

  return t('sources.profile', {
    qualities: qualities.join(' → '),
    voices: [...voices, ...(moreVoices ? ['…'] : [])].join(' → '),
  })
})

// История: что и какой раздачей смотрели последний раз; OK — её «Файлы» на этой серии
const history = computed(() => historyOf(progress.value))
// У раздачи без качества и озвучки в имени строке нечего добавить
const historyText = computed(() =>
  history.value?.line
    ? t('sources.history', { line: history.value.line })
    : t('sources.lastWatched'),
)

function openHistory() {
  const value = history.value

  if (!value?.torrentId)
    return

  router.push({
    path: `/title/${props.id}/files/${value.torrentId}`,
    query: {
      season: value.season ? String(value.season) : undefined,
      episode: value.episode ? String(value.episode) : undefined,
    },
  })
}

// Длительность для битрейта: фильм — свой, сериал — серия выбранного сезона
const runtimeSeason = computed(() =>
  isSeries.value
    ? (view.value.season ?? title.value?.seasons?.[0]?.number)
    : undefined,
)
const { season: runtimeSource } = useTitleSeason(id, runtimeSeason)
const runtime = computed(() =>
  isSeries.value
    ? runtimeSource.value?.episodes.find(item => item.runtime)?.runtime
    : title.value?.runtime,
)

// Выбор раздачи: подключаем её и переходим к «Файлам»; ошибка — строкой под шапкой
const opening = ref<string>()
const openError = ref('')

async function openErrorKey(err: unknown) {
  switch (getErrorStatus(err)) {
    case 422: {
      const body = await getErrorBody<{ kind?: string }>(err)

      return body?.kind === 'candidate_gone' ? 'gone' : 'notPlayable'
    }
    case 503:
      return 'engine'
    case 401:
      return 'unauthorized'
    default:
      return 'unknown'
  }
}

// Файлы библиотеки для строки «В библиотеке»: по выбранному сезону, если он есть
const { libraryFiles } = useTitleLibrary(id)
const libraryRowFiles = computed(() => {
  const season = view.value.season

  return season === undefined
    ? libraryFiles.value
    : libraryFiles.value.filter(file => file.season === season)
})

// Строку «В библиотеке» выбрали сами: файл серии продолжения, без неё — первый
function playLibrary() {
  const resume = progress.value?.resume
  const own = libraryTarget(libraryRowFiles.value, isSeries.value, resume)
  const target = own ?? libraryRowFiles.value[0]

  if (!target)
    return

  router.push(
    libraryRoute(target.id, {
      id: props.id,
      season: target.season,
      episode: target.season
        ? own
          ? resume?.episode
          : target.episode
        : undefined,
    }),
  )
}

async function open(candidateId: string) {
  if (opening.value)
    return

  opening.value = candidateId
  openError.value = ''

  try {
    const result = await api.titles.postTitleOpen(props.id, {
      candidateId,
      query: query.value,
    })

    // Выбран сезон — «Файлы» встают на его первую серию; при «Скачать» —
    // отмечают его серии
    const season
      = props.download && props.season
        ? props.season
        : view.value.season === undefined
          ? undefined
          : String(view.value.season)

    router.push({
      path: `/title/${props.id}/files/${result.torrentId}`,
      query: { season, download: props.download ? '1' : undefined },
    })
  }
  catch (err) {
    openError.value = t(`watch.errors.${await openErrorKey(err)}`)
  }
  finally {
    opening.value = undefined
  }
}

// Порядок секций сверху вниз: из него — переходы стрелками вверх и вниз
const order = computed(() => {
  const list: string[] = []

  if (history.value?.torrentId)
    list.push('sources-history')

  list.push('sources-controls', 'sources-list')

  return list
})

function edgesOf(name: string) {
  const index = order.value.indexOf(name)

  return {
    up: index > 0 ? order.value[index - 1] : 'sources-back',
    down: order.value[index + 1],
  }
}

// Пока идёт поиск, фокус стоит на заглушке; список показался — встаём в него
watch(searching, (value) => {
  if (!value)
    nextTick(() => focus.activate('sources-list'))
})

// Возврат из «Файлов»: экран в KeepAlive, фокус — на той же раздаче
onActivated(() => {
  nextTick(() => {
    focus.activate('sources-list')
    snapRowPitch()
  })
})

const listSection = ref<InstanceType<typeof FocusSection>>()

/**
 * Строки раздач — с целым шагом в пикселях. Размеры в `u` дробные, и каждая
 * строка иначе стояла бы на своей доле пикселя: текст браузер прижимает к
 * пикселю, а значки — нет, и они плавали бы по вертикали от строки к строке.
 * Строки одной структуры и одной высоты, поэтому хватает одной мерки.
 */
function snapRowPitch() {
  const el = listSection.value?.$el as HTMLElement | undefined

  if (!el)
    return

  el.style.removeProperty('--source-row-height')
  el.style.removeProperty('--source-row-gap')

  // Строка в фокусе увеличена transform: меряем любую другую
  const rowsEls = Array.from(el.querySelectorAll<HTMLElement>('.source'))
  const row
    = rowsEls.find(item => item !== document.activeElement) ?? rowsEls[0]

  if (!row)
    return

  const height = Math.ceil(row.getBoundingClientRect().height)
  const gap = Math.round(Number.parseFloat(getComputedStyle(row).marginBottom))

  el.style.setProperty('--source-row-height', `${height}px`)
  el.style.setProperty('--source-row-gap', `${gap}px`)
}

watch(rows, () => nextTick(snapRowPitch))
onMounted(() => window.addEventListener('resize', snapRowPitch))
onBeforeUnmount(() => window.removeEventListener('resize', snapRowPitch))

function back() {
  goBack(router)
}

const meta = computed(() => {
  const value = title.value

  if (!value)
    return ''

  return [
    formatYears(value, t('title.ongoing')),
    t(value.kind === 'movie' ? 'title.movie' : 'title.series'),
    value.seasons?.length ? t('title.seasonCount', value.seasons.length) : '',
  ]
    .filter(Boolean)
    .join(' · ')
})
</script>

<template>
  <main class="sources">
    <img
      v-if="title?.backdrop"
      class="sources__backdrop"
      :src="title.backdrop"
      alt=""
      decoding="async"
    >
    <div class="sources__shade" />

    <FocusSection name="sources-back" :edges="{ down: order[0] }">
      <button v-focusable class="screen-back" type="button" @click="back">
        <AppIcon name="chevronLeft" />
        <span class="screen-back__label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>

    <aside v-if="title" class="sources__card">
      <img
        v-if="title.poster"
        class="sources__poster"
        :src="title.poster"
        :alt="title.title"
        decoding="async"
      >
      <h1 class="sources__name">
        {{ title.title }}
      </h1>
      <p class="sources__meta">
        {{ meta }}
      </p>
      <p v-if="title.overview" class="sources__overview">
        {{ title.overview }}
      </p>
    </aside>

    <section class="sources__main" :[NATIVE_WHEEL_ATTRIBUTE]="true">
      <header class="sources__head">
        <h2 class="sources__title">
          {{ t(download ? "download.sourcesTitle" : "sources.title") }}
        </h2>
        <p class="sources__head-meta">
          <!-- Пустая строка держит высоту, пока раздачи ищутся: ниже ничего не сдвигается -->
          {{ headerMeta || "\u00A0" }}
          <span
            v-if="sources && sources.indexers.failed.length > 0"
            class="sources__warn"
          >
            ·
            {{
              t("sources.failed", {
                failed: sources.indexers.failed.length,
                total: sources.indexers.total,
              })
            }}
          </span>
        </p>
        <p class="sources__head-meta sources__profile">
          {{ profileLine || "\u00A0" }}
        </p>
      </header>

      <FocusSection
        v-if="history?.torrentId"
        name="sources-history"
        class="sources__history-row"
        :edges="edgesOf('sources-history')"
      >
        <button v-focusable class="history" type="button" @click="openHistory">
          <AppIcon name="recent" class="history__icon" />
          {{ historyText }}
        </button>
      </FocusSection>
      <!-- «Нет истории» — только когда прогресс уже пришёл: без подмены текста, высота держится -->
      <p v-else class="history history--empty">
        <template
          v-if="
            history || progressStatus === 'ready' || progressStatus === 'error'
          "
        >
          <AppIcon name="recent" class="history__icon" />
          {{ history ? historyText : t("sources.historyEmpty") }}
        </template>
      </p>

      <FocusSection
        name="sources-controls"
        class="sources__controls"
        :edges="edgesOf('sources-controls')"
      >
        <button
          v-for="control in controls"
          :key="control.id"
          v-focusable
          class="chip"
          type="button"
          @click="openPanel(control.id)"
        >
          <span class="sources__control">{{ control.label }}</span>
        </button>
        <!-- Сброс — значком: строка фильтров не должна переноситься -->
        <button
          v-if="hasFilter"
          v-focusable
          class="chip sources__reset"
          type="button"
          :aria-label="t('sources.resetFilters')"
          :title="t('sources.resetFilters')"
          @click="resetFilters"
        >
          <AppIcon name="close" />
        </button>
      </FocusSection>

      <FocusSection
        ref="listSection"
        name="sources-list"
        class="sources__list"
        :edges="edgesOf('sources-list')"
        autofocus
      >
        <!-- Файл из библиотеки — первым и сразу: поиск раздач ему не нужен.
             В режиме загрузки каждая строка по OK качает — строки, которая
             играет, там нет -->
        <LibraryRow
          v-if="!download && libraryRowFiles.length > 0"
          :files="libraryRowFiles"
          @select="playLibrary"
        />

        <div
          v-if="searching"
          v-focusable
          class="sources__state sources__state--loading"
          tabindex="-1"
        >
          <AppLoader :label="t('watch.searching')" />
        </div>

        <div v-else-if="status === 'error'" class="sources__state">
          <p class="sources__state-title">
            {{ t("watch.searchFailed") }}
          </p>
          <button v-focusable class="action" type="button" @click="refresh">
            {{ t("sources.refresh") }}
          </button>
        </div>

        <template v-else>
          <div v-if="emptyKind" class="sources__state">
            <p class="sources__state-title">
              {{ t(`sources.empty.${emptyKind}.title`) }}
            </p>
            <p class="sources__state-text">
              {{ t(`sources.empty.${emptyKind}.text`, { query }) }}
            </p>
            <button
              v-if="canRefine"
              v-focusable
              class="action"
              type="button"
              @click="openPanel('query')"
            >
              {{ t("sources.query.action") }}
            </button>
          </div>

          <SourceRow
            v-for="candidate in rows"
            :key="candidate.id"
            :candidate="candidate"
            :runtime="runtime"
            :loading="opening === candidate.id"
            @select="open(candidate.id)"
          />

          <div class="sources__footer">
            <button v-focusable class="action" type="button" @click="refresh">
              {{ t("sources.refresh") }}
            </button>
          </div>
        </template>
      </FocusSection>
    </section>

    <AppToast :message="openError" @hide="openError = ''" />

    <OptionsPanel
      v-if="panel"
      :title="panelTitle"
      :options="panelOptions"
      @select="choose"
      @close="closePanel"
    >
      <template v-if="panel === 'query'" #top>
        <input
          v-model="queryDraft"
          v-focusable
          class="field sources__query-input"
          type="search"
          enterkeyhint="search"
          :aria-label="t('sources.query.placeholder')"
          :placeholder="t('sources.query.placeholder')"
          @keydown.enter="submitDraft"
        >
        <p class="sources__query-note">
          {{ t("sources.query.note") }}
        </p>
      </template>
    </OptionsPanel>
  </main>
</template>

<style scoped>
.sources {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: var(--color-bg);
}

.sources__backdrop,
.sources__shade {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.sources__backdrop {
  object-fit: cover;
  opacity: 0.35;
}

.sources__shade {
  background-image: linear-gradient(90deg, rgba(11, 13, 18, 0.7) 0%, var(--color-bg) 34%);
}

/* Слева — о чём экран: постер, название, мета и описание тайтла */
.sources__card {
  position: absolute;
  top: calc(var(--u) * 150);
  left: var(--safe-x);
  width: calc(var(--u) * 420);
}

.sources__poster {
  display: block;
  width: calc(var(--u) * 260);
  margin-bottom: calc(var(--u) * 28);
  border-radius: var(--radius-m);
}

.sources__name {
  margin: 0 0 calc(var(--u) * 12);
  font-size: var(--font-size-l);
  font-weight: 700;
  line-height: 1.15;
}

.sources__meta {
  margin: 0 0 calc(var(--u) * 20);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.sources__overview {
  display: -webkit-box;
  margin: 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  line-height: 1.45;
  -webkit-line-clamp: 8;
  -webkit-box-orient: vertical;
}

/* Справа — раздачи: шапка, история, сортировка и фильтры, список */
.sources__main {
  position: absolute;
  top: var(--safe-y);
  right: var(--safe-x);
  bottom: 0;
  left: calc(var(--u) * 600);
  display: flex;
  flex-direction: column;
}

.sources__title {
  margin: 0;
  font-size: var(--font-size-l);
  font-weight: 700;
}

.sources__head-meta {
  margin: calc(var(--u) * 8) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.sources__profile {
  margin-top: calc(var(--u) * 4);
  color: var(--color-text-dim);
}

.sources__warn {
  color: var(--color-warn);
}

.sources__history-row {
  margin-top: calc(var(--u) * 24);
}

.history {
  display: flex;
  align-items: center;
  min-height: calc(var(--u) * 64);
  margin: 0;
  padding: 0 calc(var(--u) * 26);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-glass);
  color: var(--color-text);
  font: inherit;
  font-size: var(--font-size-s);
  font-weight: 500;
  text-align: left;
}

.history:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.history--empty {
  margin-top: calc(var(--u) * 24);
  color: var(--color-text-dim);
  background: transparent;
  padding-left: 0;
}

.history__icon {
  margin-right: calc(var(--u) * 14);
}

.sources__controls {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  margin-top: calc(var(--u) * 20);
  padding: calc(var(--u) * 6) 0;
}

/* Длинное значение («Озвучка: HDRezka Studio») обрезается, а не переносит строку */
.sources__control {
  max-width: calc(var(--u) * 340);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sources__query-input {
  width: 100%;
  height: calc(var(--u) * 88);
  padding: 0 calc(var(--u) * 28);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.sources__query-note {
  margin: calc(var(--u) * 14) 0 calc(var(--u) * 24);
  color: var(--color-text-dim);
  font-size: calc(var(--u) * 22);
}

.sources__reset {
  justify-content: center;
  width: calc(var(--u) * 64);
  padding: 0;
  font-size: calc(var(--u) * 30);
}

/* Строки прокручиваются нативно: движок фокуса зовёт scrollIntoView */
.sources__list {
  flex: 1;
  margin: calc(var(--u) * 12) calc(var(--u) * -16) 0;
  padding: calc(var(--u) * 12) calc(var(--u) * 16) calc(var(--u) * 54);
  overflow-y: auto;
}

.sources__list::-webkit-scrollbar {
  display: none;
}

.sources__state {
  padding: calc(var(--u) * 40) 0;
}

/* Поиск идёт — лоадер по центру списка */
.sources__state--loading {
  display: flex;
  justify-content: center;
  padding-top: calc(var(--u) * 120);
}

.sources__state-title {
  margin: 0 0 calc(var(--u) * 12);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.sources__state-text {
  max-width: calc(var(--u) * 1000);
  margin: 0 0 calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.sources__footer {
  margin-top: calc(var(--u) * 24);
}
</style>
