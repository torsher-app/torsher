<script setup lang="ts">
import type { KeyAction } from '../focus/index.ts'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PlayerBuffering from '../components/player/PlayerBuffering.vue'
import PlayerOsd from '../components/player/PlayerOsd.vue'
import PlayerPrompt from '../components/player/PlayerPrompt.vue'
import PlayerTracks from '../components/player/PlayerTracks.vue'
import { useMediaTracks } from '../composables/useMediaTracks.ts'
import { usePlayback } from '../composables/usePlayback.ts'
import { usePlayerOsd } from '../composables/usePlayerOsd.ts'
import { useFocus } from '../focus/index.ts'
import {
  backAction,
  bufferedSeconds,
  bufferingStep,
  byteOffset,
  clampTime,
  formatDuration,
} from '../lib/player.ts'
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

const { t } = useI18n()
const router = useRouter()
const focus = useFocus()
const player = usePlayback(
  props.torrentId,
  Number(props.fileIndex),
  titleRefOf(props.titleId, props.season, props.episode),
)
const { playback, stats } = player

const video = ref<HTMLVideoElement>()
const tracks = useMediaTracks(video)

// starting — запрашиваем адрес, resume — спрашиваем, продолжить ли,
// buffering — ждём первые кадры, playing — видео хоть раз пошло
const phase = ref<'starting' | 'resume' | 'buffering' | 'playing'>('starting')
const stalled = ref(false)
const paused = ref(false)
const position = ref(0)
const duration = ref(Number.NaN)
const panel = ref<'audio' | 'subtitles' | null>(null)
const now = ref(new Date())
const bufferingSince = ref(Date.now())

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

const errorKey = computed(() =>
  player.error.value === 'engine'
    ? `player.errors.engine.${player.engineKind.value ?? 'starting'}`
    : `player.errors.${player.error.value ?? 'unknown'}`,
)

function save() {
  if (phase.value === 'playing') {
    player.saveWatchState(
      osd.scrub.value?.target ?? position.value,
      knownDuration.value,
    )
  }
}

function exit() {
  save()

  if (router.options.history.state.back)
    router.back()
  else void router.replace('/')
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
  if (phase.value !== 'playing' || player.status.value === 'error') {
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

function begin(from: number) {
  const el = video.value

  if (!el || !playback.value)
    return

  startAt = from
  phase.value = 'buffering'
  bufferingSince.value = Date.now()
  el.src = playback.value.streamUrl

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
  else begin(choice === 'resume' ? (playback.value?.startPosition ?? 0) : 0)
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
  else begin(0)
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

    <PlayerPrompt
      v-if="player.status.value === 'error'"
      :title="t(`${errorKey}.title`)"
      :text="t(`${errorKey}.text`)"
      :actions="[
        { id: 'retry', label: t('player.retry') },
        { id: 'back', label: t('player.back') },
      ]"
      @choose="onPromptChoice"
    />

    <template v-else-if="playback">
      <PlayerPrompt
        v-if="phase === 'resume'"
        :title="playback.title"
        :text="t('player.resume.text')"
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

      <PlayerBuffering
        v-else-if="phase === 'buffering'"
        :title="playback.title"
        :step="step"
        :stats="stats"
      />

      <template v-else-if="phase === 'playing'">
        <p v-if="stalled" class="player__stall" role="status">
          <span class="player__spinner" aria-hidden="true" />
          {{ t("player.steps.buffering")
          }}<template v-if="stats">
            · {{ t("player.peers", stats.peers.connected) }}
          </template>
        </p>

        <PlayerOsd
          :visible="osd.visible.value"
          :title="playback.title"
          :file-name="playback.fileName"
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
          @select="onTracksSelect"
        />
      </template>
    </template>
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

@keyframes player-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
