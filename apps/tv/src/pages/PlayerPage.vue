<script setup lang="ts">
import type { TitleDetails } from '@torsher/api-client'
import type { KeyAction } from '../focus/index.ts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PlayerBuffering from '../components/player/PlayerBuffering.vue'
import PlayerOsd from '../components/player/PlayerOsd.vue'
import PlayerPrompt from '../components/player/PlayerPrompt.vue'
import PlayerStage from '../components/player/PlayerStage.vue'
import AppLoader from '../components/AppLoader.vue'
import AppIcon from '../components/AppIcon.vue'
import FocusSection from '../components/FocusSection.vue'
import PlayerTracks from '../components/player/PlayerTracks.vue'
import type { PlaybackRestart } from '../composables/usePlayback.ts'
import { api } from '../api.ts'
import { useCatalogLanguage } from '../composables/useCatalogLanguage.ts'
import { useHls } from '../composables/useHls.ts'
import { usePlayback } from '../composables/usePlayback.ts'
import { usePlayerTracks } from '../composables/usePlayerTracks.ts'
import { usePlayerOsd } from '../composables/usePlayerOsd.ts'
import { useResource } from '../composables/useResource.ts'
import { loadSeason } from '../composables/useTitleSections.ts'
import { useFocus } from '../focus/index.ts'
import {
  backAction,
  bufferedSeconds,
  bufferingStep,
  byteOffset,
  clampTime,
  formatDuration,
  formatGigabytes,
  videoTimePolicy,
} from '../lib/player.ts'
import { goBack } from '../lib/navigation.ts'
import { titleRefOf } from '../lib/sources.ts'

const props = defineProps<{
  torrentId: string
  fileIndex: string
  // Открыт из карточки тайтла: позиция сохраняется по серии, а не по файлу
  titleId?: string
  season?: string
  episode?: string
}>()

// Позиция сохраняется по ходу просмотра, а не только на выходе: ТВ могут выключить
const SAVE_EVERY_S = 10

const { t, locale } = useI18n()
const router = useRouter()
const focus = useFocus()
const player = usePlayback(
  props.torrentId,
  Number(props.fileIndex),
  titleRefOf(props.titleId, props.season, props.episode),
)
const { playback, stats } = player

// Экран подготовки: кадр, логотип и серия тайтла — если плеер открыт из карточки
const language = useCatalogLanguage()
const { data: art } = useResource<TitleDetails>(
  computed(() =>
    props.titleId ? `${props.titleId}:${language.value}` : undefined,
  ),
  (_, signal) =>
    api.catalog.getCatalogTitle(
      props.titleId!,
      { language: language.value },
      { signal },
    ),
)
const episodeName = ref('')

if (props.titleId && props.season && props.episode) {
  loadSeason(props.titleId, Number(props.season), language.value)
    .then((details) => {
      episodeName.value
        = details.episodes.find(item => item.number === Number(props.episode))
          ?.title ?? ''
    })
    .catch(() => {
      // Без названия серии — только номер
    })
}

const artSubtitle = computed(() =>
  props.season && props.episode
    ? [
        t('player.episodeOf', { season: props.season, episode: props.episode }),
        episodeName.value,
      ]
        .filter(Boolean)
        .join(' · ')
    : '',
)

// Название на сцене: тайтл из каталога, пока его нет — имя из ответа сервера
const stageTitle = computed(
  () =>
    art.value?.title
    ?? playback.value?.title
    ?? player.pending.value?.title
    ?? '',
)

// Где остановились: «23:27 из 52:41» и та же доля на дорожке
const resumeText = computed(() => {
  const start = playback.value?.startPosition ?? 0
  const total = playback.value?.duration

  return total
    ? t('player.resume.textOf', {
        time: formatDuration(start),
        total: formatDuration(total),
      })
    : t('player.resume.text', { time: formatDuration(start) })
})

const resumeShare = computed(() => {
  const total = playback.value?.duration

  return total
    ? Math.min(1, (playback.value?.startPosition ?? 0) / total)
    : undefined
})

const video = ref<HTMLVideoElement>()
const hls = useHls(() => player.fail('unknown'))

// starting — запрашиваем адрес, resume — спрашиваем, продолжить ли,
// buffering — ждём первые кадры, playing — видео хоть раз пошло
const phase = ref<'starting' | 'resume' | 'buffering' | 'playing'>('starting')
const stalled = ref(false)
const paused = ref(false)
const position = ref(0)
const tracks = usePlayerTracks(playback, video, position, restartWith)
const duration = ref(Number.NaN)
const panel = ref<'audio' | 'subtitles' | null>(null)
const now = ref(new Date())
const bufferingSince = ref(Date.now())
// Смена дорожки перезапуском: до нового потока на экране сцена с лоадером, а
// клавиши, кроме Back, не работают — перемотка потерялась бы при старте
const restarting = ref(false)

let startAt = 0
let savedAt = 0
let clockTimer: ReturnType<typeof setInterval> | undefined
let offKey: (() => void) | undefined

const knownDuration = computed(() =>
  Number.isFinite(duration.value)
    ? duration.value
    : (playback.value?.duration ?? Number.NaN),
)

const osd = usePlayerOsd({
  canAutoHide: () => !paused.value && !panel.value,
  position: () => position.value,
  duration: () => knownDuration.value,
  // OSD мог появиться вместе с переходом в `playing`: таймлайн ещё не в DOM
  onShow: () => void nextTick(() => focus.activate('player-timeline')),
  onSeek: seekTo,
})

const step = computed(() =>
  bufferingStep(
    stats.value ?? null,
    now.value.getTime() - bufferingSince.value,
  ),
)

// Буфер впереди — большее из скачанного движком подряд и того, что уже у браузера
const bufferSeconds = computed(() => {
  const fromEngine = bufferedSeconds(
    stats.value?.file.bufferedAhead ?? 0,
    playback.value?.size ?? 0,
    knownDuration.value,
  )
  const el = video.value
  let fromBrowser = 0

  if (el) {
    for (let i = 0; i < el.buffered.length; i++) {
      if (
        el.buffered.start(i) <= position.value
        && el.buffered.end(i) >= position.value
      ) {
        fromBrowser = el.buffered.end(i) - position.value
      }
    }
  }

  return Math.max(fromEngine, fromBrowser)
})

const trackOptions = computed(() =>
  panel.value === 'audio'
    ? tracks.audioOptions.value
    : tracks.subtitleOptions.value,
)

// Смена дорожки, которую плеер не переключит сам, перезапускает поток
const tracksHint = computed(() =>
  panel.value === 'audio' && playback.value?.audioSwitch === 'restart'
    ? t('player.restartHint')
    : undefined,
)

// «Назад» под указкой: видна вместе с OSD и на экранах до старта. У окна
// ошибки своя кнопка «Назад» — вторая сверху не нужна
const backVisible = computed(
  () =>
    player.status.value !== 'error'
    && (phase.value !== 'playing' || osd.visible.value),
)

const errorKey = computed(() => {
  if (player.error.value === 'engine')
    return `player.errors.engine.${player.engineKind.value ?? 'starting'}`

  if (player.error.value === 'storage')
    return `player.errors.storage.${player.storage.value?.kind ?? 'no_space'}`

  return `player.errors.${player.error.value ?? 'unknown'}`
})

// Цифры места — в гигабайтах: так их видит панель
const errorParams = computed(() => {
  const storage = player.storage.value
  const gigabytes = (bytes = 0) => formatGigabytes(bytes, locale.value)

  return {
    needed: gigabytes(storage?.needed),
    available: gigabytes(storage?.available),
    free: gigabytes(storage?.free),
    reserve: gigabytes(storage?.minFree),
    limit: gigabytes(storage?.cacheLimit),
  }
})

function save() {
  if (
    videoTimePolicy({ phase: phase.value, restarting: restarting.value }).save
  ) {
    player.saveWatchState(
      osd.scrub.value?.target ?? position.value,
      knownDuration.value,
    )
  }
}

function exit() {
  save()

  goBack(router, () => void router.replace('/'))
}

function play() {
  video.value?.play().catch(() => {})
}

function toggle() {
  const el = video.value

  if (!el || phase.value !== 'playing')
    return

  if (el.paused)
    play()
  else el.pause()

  osd.show()
}

function seekTo(seconds: number) {
  const el = video.value

  if (!el || !Number.isFinite(seconds))
    return

  const target = clampTime(seconds, knownDuration.value)

  el.currentTime = target
  position.value = target
  save()
}

function closePanel() {
  panel.value = null
  focus.activate('player-buttons')
  osd.scheduleHide()
}

function onMedia(
  key: Extract<KeyAction, { type: 'media' }>['key'],
  held: boolean,
) {
  if (key === 'stop')
    exit()
  else if (key === 'forward' || key === 'rewind')
    osd.step(key === 'forward' ? 1 : -1, held)
  else if (key === 'play')
    play()
  else if (key === 'pause')
    video.value?.pause()
  else toggle()
}

/**
 * Клавиши плеера раньше движка фокуса: ← → перематывают, когда OSD скрыт или
 * фокус на таймлайне, OK при скрытом OSD — пауза, Back — в два шага.
 */
function onKey(action: KeyAction, event: KeyboardEvent) {
  if (
    phase.value !== 'playing'
    || restarting.value
    || player.status.value === 'error'
  ) {
    if (action.type !== 'back')
      return false

    exit()
    return true
  }

  if (action.type === 'back') {
    const next = backAction({
      panelOpen: !!panel.value,
      osdVisible: osd.visible.value,
    })

    if (next === 'closePanel')
      closePanel()
    else if (next === 'hideOsd')
      osd.hide()
    else exit()

    return true
  }

  if (panel.value)
    return false

  if (action.type === 'media') {
    onMedia(action.key, event.repeat)
    osd.show()
    return true
  }

  const hidden = !osd.visible.value
  const onTimeline = !!document.activeElement?.closest(
    '[data-focus-section="player-timeline"]',
  )

  if (
    action.type === 'move'
    && (action.direction === 'left' || action.direction === 'right')
  ) {
    if (hidden || onTimeline) {
      osd.step(action.direction === 'right' ? 1 : -1, event.repeat)
      return true
    }
  }

  if (hidden && action.type === 'enter') {
    toggle()
    return true
  }

  osd.show()

  // Первое нажатие только показывает OSD
  return hidden
}

async function begin(from: number) {
  const el = video.value
  const current = playback.value

  if (!el || !current?.streamUrl)
    return

  startAt = from
  restarting.value = false
  phase.value = 'buffering'
  bufferingSince.value = Date.now()

  if (current.mode === 'hls') {
    if (!(await hls.attach(el, current.streamUrl, from))) {
      player.fail('unsupported')
      return
    }
  }
  else {
    hls.detach()
    el.src = current.streamUrl
  }

  // Без жеста пользователя браузер может не дать играть со звуком:
  // тогда видео ждёт на паузе с OSD, OK запускает
  el.play().catch((err: unknown) => {
    if (err instanceof Error && err.name === 'NotAllowedError') {
      phase.value = 'playing'
      paused.value = true
      osd.show()
    }
  })
}

function onPromptChoice(choice: 'resume' | 'restart' | 'retry' | 'back') {
  if (choice === 'back')
    exit()
  else if (choice === 'retry')
    void start()
  else
    void begin(choice === 'resume' ? (playback.value?.startPosition ?? 0) : 0)
}

/**
 * Озвучка или субтитры, которые плеер не переключит сам: новый поток с
 * этой дорожкой с текущего места, без вопроса «Продолжить»
 */
async function restartWith(change: PlaybackRestart) {
  const at = osd.scrub.value?.target ?? position.value

  save()
  // Не снимается при ошибке нового старта: при выходе остаётся позиция,
  // сохранённая выше, а не 0 от отцепленного видео
  restarting.value = true
  closePanel()
  // Прежняя сессия закрывается при перезапуске: hls.js грузил бы её сегменты,
  // получал 404 и ронял экран посреди смены дорожки
  hls.detach()
  video.value?.pause()
  await player.start({ ...change, startPosition: at })

  if (player.status.value === 'ready')
    await begin(at)
}

function onTracksSelect(id: string) {
  if (panel.value === 'audio')
    tracks.selectAudio(id)
  else tracks.selectSubtitles(id)

  closePanel()
}

function openTracks(kind: 'audio' | 'subtitles') {
  panel.value = kind
  osd.hold()
}

function onLoadedMetadata() {
  const el = video.value!

  duration.value = el.duration
  tracks.refresh()

  if (startAt > 0)
    el.currentTime = clampTime(startAt, el.duration)
}

function onPlaying() {
  if (phase.value !== 'playing') {
    phase.value = 'playing'
    osd.show()
  }

  stalled.value = false
  paused.value = false
  osd.scheduleHide()
}

function onWaiting() {
  if (phase.value === 'playing')
    stalled.value = true
}

function onPause() {
  paused.value = true
  osd.show()
  save()
}

function onTimeUpdate() {
  const el = video.value!

  if (
    !videoTimePolicy({ phase: phase.value, restarting: restarting.value }).track
  )
    return

  position.value = el.currentTime

  if (Math.abs(el.currentTime - savedAt) >= SAVE_EVERY_S) {
    savedAt = el.currentTime
    save()
  }
}

// Код 2 — сеть (движок упал, поток оборвался), остальное — формат не по силам плееру
function onError() {
  const code = video.value?.error?.code

  player.fail(code === 2 ? 'unknown' : 'unsupported')
}

function onPointer(event: MouseEvent) {
  if (phase.value !== 'playing' || player.status.value === 'error')
    return

  osd.show()

  const target = event.target as Element | null

  if (
    event.type === 'click'
    && !panel.value
    && !target?.closest('[data-focusable]')
  ) {
    toggle()
  }
}

function onVisibility() {
  if (document.hidden)
    video.value?.pause()
}

async function start() {
  phase.value = 'starting'
  await player.start()

  if (player.status.value !== 'ready')
    return

  player.pollStats(() => ({
    offset: byteOffset(
      phase.value === 'playing' ? position.value : startAt,
      playback.value?.size ?? 0,
      knownDuration.value,
    ),
    intervalMs: phase.value === 'playing' && !stalled.value ? 2000 : 1000,
  }))

  if (playback.value?.startPosition)
    phase.value = 'resume'
  else void begin(0)
}

onMounted(() => {
  offKey = focus.onKey(onKey)
  clockTimer = setInterval(() => (now.value = new Date()), 1000)
  document.addEventListener('visibilitychange', onVisibility)
  void start()
})

onBeforeUnmount(() => {
  save()
  offKey?.()
  clearInterval(clockTimer)
  document.removeEventListener('visibilitychange', onVisibility)
  player.stopStats()

  // Без этого браузер держит соединение с потоком, и движок качает дальше под позицией
  const el = video.value

  hls.detach()

  if (el) {
    el.removeAttribute('src')
    el.load()
  }
})
</script>

<template>
  <main class="player" @mousemove="onPointer" @click="onPointer">
    <video
      ref="video"
      class="player__video"
      preload="auto"
      @loadedmetadata="onLoadedMetadata"
      @playing="onPlaying"
      @waiting="onWaiting"
      @pause="onPause"
      @timeupdate="onTimeUpdate"
      @error="onError"
    />

    <!-- До первого кадра и при ошибке — одна сцена: фон и шапка не перерисовываются между фазами -->
    <PlayerStage
      v-if="
        player.status.value === 'error' || phase !== 'playing' || restarting
      "
      :title="stageTitle"
      :backdrop="art?.backdrop"
      :logo="art?.logo"
      :subtitle="artSubtitle"
    >
      <PlayerPrompt
        v-if="player.status.value === 'error'"
        :title="t(`${errorKey}.title`)"
        :text="t(`${errorKey}.text`, errorParams)"
        :actions="[
          { id: 'retry', label: t('player.retry') },
          { id: 'back', label: t('player.back') },
        ]"
        @choose="onPromptChoice"
      />

      <PlayerPrompt
        v-else-if="playback && phase === 'resume'"
        :text="resumeText"
        :progress="resumeShare"
        :actions="[
          {
            id: 'resume',
            label: t('player.resume.continue', {
              time: formatDuration(playback.startPosition ?? 0),
            }),
          },
          { id: 'restart', label: t('player.resume.restart') },
        ]"
        @choose="onPromptChoice"
      />

      <AppLoader v-else />

      <template
        v-if="player.status.value !== 'error' && phase !== 'resume'"
        #bottom
      >
        <PlayerBuffering :step="step" :stats="stats" />
      </template>
    </PlayerStage>

    <template
      v-if="
        playback
          && phase === 'playing'
          && !restarting
          && player.status.value !== 'error'
      "
    >
      <p v-if="stalled" class="player__stall" role="status">
        <span class="player__spinner" aria-hidden="true" />
        {{ t("player.steps.buffering")
        }}<template v-if="stats">
          · {{ t("player.peers", stats.peers.connected) }}
        </template>
      </p>

      <PlayerOsd
        :visible="osd.visible.value"
        :title="stageTitle"
        :subtitle="artSubtitle || playback.fileName"
        :position="position"
        :duration="knownDuration"
        :buffer-end="position + bufferSeconds"
        :scrub-target="osd.scrub.value?.target ?? null"
        :paused="paused"
        :stats="stats"
        :buffer-seconds="bufferSeconds"
        :now="now"
        :audio-label="tracks.audioLabel.value"
        :subtitles-label="tracks.subtitlesLabel.value"
        @toggle="toggle"
        @seek="seekTo($event * knownDuration)"
        @tracks="openTracks"
      />

      <PlayerTracks
        v-if="panel"
        :kind="panel"
        :options="trackOptions"
        :caption="tracks.caption.value"
        :hint="tracksHint"
        @select="onTracksSelect"
      />
    </template>

    <p
      v-if="phase === 'playing' && tracks.subtitleHtml.value"
      class="player__subtitles"
      :class="{ 'player__subtitles--lifted': osd.visible.value }"
    >
      <!-- Разметку реплики чистит subtitleHtml: остаются только i, b, u -->
      <!-- eslint-disable-next-line vue/no-v-html -->
      <span class="player__cue" v-html="tracks.subtitleHtml.value" />
    </p>

    <FocusSection
      name="player-back"
      class="player__back-section"
      :class="{ 'player__back-section--visible': backVisible && !panel }"
      :edges="{ down: 'player-timeline' }"
      manual-scroll
    >
      <button v-focusable class="player__back" type="button" @click="exit">
        <AppIcon name="chevronLeft" />
        <span class="player__back-label">{{ t("common.back") }}</span>
      </button>
    </FocusSection>
  </main>
</template>

<style scoped>
.player {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  overflow: hidden;
  background: #000000;
}

.player__video {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background: #000000;
}

.player__stall {
  position: absolute;
  top: 50%;
  left: 50%;
  display: flex;
  align-items: center;
  margin: 0;
  padding: calc(var(--u) * 14) calc(var(--u) * 28);
  border-radius: calc(var(--u) * 32);
  background: rgba(0, 0, 0, 0.6);
  font-size: var(--font-size-s);
  transform: translate(-50%, -50%);
}

.player__spinner {
  width: calc(var(--u) * 24);
  height: calc(var(--u) * 24);
  margin-right: calc(var(--u) * 14);
  border: calc(var(--u) * 4) solid var(--color-line);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: player-spin 900ms linear infinite;
}

.player__subtitles {
  position: absolute;
  right: var(--safe-x);
  bottom: calc(var(--u) * 110);
  left: var(--safe-x);
  margin: 0;
  text-align: center;
  pointer-events: none;
  transition: transform var(--motion-base) var(--motion-easing);
}

/* С OSD реплика поднимается над таймлайном и кнопками */
.player__subtitles--lifted {
  transform: translateY(calc(var(--u) * -230));
}

.player__cue {
  padding: calc(var(--u) * 4) calc(var(--u) * 16);
  border-radius: calc(var(--u) * 8);
  background: rgba(0, 0, 0, 0.55);
  font-size: calc(var(--u) * 46);
  font-weight: 600;
  line-height: 1.45;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
}

/* «Назад» появляется и прячется вместе с OSD */
.player__back-section {
  opacity: 0;
  pointer-events: none;
  transition: opacity var(--motion-base) var(--motion-easing);
}

.player__back-section--visible {
  opacity: 1;
  pointer-events: auto;
}

.player__back {
  position: absolute;
  z-index: 5;
  top: var(--safe-y);
  left: calc(var(--u) * 28);
  display: flex;
  align-items: center;
  height: calc(var(--u) * 64);
  padding: 0 calc(var(--u) * 26) 0 calc(var(--u) * 18);
  border: 0;
  border-radius: calc(var(--u) * 32);
  background: var(--color-glass);
  color: var(--color-text);
  font: inherit;
  font-size: calc(var(--u) * 32);
}

.player__back:hover,
.player__back:focus {
  --bump-scale: var(--focus-scale);

  background: var(--color-focus);
  color: var(--color-bg);
}

.player__back:focus {
  transform: scale(var(--bump-scale));
}

.player__back-label {
  margin-left: calc(var(--u) * 10);
  font-size: var(--font-size-s);
  font-weight: 600;
}

@keyframes player-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
