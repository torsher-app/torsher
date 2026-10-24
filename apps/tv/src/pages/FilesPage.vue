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
import ActionButton from '../components/ActionButton.vue'
import AppIcon from '../components/AppIcon.vue'
import AppLoader from '../components/AppLoader.vue'
import ButtonRow from '../components/ButtonRow.vue'
import FocusSection from '../components/FocusSection.vue'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useCatalogTitle } from '../composables/useCatalogTitle.ts'
import { useHeldLoading } from '../composables/useHeldLoading.ts'
import { useSourceLabels } from '../composables/useSourceLabels.ts'
import AppToast from '../components/AppToast.vue'
import type { DownloadStep } from '../composables/useTitleDownload.ts'
import {
  startDownload,
  useDownloadTexts,
} from '../composables/useTitleDownload.ts'
import { useTitleMeta } from '../composables/useTitleMeta.ts'
import { loadSeason } from '../composables/useTitleSections.ts'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../focus/index.ts'
import { playerRoute } from '../lib/continue.ts'
import {
  downloadPercent,
  isSelectable,
  presetSelection,
  seasonSelection,
  selectionSummary,
  toggleAll,
  toggleSeason,
} from '../lib/download.ts'
import {
  FILES_POLL_INTERVAL_MS,
  FILES_POLL_LIMIT_MS,
  focusedFile,
  progressOf,
} from '../lib/files.ts'
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
  // Пришли с «Скачать»: выбор файлов сразу включён, серии сезона отмечены
  download?: boolean
}>()

// Пиры присылают метаданные не сразу: спрашиваем раз в 2 с, не дольше 90 с

const { t } = useI18n()
const router = useRouter()
// Сразу в плеер — только когда раздачу выбрали в «Источниках»: экран,
// открытый ссылкой или подставленный Back из плеера, показывает список, иначе
// Back из плеера снова вёл бы в плеер
const skipAllowed
  = !props.download && openedForward(router.options.history.state)
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
const actions = ref<HTMLElement>()
let stopped = false

// «Скачать выбранное»: OK на строке отмечает файл вместо плеера
const selecting = ref(false)
const selected = ref(new Set<number>())
const downloading = ref(false)
// Старт закачки: подключаем раздачу, у magnet — ждём от пиров список файлов
const downloadStep = ref<DownloadStep>()
const toast = ref('')
const texts = useDownloadTexts()
const summary = computed(() => selectionSummary(files.value, selected.value))
const allSelected = computed(() => {
  const selectable = files.value.filter(isSelectable)

  return (
    selectable.length > 0
    && selectable.every(file => selected.value.has(file.fileIndex))
  )
})

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
  const until = Date.now() + FILES_POLL_LIMIT_MS

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

    await sleep(FILES_POLL_INTERVAL_MS)
  }
}

const wanted = computed(() => ({
  season: props.season ? Number(props.season) : undefined,
  episode: props.episode ? Number(props.episode) : undefined,
}))

function rowAt(index: number) {
  return list.value?.querySelector<HTMLElement>(`[data-file="${index}"]`)
}

// Список показался — фокус на нужной серии; при «Скачать» — отметки
// сезона и фокус на «Скачать выбранное»
watch(waitingFiles, async (value) => {
  if (value || phase.value !== 'ready')
    return

  if (props.download && files.value.length > 0) {
    selected.value = presetSelection(files.value, wanted.value.season)
    selecting.value = true
    await nextTick()

    const button
      = actions.value?.querySelector<HTMLElement>('.files__download')

    if (button) {
      focus.focusOn(button)
      return
    }
  }

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
  const to = playerRoute(
    { torrentId: props.torrentId, fileIndex: file.fileIndex },
    { id: props.id, season: file.season, episode: file.episode },
  )

  if (replace)
    void router.replace(to)
  else void router.push(to)
}

const hasList = computed(
  () =>
    phase.value === 'ready' && !waitingFiles.value && files.value.length > 0,
)

function downloadLabel(file: TitleFile) {
  const download = file.download

  if (!download)
    return ''

  return download.state === 'downloading'
    ? t('download.state.downloading', { n: downloadPercent(download.progress) })
    : t(`download.state.${download.state}`)
}

function onRow(file: TitleFile) {
  if (!selecting.value) {
    play(file)
    return
  }

  if (!isSelectable(file))
    return

  const next = new Set(selected.value)

  if (!next.delete(file.fileIndex))
    next.add(file.fileIndex)

  selected.value = next
}

function startSelecting() {
  selected.value = new Set()
  selecting.value = true
  // Кнопка «Скачать…» сменилась: фокус — на строки, их и отмечают
  nextTick(focusInitial)
}

function stopSelecting(refocus: boolean) {
  if (props.download && refocus && !downloading.value) {
    back()
    return
  }

  selecting.value = false
  selected.value = new Set()

  if (refocus) {
    nextTick(() => {
      const button
        = actions.value?.querySelector<HTMLElement>('[data-focusable]')

      if (button)
        focus.focusOn(button)
    })
  }
}

// Файлы перечитываются без лоадера: значки загрузки и прогресс свежие
async function refreshFiles() {
  try {
    const result = await api.titles.getTitleFiles(props.id, props.torrentId)

    if (!stopped && result.status === 'ready')
      files.value = result.files
  }
  catch {
    // Значки обновятся на следующем шаге
  }
}

async function downloadSelected() {
  if (downloading.value || summary.value.count === 0)
    return

  downloading.value = true

  try {
    const result = await startDownload(
      props.id,
      {
        torrentId: props.torrentId,
        files: files.value
          .filter(file => selected.value.has(file.fileIndex))
          .map(file => file.fileIndex),
      },
      () => stopped,
      (step) => {
        downloadStep.value = step
      },
    )

    if (!result)
      return

    toast.value = texts.started(result)
    stopSelecting(true)
    await refreshFiles()
  }
  catch (err) {
    toast.value = await texts.errorOf(err)
  }
  finally {
    downloading.value = false
    downloadStep.value = undefined
  }
}

// Пока что-то качается или ждёт библиотеки, значки у файлов меняются сами
const refreshTimer = setInterval(() => {
  const changing = files.value.some(
    file =>
      file.download?.state === 'downloading'
      || file.download?.state === 'downloaded',
  )

  if (changing)
    void refreshFiles()
}, 5000)

// Назад в режиме выбора — выход из него, а не с экрана; пришли с «Скачать» —
// выбор и есть экран, Назад уводит обратно в «Источники»
const offKey = focus.onKey((action) => {
  if (action.type !== 'back' || !selecting.value || props.download)
    return false

  stopSelecting(false)
  return true
})

function back() {
  goBack(router)
}

onMounted(() => {
  void load()
})

onBeforeUnmount(() => {
  stopped = true
  clearInterval(refreshTimer)
  offKey()
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

    <FocusSection
      name="files-back"
      :edges="{ down: hasList ? 'files-actions' : 'files-list' }"
    >
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
            downloadStep
              ? t(`download.${downloadStep}Line`)
              : selecting
                ? t("files.selectHint")
                : phase === "ready" && !waitingFiles
                  ? `${t("files.title")} · ${t("files.count", files.length)}`
                  : "\u00A0"
          }}
        </p>
      </header>

      <!-- Строка действий постоянной высоты: кнопки появляются со списком -->
      <FocusSection
        name="files-actions"
        class="files__actions"
        :edges="{ up: 'files-back', down: 'files-list' }"
      >
        <div ref="actions">
          <ButtonRow>
            <ActionButton
              v-if="hasList && !selecting"
              v-focusable
              icon="download"
              :label="t('files.select')"
              class="files__select"
              @click="startSelecting"
            />
            <template v-else-if="hasList">
              <ActionButton
                v-focusable
                primary
                :label="
                  summary.count > 0
                    ? `${t('files.downloadSelected')} · ${t('download.files', summary.count)} · ${sizeLabel(summary.bytes)}`
                    : t('files.selectedNone')
                "
                class="files__download"
                :aria-disabled="summary.count === 0 || downloading"
                @click="downloadSelected"
              >
                <template #icon>
                  <AppLoader
                    v-if="downloading"
                    class="action-button__icon"
                    :size="40"
                  />
                  <AppIcon v-else name="download" class="action-button__icon" />
                </template>
              </ActionButton>
              <ActionButton
                v-focusable
                :label="t(allSelected ? 'files.clearAll' : 'files.selectAll')"
                @click="selected = toggleAll(files, selected)"
              />
              <ActionButton
                v-focusable
                :label="t('files.cancel')"
                @click="stopSelecting(true)"
              />
            </template>
          </ButtonRow>
        </div>
      </FocusSection>

      <FocusSection
        name="files-list"
        class="files__list"
        :edges="{ up: hasList ? 'files-actions' : 'files-back' }"
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
            <ActionButton
              v-focusable
              :label="t('files.toSources')"
              @click="back"
            />
          </div>

          <template v-for="(file, index) in files" v-else :key="file.fileIndex">
            <template
              v-if="
                grouped
                  && file.season !== null
                  && (index === 0 || files[index - 1]!.season !== file.season)
              "
            >
              <!-- В выборе заголовок отмечает весь сезон; размер тот же, что у h2 -->
              <button
                v-if="selecting"
                v-focusable
                class="files__season files__season--toggle"
                type="button"
                :aria-pressed="
                  seasonSelection(files, selected, file.season) === 'all'
                "
                @click="selected = toggleSeason(files, selected, file.season)"
              >
                {{ t("files.season", { n: file.season }) }}
                <span
                  class="files__season-check"
                  :class="`files__season-check--${seasonSelection(files, selected, file.season)}`"
                >
                  <AppIcon
                    :name="
                      seasonSelection(files, selected, file.season) === 'some'
                        ? 'minus'
                        : 'check'
                    "
                  />
                </span>
              </button>
              <h2 v-else class="files__season">
                {{ t("files.season", { n: file.season }) }}
              </h2>
            </template>
            <button
              v-focusable
              class="file"
              :class="{ 'file--watched': file.watched }"
              type="button"
              :data-file="index"
              :aria-pressed="
                selecting ? selected.has(file.fileIndex) : undefined
              "
              @click="onRow(file)"
            >
              <span class="file__frame">
                <img
                  v-if="imageOf(file)"
                  class="file__image"
                  :src="imageOf(file)"
                  alt=""
                  decoding="async"
                >
                <!-- Отметка выбора поверх кадра: строка не меняет размер -->
                <span
                  v-if="selecting && isSelectable(file)"
                  class="file__check"
                  :class="{ 'file__check--on': selected.has(file.fileIndex) }"
                >
                  <AppIcon name="check" />
                </span>
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
                <!-- Без серии TMDB имя файла уже в заголовке: второй раз не пишем, строка держит высоту -->
                <span class="file__name">{{
                  titleOf(file) === file.name ? "\u00A0" : file.name
                }}</span>
              </span>
              <span class="file__side">
                <span class="file__size">{{ sizeLabel(file.size) }}</span>
                <span
                  class="file__download"
                  :class="
                    file.download && `file__download--${file.download.state}`
                  "
                >
                  <AppIcon
                    v-if="file.download?.state === 'library'"
                    name="library"
                    class="file__download-icon"
                  />
                  {{ downloadLabel(file) || "\u00A0" }}
                </span>
              </span>
            </button>
          </template>
        </div>
      </FocusSection>
    </section>

    <AppToast :message="toast" @hide="toast = ''" />
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
  margin: calc(var(--u) * 12) calc(var(--focus-ring-gap) * -1) 0;
  padding: calc(var(--u) * 12) var(--focus-ring-gap) calc(var(--u) * 54);
  overflow-y: auto;
}

.files__list::-webkit-scrollbar {
  display: none;
}

.files__season {
  display: flex;
  align-items: center;
  height: calc(var(--u) * 52);
  margin: calc(var(--u) * 24) 0 calc(var(--u) * 12) calc(var(--u) * -16);
  padding: 0 calc(var(--u) * 16);
  color: var(--color-text-muted);
  font-size: var(--font-size-m);
  font-weight: 600;
  line-height: 1;
}

/* Кнопка сезона в выборе — тот же заголовок: шрифт и отступы не меняются.
   Во всю ширину, как строки: шаг вниз из кнопок над списком ищет элемент в
   колонке по центру, и узкий заголовок сбивал бы выбор */
.files__season--toggle {
  width: calc(100% + var(--u) * 16);
  border: 0;
  border-radius: calc(var(--u) * 26);
  background: transparent;
  font-family: inherit;
  transition: transform var(--motion-base) var(--motion-easing);
}

.files__season--toggle:focus {
  --bump-scale: 1.02;

  background: var(--color-focus);
  color: var(--color-bg);
  transform: scale(var(--bump-scale));
}

.files__season-check {
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 36);
  height: calc(var(--u) * 36);
  margin-left: calc(var(--u) * 14);
  border: calc(var(--u) * 3) solid currentColor;
  border-radius: 50%;
  color: transparent;
  font-size: calc(var(--u) * 22);
}

.files__season-check--none {
  border-color: var(--color-text-muted);
}

/* Как флажок таблицы: часть сезона — «–», весь сезон — «✓» */
.files__season-check--some,
.files__season-check--all {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-accent-ink);
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

.files__actions {
  height: calc(var(--u) * 84);
  margin-top: calc(var(--u) * 24);
}

.files__actions :deep(.action-button__icon) {
  font-size: calc(var(--u) * 36);
}

.files__download {
  font-variant-numeric: tabular-nums;
}

.files__download[aria-disabled='true']:not(:focus) {
  opacity: 0.6;
}

/* Размер и значок загрузки — колонка постоянной ширины справа */
.file__side {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  align-items: flex-end;
  width: calc(var(--u) * 240);
  margin-left: calc(var(--u) * 24);
}

.file__size {
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-variant-numeric: tabular-nums;
}

.file__download {
  display: inline-flex;
  align-items: center;
  margin-top: calc(var(--u) * 8);
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.file__download--library {
  color: var(--color-ok);
}

.file__download-icon {
  margin-right: calc(var(--u) * 8);
}

/* Отметка выбора: круг в углу кадра, залитый у выбранного файла */
.file__check {
  position: absolute;
  top: calc(var(--u) * 10);
  left: calc(var(--u) * 10);
  display: flex;
  align-items: center;
  justify-content: center;
  width: calc(var(--u) * 44);
  height: calc(var(--u) * 44);
  border: calc(var(--u) * 3) solid #fff;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
  color: transparent;
  font-size: calc(var(--u) * 28);
}

.file__check--on {
  border-color: var(--color-accent);
  background: var(--color-accent);
  color: var(--color-accent-ink);
}

.file--watched:not(:focus) .file__title {
  color: var(--color-text-muted);
}

.file:focus .file__detail,
.file:focus .file__name,
.file:focus .file__size,
.file:focus .file__download {
  color: var(--color-bg);
}
</style>
