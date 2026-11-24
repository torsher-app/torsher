import type { Playback } from '@torsher/api-client'
import { effectScope, ref, shallowRef } from 'vue'
import { expect, it, vi } from 'vitest'
import { usePlayerTracks } from './usePlayerTracks.ts'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
    te: (key: string) => key === 'subtitleLanguages.pt-br',
  }),
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
  const current: Playback = {
    sessionId: 'first',
    status: 'ready',
    mode: 'direct',
    streamUrl: element.src,
    externalUrl: element.src,
    title: 'Fixture',
    fileName: 'fixture.mkv',
    size: 1000,
    duration: null,
    startPosition: null,
    audioStream: 6,
    audioSwitch: 'restart',
    subtitle: null,
    reasons: [],
    transcode: null,
    media: {
      container: 'mkv',
      video: null,
      audio: [
        { index: 2, title: 'NewStudio' },
        { index: 6, title: 'LostFilm' },
      ].map(track => ({
        ...track,
        language: 'rus',
        codec: 'aac',
        channels: 2,
        bitrate: null,
        default: track.index === 2,
        studio: null,
        voiceType: null,
      })),
      subtitles: [],
    },
  }
  const playback = shallowRef(current)
  const video = shallowRef(element as unknown as HTMLVideoElement)
  const scope = effectScope()
  const tracks = scope.run(() =>
    usePlayerTracks(playback, video, ref(0), vi.fn()),
  )!
  return { tracks, audio, element, playback, stop: () => scope.stop() }
}

it('labels a searched subtitle using the regional provider language', () => {
  const { tracks, stop } = setup()
  try {
    tracks.setSubtitleTrack('found', {
      id: 'found',
      language: 'pt-BR',
      title: null,
      codec: 'srt',
      external: true,
      forced: false,
      default: false,
      burnIn: false,
      downloaded: true,
    })
    expect(
      tracks.subtitleOptions.value.find(track => track.id === 'found')?.label,
    ).toBe('subtitleLanguages.pt-br')
  }
  finally {
    stop()
  }
})

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
