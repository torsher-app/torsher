<script setup lang="ts">
import type { Episode } from '@torsher/api-client'
import type { PanelOption } from './OptionsPanel.vue'
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../focus/index.ts'
import AppIcon from './AppIcon.vue'
import EpisodeRow from './EpisodeRow.vue'
import FocusSection from './FocusSection.vue'
import OptionsPanel from './OptionsPanel.vue'

/**
 * Полный список серий сезона поверх карточки тайтла: строки по порядку, OK
 * отмечает серию просмотренной (как в ряду), плеер не запускается. Карточка под
 * панелью остаётся как была, Back возвращает на неё.
 */
const props = defineProps<{
  name: string
  poster?: string
  meta: string
  // «Сезон 2» и «24 серии · 2023»
  seasonLabel: string
  seasonLine: string
  // Сезоны для выбора; один сезон — чипа нет
  seasonOptions: PanelOption[]
  episodes: Episode[]
  loading: boolean
  // Серия, на которой открыть список
  focusNumber?: number
  detailOf: (episode: Episode) => string
  statusOf: (episode: Episode) => string
  progressOf: (episode: Episode) => number
  watchedOf: (episode: Episode) => boolean
  // Подсказка OK для фокусной серии; пусто — у серии нет действия
  hintOf: (episode: Episode) => string
}>()

const emit = defineEmits<{
  toggle: [episode: Episode]
  season: [number: number]
  close: []
}>()

const { t } = useI18n()
const focus = useFocus()
const root = ref<HTMLElement>()
const focused = ref<Episode>()
const seasonPanel = ref(false)
let seasonOpener: HTMLElement | undefined

function rowOf(number: number | undefined) {
  return number === undefined
    ? undefined
    : root.value?.querySelector<HTMLElement>(`[data-episode="${number}"]`)
}

// Строка в фокусе — посередине списка, как в «Файлах»
function reveal(el: HTMLElement) {
  el.scrollIntoView({ block: 'center' })
}

onMounted(() => {
  nextTick(() => {
    const row = rowOf(props.focusNumber)

    if (row && focus.focusOn(row, 'nav'))
      reveal(row)
  })
})

const stopFocus = focus.onFocus((el, via) => {
  if (!root.value?.contains(el))
    return

  const number = Number(el.dataset.episode)

  focused.value = number
    ? props.episodes.find(item => item.number === number)
    : undefined

  if (number && via === 'nav')
    reveal(el)
})

const stopKey = focus.onKey((action) => {
  if (action.type !== 'back')
    return false

  emit('close')

  return true
})

onBeforeUnmount(() => {
  stopFocus()
  stopKey()
})

function openSeasons() {
  seasonOpener = focus.current() ?? undefined
  seasonPanel.value = true
}

function closeSeasons() {
  seasonPanel.value = false

  nextTick(() => {
    if (seasonOpener?.isConnected)
      focus.focusOn(seasonOpener)
  })
}

function chooseSeason(id: string) {
  emit('season', Number(id))
  closeSeasons()
}
</script>

<template>
  <div ref="root" class="episode-list">
    <FocusSection
      name="episode-list-back"
      :edges="{
        down: seasonOptions.length > 1 ? 'episode-list-head' : 'episode-list',
      }"
    >
      <button
        v-focusable
        class="screen-back"
        type="button"
        @click="emit('close')"
      >
        <AppIcon name="chevronLeft" />
        <span class="screen-back__label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>

    <aside class="episode-list__card">
      <img
        v-if="poster"
        class="episode-list__poster"
        :src="poster"
        :alt="name"
        decoding="async"
      >
      <h1 class="episode-list__name">
        {{ name }}
      </h1>
      <p class="episode-list__meta">
        {{ meta }}
      </p>
    </aside>

    <section class="episode-list__main" :[NATIVE_WHEEL_ATTRIBUTE]="true">
      <header class="episode-list__head">
        <h2 class="episode-list__title">
          {{ seasonLabel }}
        </h2>
        <p class="episode-list__line">
          {{ seasonLine || "\u00A0" }}
        </p>
      </header>

      <!-- Строка чипа держит место и у сериала из одного сезона: список начинается с одной высоты -->
      <FocusSection
        v-if="seasonOptions.length > 1"
        name="episode-list-head"
        class="episode-list__controls"
        :edges="{ up: 'episode-list-back', down: 'episode-list' }"
      >
        <button v-focusable class="chip" type="button" @click="openSeasons">
          {{ t("title.episodeList.pickSeason") }}
          <AppIcon name="chevronDown" class="episode-list__chip-icon" />
        </button>
      </FocusSection>
      <div v-else class="episode-list__controls" />

      <FocusSection
        name="episode-list"
        class="episode-list__rows"
        :edges="{
          up:
            seasonOptions.length > 1
              ? 'episode-list-head'
              : 'episode-list-back',
        }"
        autofocus
      >
        <template v-if="loading">
          <span
            v-for="index in 4"
            :key="index"
            class="episode-list__skeleton skeleton"
            aria-hidden="true"
          />
        </template>
        <template v-else>
          <EpisodeRow
            v-for="item in episodes"
            :key="item.number"
            :episode="item"
            :detail="detailOf(item)"
            :status="statusOf(item)"
            :progress="progressOf(item)"
            :watched="watchedOf(item)"
            @select="emit('toggle', item)"
          />
        </template>
      </FocusSection>

      <!-- Подсказка всегда занимает строку: шаг по сериям ничего не сдвигает -->
      <p class="episode-list__hint">
        {{ (focused && hintOf(focused)) || "\u00A0" }}
      </p>
    </section>

    <OptionsPanel
      v-if="seasonPanel"
      :title="t('title.episodeList.seasonPanel')"
      :options="seasonOptions"
      @select="chooseSeason"
      @close="closeSeasons"
    />
  </div>
</template>

<style scoped>
/* Над карточкой и её кнопкой «Назад», под панелью выбора */
.episode-list {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  z-index: 15;
  overflow: hidden;
  background: var(--color-bg);
}

.episode-list__card {
  position: absolute;
  top: calc(var(--u) * 150);
  left: var(--safe-x);
  width: calc(var(--u) * 420);
}

.episode-list__poster {
  display: block;
  width: calc(var(--u) * 260);
  margin-bottom: calc(var(--u) * 28);
  border-radius: var(--radius-m);
}

.episode-list__name {
  margin: 0 0 calc(var(--u) * 12);
  font-size: var(--font-size-l);
  font-weight: 700;
  line-height: 1.15;
}

.episode-list__meta {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.episode-list__main {
  position: absolute;
  top: var(--safe-y);
  right: var(--safe-x);
  bottom: 0;
  left: calc(var(--u) * 600);
  display: flex;
  flex-direction: column;
}

.episode-list__title {
  margin: 0;
  font-size: var(--font-size-l);
  font-weight: 700;
}

.episode-list__line {
  margin: calc(var(--u) * 8) 0 0;
  color: var(--color-text-muted);
  font-size: var(--font-size-s);
}

.episode-list__chip-icon {
  margin-left: calc(var(--u) * 8);
}

.episode-list__controls {
  display: flex;
  align-items: center;
  height: calc(var(--u) * 76);
  margin-top: calc(var(--u) * 20);
}

/* Строки прокручиваются нативно: панель сама ставит фокусную посередине */
.episode-list__rows {
  flex: 1;
  margin: calc(var(--u) * 12) calc(var(--focus-ring-gap) * -1) 0;
  padding: calc(var(--u) * 12) var(--focus-ring-gap) calc(var(--u) * 24);
  overflow-y: auto;
}

.episode-list__rows::-webkit-scrollbar {
  display: none;
}

.episode-list__skeleton {
  display: block;
  height: calc(var(--u) * 194);
  margin-bottom: var(--space-1);
  border-radius: calc(var(--u) * 16);
}

.episode-list__hint {
  margin: 0;
  padding: calc(var(--u) * 18) 0 var(--safe-y);
  color: var(--color-text-dim);
  font-size: var(--font-size-s);
}
</style>
