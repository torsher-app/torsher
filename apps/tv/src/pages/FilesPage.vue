<script setup lang="ts">
import { goBack, openedForward } from '../lib/navigation.ts'
import type { Episode, TitleFile } from '@torsher/api-client'
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  toRef,
  watch,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { api } from '../api.ts'
import AppIcon from '../components/AppIcon.vue'
import AppLoader from '../components/AppLoader.vue'
import FocusSection from '../components/FocusSection.vue'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useCatalogTitle } from '../composables/useCatalogTitle.ts'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import { useTitleMeta } from '../composables/useTitleMeta.ts'
import { loadSeason } from '../composables/useTitleSections.ts'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../focus/index.ts'
import { focusedFile, progressOf } from '../lib/files.ts'
import { formatPublishDate } from '../lib/titleInfo.ts'

defineOptions({ name: 'FilesPage' })

/**
 * «Файлы» выбранной раздачи: подключаемся, ждём список файлов от пиров и
 * показываем видео по порядку — у сериала с сериями TMDB и прогрессом. Выбор
 * файла запускает плеер; из плеера Back возвращает сюда. Единственный файл
 * открывается в плеере сразу, на месте этого экрана.
 */
const props = defineProps<{
  id: string
  torrentId: string
  // С какой серии пришли (история): на неё встаёт фокус
  season?: string
  episode?: string
}>()

// Пиры присылают метаданные не сразу: спрашиваем раз в 2 с, не дольше 90 с
const POLL_INTERVAL_MS = 2000
const POLL_LIMIT_MS = 90_000

const { t } = useI18n()
const router = useRouter()
// Сразу в плеер — только когда раздачу выбрали в «Источниках»: экран,
// открытый ссылкой или подставленный Back из плеера, показывает список, иначе
// Back из плеера снова вёл бы в плеер
const skipAllowed = openedForward(router.options.history.state)
const focus = useFocus()
const language = useCatalogLanguage()
const id = toRef(props, 'id')
const { title } = useCatalogTitle(id)
const { sizeLabel } = useSourceLabels()
const { formatRuntime } = useTitleMeta()

const phase = ref<'connecting' | 'waiting' | 'ready' | 'timeout' | 'error'>(
  'connecting',
)
// Ожидание для экрана: показавшийся лоадер держится минимум, список и счётчик
// в шапке приходят вместе с ним одним шагом
const waitingFiles = useHeldLoading(
  () => phase.value === 'connecting' || phase.value === 'waiting',
)
const files = ref<TitleFile[]>([])
const releaseName = ref('')
const episodes = ref(new Map<string, Episode>())
const list = ref<HTMLElement>()
let stopped = false

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// Названия и кадры серий — из сезонов TMDB, которые есть в раздаче
async function loadEpisodes(items: TitleFile[]) {
  // Без flatMap: его нет в Chromium 68
  const numbers = Array.from(
    new Set(
      items
        .map(item => item.season)
        .filter((season): season is number => season !== null),
    ),
  )
  const map = new Map<string, Episode>()

  await Promise.all(
    numbers.map(async (number) => {
      try {
        const details = await loadSeason(props.id, number, language.value)

        for (const item of details.episodes)
          map.set(`${number}:${item.number}`, item)
      }
      catch {
        // Без TMDB строка покажет имя файла
      }
    }),
  )

  episodes.value = map
}

async function load() {
  const until = Date.now() + POLL_LIMIT_MS

  for (;;) {
    if (stopped)
      return

    if (Date.now() >= until) {
      phase.value = 'timeout'

      return
    }

    try {
      const result = await api.titles.getTitleFiles(props.id, props.torrentId)

      if (stopped)
        return

      releaseName.value = result.name

      if (result.status === 'ready') {
        // Выбирать не из чего: плеер встаёт на место экрана, и Back из него
        // ведёт в «Источники». До перехода остаётся лоадер
        if (result.files.length === 1 && skipAllowed) {
          play(result.files[0]!, true)

          return
        }

        // Серии TMDB до показа списка: иначе строки перерисуются с имён файлов
        await loadEpisodes(result.files)

        if (stopped)
          return

        files.value = result.files
        phase.value = 'ready'

        return
      }

      phase.value = 'waiting'
    }
    catch {
      phase.value = 'error'

      return
    }

    await sleep(POLL_INTERVAL_MS)
  }
}

const wanted = computed(() => ({
  season: props.season ? Number(props.season) : undefined,
  episode: props.episode ? Number(props.episode) : undefined,
}))

function rowAt(index: number) {
  return list.value?.querySelector<HTMLElement>(`[data-file="${index}"]`)
}

// Список показался — фокус на нужной серии
watch(waitingFiles, async (value) => {
  if (value || phase.value !== 'ready')
    return

  await nextTick()
  focusInitial()
})

function focusInitial() {
  const row = rowAt(focusedFile(files.value, wanted.value))

  if (row) {
    focus.focusOn(row)
    // Серия из истории или сезона — посередине экрана, а не у края
    row.scrollIntoView({ block: 'center' })
  }
  else {
    focus.activate('files-list')
  }
}

// Заголовки сезонов — только если в раздаче их несколько
const grouped = computed(
  () => new Set(files.value.map(item => item.season)).size > 1,
)

function episodeOf(file: TitleFile) {
  return file.season !== null && file.episode !== null
    ? episodes.value.get(`${file.season}:${file.episode}`)
    : undefined
}

function titleOf(file: TitleFile) {
  const episode = episodeOf(file)

  if (episode)
    return `${episode.number}. ${episode.title}`

  if (files.value.length === 1 && title.value)
    return title.value.title

  return file.name
}

function detailOf(file: TitleFile) {
  const episode = episodeOf(file)

  return [
    file.season !== null ? t('files.season', { n: file.season }) : '',
    episode?.airDate ? formatPublishDate(episode.airDate, language.value) : '',
    episode?.runtime ? formatRuntime(episode.runtime) : '',
    file.watched ? t('files.watched') : leftOf(file),
  ]
    .filter(Boolean)
    .join(' · ')
}

// Начатая серия: сколько осталось, как у полосы на кадре
function leftOf(file: TitleFile) {
  if (file.position <= 0 || !file.duration)
    return ''

  return t('title.left', {
    n: Math.max(1, Math.round((file.duration - file.position) / 60)),
  })
}

function imageOf(file: TitleFile) {
  return (
    episodeOf(file)?.still
    ?? (files.value.length === 1 ? title.value?.backdrop : undefined)
  )
}

function play(file: TitleFile, replace = false) {
  const to = {
    path: `/play/${props.torrentId}/${file.fileIndex}`,
    query: {
      title: props.id,
      season: file.season === null ? undefined : String(file.season),
      episode: file.episode === null ? undefined : String(file.episode),
    },
  }

  if (replace)
    void router.replace(to)
  else void router.push(to)
}

function back() {
  goBack(router)
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  stopped = true
})
</script>

<template>
  <main class="files">
    <img
      v-if="title?.backdrop"
      class="files__backdrop"
      :src="title.backdrop"
      alt=""
      decoding="async"
    >
    <div class="files__shade" />

    <FocusSection name="files-back" :edges="{ down: 'files-list' }">
      <button v-focusable class="screen-back" type="button" @click="back">
        <AppIcon name="chevronLeft" />
        <span class="screen-back__label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>

    <section class="files__main" :[NATIVE_WHEEL_ATTRIBUTE]="true">
      <header class="files__head">
        <h1 class="files__title">
          {{ title?.title ?? t("files.title") }}
        </h1>
        <!-- Строки на месте с первого кадра: появление текста не сдвигает список -->
        <p class="files__release">
          {{ releaseName || "\u00A0" }}
        </p>
        <p class="files__meta">
          {{
            phase === "ready" && !waitingFiles
              ? `${t("files.title")} · ${t("files.count", files.length)}`
              : "\u00A0"
          }}
        </p>
      </header>

      <FocusSection
        name="files-list"
        class="files__list"
        :edges="{ up: 'files-back' }"
        autofocus
      >
        <div ref="list">
          <div
            v-if="waitingFiles"
            v-focusable
            class="files__state files__state--loading"
            tabindex="-1"
          >
            <AppLoader
              :label="
                t(phase === 'connecting' ? 'files.connecting' : 'files.waiting')
              "
            />
          </div>

          <div
            v-else-if="
              phase === 'timeout' || phase === 'error' || files.length === 0
            "
            class="files__state"
          >
            <p class="files__state-title">
              {{ t(`files.${phase === "ready" ? "empty" : phase}`) }}
            </p>
            <button v-focusable class="action" type="button" @click="back">
              {{ t("files.toSources") }}
            </button>
          </div>

          <template v-for="(file, index) in files" v-else :key="file.fileIndex">
            <h2
              v-if="
                grouped
                  && file.season !== null
                  && (index === 0 || files[index - 1]!.season !== file.season)
              "
              class="files__season"
            >
              {{ t("files.season", { n: file.season }) }}
            </h2>
            <button
              v-focusable
              class="file"
              :class="{ 'file--watched': file.watched }"
              type="button"
              :data-file="index"
              @click="play(file)"
            >
              <span class="file__frame">
                <img
                  v-if="imageOf(file)"
                  class="file__image"
                  :src="imageOf(file)"
                  alt=""
                  decoding="async"
                >
                <span v-if="file.episode !== null" class="file__number">
                  {{ file.episode }}
                </span>
                <span v-if="progressOf(file) > 0" class="file__track">
                  <span
                    class="file__progress"
                    :style="{ transform: `scaleX(${progressOf(file)})` }"
                  />
                </span>
              </span>
              <span class="file__body">
                <span class="file__title">{{ titleOf(file) }}</span>
                <span class="file__detail">{{ detailOf(file) }}</span>
                <span class="file__name">{{ file.name }}</span>
              </span>
              <span class="file__size">{{ sizeLabel(file.size) }}</span>
            </button>
          </template>
        </div>
      </FocusSection>
    </section>
  </main>
</template>

<style scoped>
.files {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: var(--color-bg);
}

.files__backdrop,
.files__shade {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.files__backdrop {
  object-fit: cover;
  opacity: 0.3;
}

.files__shade {
  background-image: linear-gradient(180deg, rgba(11, 13, 18, 0.6) 0%, var(--color-bg) 60%);
}

.files__main {
  position: absolute;
  top: calc(var(--u) * 140);
  right: var(--safe-x);
  bottom: 0;
  left: var(--content-x);
  display: flex;
  flex-direction: column;
}

.files__title {
  margin: 0;
  font-size: var(--font-size-l);
  font-weight: 700;
}

.files__release {
  margin: calc(var(--u) * 10) 0 0;
  overflow: hidden;
  color: var(--color-text-muted);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: calc(var(--u) * 20);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.files__meta {
  margin: calc(var(--u) * 8) 0 0;
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
}

/* Строки прокручиваются нативно: движок фокуса зовёт scrollIntoView */
.files__list {
  flex: 1;
  margin: calc(var(--u) * 24) calc(var(--u) * -16) 0;
  padding: calc(var(--u) * 12) calc(var(--u) * 16) calc(var(--u) * 54);
  overflow-y: auto;
}

.files__list::-webkit-scrollbar {
  display: none;
}

.files__season {
  margin: calc(var(--u) * 24) 0 calc(var(--u) * 12);
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  font-weight: 600;
}

.files__state {
  padding: calc(var(--u) * 40) 0;
}

/* Ждём список файлов — лоадер по центру экрана, без текста-заглушки */
.files__state--loading {
  display: flex;
  justify-content: center;
  padding-top: calc(var(--u) * 160);
}

.files__state-title {
  margin: 0 0 calc(var(--u) * 24);
  font-size: var(--font-size-m);
  font-weight: 600;
}

/* Строка файла: кадр серии · название, сезон и дата, имя файла · размер */
.file {
  display: flex;
  align-items: center;
  width: 100%;
  margin-bottom: var(--space-1);
  padding: calc(var(--u) * 16) calc(var(--u) * 24) calc(var(--u) * 16) calc(var(--u) * 16);
  border: 0;
  border-radius: calc(var(--u) * 16);
  background: var(--color-surface-raised);
  color: var(--color-text);
  font: inherit;
  text-align: left;
  /* Заливка без перехода: список прокручивается нативно, как у строк «Источников» */
  transition: transform var(--motion-base) var(--motion-easing);
}

.file:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

/* 16:9 через padding: aspect-ratio появился только в Chromium 88 */
.file__frame {
  position: relative;
  flex-shrink: 0;
  width: calc(var(--u) * 240);
  height: calc(var(--u) * 135);
  margin-right: calc(var(--u) * 28);
  overflow: hidden;
  border-radius: calc(var(--u) * 10);
  background: var(--color-surface);
}

.file__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.file__number {
  position: absolute;
  right: calc(var(--u) * 12);
  bottom: calc(var(--u) * 6);
  color: #fff;
  font-size: calc(var(--u) * 44);
  font-weight: 700;
  text-shadow: 0 0 calc(var(--u) * 12) rgba(0, 0, 0, 0.8);
}

/* Дорожка видна целиком: короткий прогресс читается как доля, а не как соринка */
.file__track {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: calc(var(--u) * 6);
  background: rgba(255, 255, 255, 0.25);
}

.file__progress {
  display: block;
  height: 100%;
  background: var(--color-accent);
  transform-origin: left center;
}

.file__body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.file__title {
  overflow: hidden;
  font-size: var(--font-size-m);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file__detail {
  margin-top: calc(var(--u) * 6);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.file__name {
  margin-top: calc(var(--u) * 6);
  overflow: hidden;
  color: var(--color-text-dim);
  font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: calc(var(--u) * 18);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file__size {
  flex-shrink: 0;
  margin-left: calc(var(--u) * 24);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.file--watched:not(:focus) .file__title {
  color: var(--color-text-muted);
}

.file:focus .file__detail,
.file:focus .file__name,
.file:focus .file__size {
  color: var(--color-bg);
}
</style>
