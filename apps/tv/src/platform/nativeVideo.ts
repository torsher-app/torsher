import type { NativeVideoState, PlayerSnapshot } from '../lib/nativeVideo.ts'
import type { PlayerCommand } from './android.ts'
import {
  applySnapshot,
  currentTimeOf,
  INITIAL_SNAPSHOT,
} from '../lib/nativeVideo.ts'
import { onPlayerState, postPlayer } from './android.ts'

interface AudioTrackLike {
  id: string
  kind: string
  label: string
  language: string
  enabled: boolean
}

function timeRanges(start: number, end: number): TimeRanges {
  const empty = end <= start

  return {
    length: empty ? 0 : 1,
    start: () => start,
    end: () => end,
  }
}

/**
 * Подменяет `<video>` экрана плеера нативным плеером оболочки: свойства и
 * методы, которые читает витрина, уходят в мост, а события Media3 приходят
 * настоящими событиями элемента. Шаблон и обработчики плеера не меняются.
 * Возвращает отключение.
 */
export function attachNativeVideo(el: HTMLVideoElement): () => void {
  const state: NativeVideoState = {
    snapshot: INITIAL_SNAPSHOT,
    receivedAt: performance.now(),
    paused: true,
  }
  let source = ''
  let rate = 1
  let defaultRate = 1
  let audioTracks: AudioTrackLike[] = []

  const send = (command: PlayerCommand) => postPlayer(command)

  function tracksOf(snapshot: PlayerSnapshot) {
    return snapshot.audio.map((track, index): AudioTrackLike => ({
      id: String(index),
      kind: 'main',
      label: track.label ?? '',
      language: track.language ?? '',
      get enabled() {
        return state.snapshot.audio[index]?.enabled ?? false
      },
      // Плеер витрины включает нужную дорожку и выключает остальные
      set enabled(value: boolean) {
        if (value)
          send({ type: 'player.audio', index })
      },
    }))
  }

  const own: PropertyDescriptorMap = {
    src: {
      get: () => source,
      set: (value: string) => {
        source = value ? new URL(value, location.href).href : ''
        if (source)
          send({ type: 'player.load', url: source })
      },
    },
    currentSrc: { get: () => source },
    currentTime: {
      get: () => currentTimeOf(state, performance.now()),
      set: (value: number) => {
        state.pendingSeek = value
        send({ type: 'player.seek', time: value })
      },
    },
    duration: { get: () => state.snapshot.duration ?? Number.NaN },
    paused: { get: () => state.paused },
    ended: { get: () => state.snapshot.ended },
    readyState: { get: () => state.snapshot.readyState },
    buffered: {
      get: () =>
        timeRanges(
          currentTimeOf(state, performance.now()),
          state.snapshot.buffered,
        ),
    },
    playbackRate: {
      get: () => rate,
      set: (value: number) => {
        rate = value
        send({ type: 'player.rate', rate: value })
      },
    },
    defaultPlaybackRate: {
      get: () => defaultRate,
      set: (value: number) => {
        defaultRate = value
      },
    },
    error: { get: () => state.snapshot.error },
    audioTracks: { get: () => audioTracks },
    textTracks: { get: () => [] },
    play: {
      value: () => {
        state.paused = false
        send({ type: 'player.play' })
        return Promise.resolve()
      },
    },
    pause: {
      value: () => {
        state.paused = true
        send({ type: 'player.pause' })
      },
    },
    // Без `src` и `load()` плеер витрины отпускает поток — нативный тоже
    load: {
      value: () => {
        if (!source)
          send({ type: 'player.stop' })
      },
    },
    removeAttribute: {
      value: (name: string) => {
        if (name === 'src')
          source = ''
        HTMLElement.prototype.removeAttribute.call(el, name)
      },
    },
  }

  for (const [name, descriptor] of Object.entries(own))
    Object.defineProperty(el, name, { configurable: true, ...descriptor })

  onPlayerState((snapshot) => {
    applySnapshot(state, snapshot, performance.now())

    if (
      snapshot.audio.length !== audioTracks.length
      || snapshot.events.includes('emptied')
    ) {
      audioTracks = tracksOf(snapshot)
    }

    for (const name of snapshot.events) el.dispatchEvent(new Event(name))
  })

  // Видео рисуется под страницей: фон плеера и страницы прозрачный
  document.documentElement.classList.add('native-video')

  return () => {
    onPlayerState(undefined)
    send({ type: 'player.stop' })
    document.documentElement.classList.remove('native-video')

    for (const name of Object.keys(own))
      delete (el as unknown as Record<string, unknown>)[name]
  }
}
