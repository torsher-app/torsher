import type { Playback } from '@torsher/api-client'
import { effectScope, ref, shallowRef } from 'vue'
import { expect, it, vi } from 'vitest'
import { usePlayerTracks } from './usePlayerTracks.ts'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, te: () => false }),
}))
vi.mock('./useSubtitles.ts', () => ({
  useSubtitles: () => ({ show: vi.fn(), hide: vi.fn() }),
}))

function setup() {
  const audio = [
    { enabled: true, label: 'NewStudio', language: 'ru' },
    { enabled: false, label: 'LostFilm', language: 'ru' },
  ]
  const element = {
    audioTracks: audio,
    readyState: 1,
    src: 'http://test.invalid/video',
    currentSrc: 'http://test.invalid/video',
  }
  const current = {
    sessionId: 'first',
    mode: 'direct',
    audioStream: 6,
    audioSwitch: 'restart',
    media: {
      audio: [
        { index: 2, title: 'NewStudio', language: 'rus' },
        { index: 6, title: 'LostFilm', language: 'rus' },
      ],
    },
  } as Playback
  const playback = shallowRef(current)
  const video = shallowRef(element as unknown as HTMLVideoElement)
  const scope = effectScope()
  const tracks = scope.run(() =>
    usePlayerTracks(playback, video, ref(0), vi.fn()),
  )!
  return { tracks, audio, element, playback, stop: () => scope.stop() }
}

it('reads the enabled stream after metadata and ignores the requested fallback stream', () => {
  const { tracks, audio, element, playback, stop } = setup()
  try {
    expect(tracks.appliedAudioStream(false)).toBeNull()
    tracks.refresh()
    expect(tracks.appliedAudioStream(false)).toBe(2)
    expect(tracks.appliedAudioStream(true)).toBe(2)
    audio[0]!.enabled = false
    audio[1]!.enabled = true
    expect(tracks.appliedAudioStream(true)).toBe(6)
    element.currentSrc = 'http://test.invalid/detached'
    expect(tracks.appliedAudioStream(false)).toBeNull()
    playback.value = { ...playback.value, sessionId: 'replacement' }
    element.currentSrc = element.src
    expect(tracks.appliedAudioStream(false)).toBeNull()
  }
  finally {
    stop()
  }
})

it('returns unknown for ambiguous readback, different track order, or detached metadata', () => {
  const { tracks, audio, stop } = setup()
  try {
    tracks.refresh()
    audio[1]!.enabled = true
    expect(tracks.appliedAudioStream(false)).toBeNull()
    audio[1]!.enabled = false
    audio.reverse()
    expect(tracks.appliedAudioStream(false)).toBeNull()
    audio.reverse()
    audio[0]!.label = ''
    expect(tracks.appliedAudioStream(true)).toBeNull()
    audio.pop()
    expect(tracks.appliedAudioStream(false)).toBeNull()
    audio.push({ enabled: false, label: 'LostFilm', language: 'ru' })
    tracks.resetAppliedAudio()
    expect(tracks.appliedAudioStream(false)).toBeNull()
  }
  finally {
    stop()
  }
})
