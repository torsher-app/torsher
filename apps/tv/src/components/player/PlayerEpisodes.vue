<script setup lang="ts">
import type {
  Episode,
  EpisodeProgress,
  TitleSeason,
} from '@torsher/api-client'
import { computed, nextTick, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.ts'
import { useCatalogLanguage } from '../../composables/useCatalogLanguage.ts'
import { useHeldLoading } from '../../composables/useHeldLoading.ts'
import { useResumeLabels } from '../../composables/useResumeLabels.ts'
import { loadSeason } from '../../composables/useTitleSections.ts'
import { NATIVE_WHEEL_ATTRIBUTE, useFocus } from '../../focus/index.ts'
import AppLoader from '../AppLoader.vue'
import FocusSection from '../FocusSection.vue'
import ProgressTrack from '../ProgressTrack.vue'
import PanelRow from './PanelRow.vue'
import PlayerPanel from './PlayerPanel.vue'

/**
 * Серии в плеере: сезоны чипами и вышедшие серии сезона. Выбор переходит к
 * серии, не выходя из плеера; в той же раздаче — сразу, иначе ищется раздача.
 */
const props = defineProps<{
  titleId: string
  seasons: TitleSeason[]
  season: number
  episode: number
  /** Раздача, которую смотрят: в ней отмечаем, какие серии уже есть; у файла библиотеки её нет */
  torrentId?: string
}>()

const emit = defineEmits<{
  select: [target: { season: number, episode: number, fileIndex?: number }]
}>()

const { t } = useI18n()
const focus = useFocus()
const language = useCatalogLanguage()
const { durationText } = useResumeLabels()

const selected = ref(props.season)
const episodes = shallowRef<Episode[]>([])
const progress = shallowRef(new Map<string, EpisodeProgress>())
// Файлы раздачи по ключу «сезон:серия»
const files = shallowRef(new Map<string, number>())
const loading = ref(true)
const showsLoader = useHeldLoading(() => loading.value)
const listElement = ref<HTMLElement>()

function keyOf(season: number, episode: number) {
  return `${season}:${episode}`
}

const aired = computed(
  () =>
    props.seasons.find(item => item.number === selected.value)
      ?.airedEpisodeCount ?? 0,
)

const visible = computed(() =>
  episodes.value.filter(item => item.number <= aired.value),
)

function isCurrent(item: Episode) {
  return selected.value === props.season && item.number === props.episode
}

function shareOf(item: Episode) {
  const row = progress.value.get(keyOf(selected.value, item.number))

  if (!row)
    return 0

  return row.watched ? 1 : row.duration ? row.position / row.duration : 0
}

function detailOf(item: Episode) {
  const row = progress.value.get(keyOf(selected.value, item.number))
  const state = isCurrent(item)
    ? t('player.episodes.current')
    : row?.watched
      ? t('player.episodes.watched')
      : row && row.position > 0 && row.duration
        ? t('continue.remaining', {
            time: durationText(row.duration - row.position),
          })
        : item.runtime
          ? t('title.runtimeMinutes', { minutes: item.runtime })
          : ''
  const here = files.value.has(keyOf(selected.value, item.number))
    ? t('player.episodes.inTorrent')
    : ''

  return [state, here].filter(Boolean).join(' · ')
}

async function loadEpisodes(season: number) {
  loading.value = true

  try {
    const details = await loadSeason(props.titleId, season, language.value)

    if (selected.value === season)
      episodes.value = details.episodes
  }
  catch {
    if (selected.value === season)
      episodes.value = []
  }

  if (selected.value === season)
    loading.value = false
}

function chooseSeason(season: number) {
  if (season === selected.value)
    return

  selected.value = season
  void loadEpisodes(season)
}

function choose(item: Episode) {
  emit('select', {
    season: selected.value,
    episode: item.number,
    fileIndex: files.value.get(keyOf(selected.value, item.number)),
  })
}

// Список показался: фокус на текущей серии, в другом сезоне — на первой
watch(showsLoader, async (shown) => {
  if (shown)
    return

  await nextTick()

  const row = listElement.value?.querySelector<HTMLElement>('[data-current]')

  if (row) {
    focus.focusOn(row)
    row.scrollIntoView({ block: 'center' })
  }
  else {
    focus.activate(
      visible.value.length > 0 ? 'player-episodes' : 'player-seasons',
    )
  }
})

onMounted(() => {
  void loadEpisodes(selected.value)

  // Прогресс и файлы раздачи только дополняют строки: без них список тот же
  api.titles
    .getTitleProgress(props.titleId, { language: language.value })
    .then((result) => {
      progress.value = new Map(
        result.episodes.map(row => [keyOf(row.season, row.episode), row]),
      )
    })
    .catch(() => {})
  if (props.torrentId) {
    api.titles
      .getTitleFiles(props.titleId, props.torrentId)
      .then((result) => {
        const map = new Map<string, number>()

        for (const file of result.files) {
          if (file.season !== null && file.episode !== null)
            map.set(keyOf(file.season, file.episode), file.fileIndex)
        }

        files.value = map
      })
      .catch(() => {})
  }
})
</script>

<template>
  <PlayerPanel :title="t('player.episodes.button')">
    <div class="episodes">
      <FocusSection
        name="player-seasons"
        class="episodes__seasons"
        :edges="{ down: 'player-episodes' }"
      >
        <button
          v-for="item in seasons"
          :key="item.number"
          v-focusable
          class="chip"
          :class="{ 'chip--selected': item.number === selected }"
          type="button"
          @click="chooseSeason(item.number)"
        >
          {{ t("player.episodes.season", { n: item.number }) }}
        </button>
      </FocusSection>

      <div class="episodes__body">
        <AppLoader v-if="showsLoader" class="episodes__loader" />
        <div
          v-else
          ref="listElement"
          class="episodes__list"
          :[NATIVE_WHEEL_ATTRIBUTE]="true"
        >
          <FocusSection
            name="player-episodes"
            :edges="{ up: 'player-seasons' }"
          >
            <PanelRow
              v-for="item in visible"
              :key="item.number"
              :data-current="isCurrent(item) ? '' : undefined"
              :label="`${item.number}. ${item.title}`"
              :detail="detailOf(item)"
              @select="choose(item)"
            >
              <template #leading>
                <span class="episodes__frame">
                  <img
                    v-if="item.still"
                    class="episodes__still"
                    :src="item.still"
                    alt=""
                    decoding="async"
                  >
                  <ProgressTrack
                    v-if="shareOf(item) > 0"
                    :value="shareOf(item)"
                  />
                </span>
              </template>
            </PanelRow>
          </FocusSection>
        </div>
      </div>
    </div>
  </PlayerPanel>
</template>

<style scoped>
.episodes {
  display: flex;
  flex-direction: column;
  height: 100%;
}

/* Сезоны — одной строкой: у долгих сериалов их десятки, фокус прокручивает строку */
.episodes__seasons {
  display: flex;
  flex-shrink: 0;
  /* Прокрутка обрезает всё за краем: запас под увеличение чипа в фокусе,
     поля возвращают строку на место */
  margin: 0 calc(var(--u) * -16);
  padding: calc(var(--u) * 6) calc(var(--u) * 16) calc(var(--u) * 22);
  overflow-x: auto;
}

.episodes__seasons::-webkit-scrollbar {
  display: none;
}

.episodes__seasons .chip {
  flex-shrink: 0;
}

.episodes__body {
  position: relative;
  flex: 1;
  min-height: 0;
}

.episodes__loader {
  position: absolute;
  top: 40%;
  left: 50%;
  transform: translate(-50%, -50%);
}

.episodes__list {
  height: 100%;
  /* Запас под увеличение строки в фокусе (×1.06 от ширины панели): прокрутка
     обрезает её края */
  margin: 0 calc(var(--u) * -24);
  padding: calc(var(--u) * 6) calc(var(--u) * 24);
  overflow-y: auto;
}

.episodes__list::-webkit-scrollbar {
  display: none;
}

.episodes__frame {
  position: relative;
  flex-shrink: 0;
  width: calc(var(--u) * 192);
  height: calc(var(--u) * 108);
  margin-right: calc(var(--u) * 22);
  overflow: hidden;
  border-radius: var(--radius-m);
  background: var(--color-surface-raised);
}

.episodes__still {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
