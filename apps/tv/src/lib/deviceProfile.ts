import type { DeviceProfileInput } from '@torsher/api-client'

export interface MediaSupport {
  /** `<video>.canPlayType`: может ли играть файл напрямую */
  canPlay: (type: string) => boolean
  /** `MediaSource.isTypeSupported`: может ли hls.js собрать поток */
  mse: (type: string) => boolean
  audioTracks: boolean
  /** Приложение webOS: MKV, AC3 и E-AC3 играет системный плеер */
  webos: boolean
}

const VIDEO_TYPES: [string, string[]][] = [
  ['h264', ['video/mp4; codecs="avc1.640029"']],
  [
    'hevc',
    [
      'video/mp4; codecs="hvc1.1.6.L120.90"',
      'video/mp4; codecs="hev1.1.6.L120.90"',
    ],
  ],
  ['vp9', ['video/webm; codecs="vp9"']],
  ['av1', ['video/mp4; codecs="av01.0.05M.08"']],
]

const AUDIO_TYPES: [string, string[]][] = [
  ['aac', ['audio/mp4; codecs="mp4a.40.2"']],
  ['mp3', ['audio/mpeg', 'audio/mp4; codecs="mp3"']],
  ['opus', ['audio/webm; codecs="opus"', 'audio/ogg; codecs="opus"']],
  ['flac', ['audio/flac', 'audio/mp4; codecs="flac"']],
  ['ac3', ['audio/mp4; codecs="ac-3"']],
  ['eac3', ['audio/mp4; codecs="ec-3"']],
]

// Что системный плеер webOS играет всегда, даже если браузер не объявляет
const WEBOS_EXTRA = {
  containers: ['mkv', 'ts'],
  video: ['hevc'],
  audio: ['ac3', 'eac3'],
}

const HLS_MSE = 'video/mp4; codecs="avc1.42E01E,mp4a.40.2"'
const HLS_NATIVE = 'application/vnd.apple.mpegurl'

function supported(
  types: [string, string[]][],
  check: (type: string) => boolean,
) {
  return types
    .filter(([, variants]) => variants.some(check))
    .map(([codec]) => codec)
}

function unique<T>(items: T[]) {
  return items.filter((item, i) => items.indexOf(item) === i)
}

/**
 * Что умеет плеер этой платформы — сервер по нему решает, играть файл
 * напрямую или перепаковать. MKV — только если браузер его объявляет или это
 * webOS; AC3 и E-AC3 — по `canPlayType`.
 */
export function deviceProfileOf(support: MediaSupport): DeviceProfileInput {
  const either = (type: string) => support.canPlay(type) || support.mse(type)
  const containers: DeviceProfileInput['containers'] = []

  if (support.canPlay('video/mp4'))
    containers.push('mp4')

  if (support.canPlay('video/webm'))
    containers.push('webm')

  if (support.canPlay('video/x-matroska') || support.canPlay('video/mkv'))
    containers.push('mkv')

  const profile: DeviceProfileInput = {
    containers,
    video: supported(VIDEO_TYPES, either),
    audio: supported(AUDIO_TYPES, either),
    audioTracks: support.audioTracks,
    // Встроенные субтитры MKV рисует только системный плеер ТВ; пока его
    // дорожки не подключены, их показывает перепаковка
    embeddedSubtitles: false,
    hls: support.mse(HLS_MSE) || support.canPlay(HLS_NATIVE),
  }

  if (support.webos) {
    profile.containers = unique([
      ...profile.containers,
      ...WEBOS_EXTRA.containers,
    ] as DeviceProfileInput['containers'])
    profile.video = unique([...profile.video, ...WEBOS_EXTRA.video])
    profile.audio = unique([...profile.audio, ...WEBOS_EXTRA.audio])
  }

  return profile
}

/** Возможности этого браузера */
export function browserMediaSupport(webos: boolean): MediaSupport {
  const video = document.createElement('video')
  const source = (window as { MediaSource?: typeof MediaSource }).MediaSource

  return {
    canPlay: type => video.canPlayType(type) !== '',
    mse: type => !!source?.isTypeSupported(type),
    audioTracks: 'audioTracks' in HTMLMediaElement.prototype,
    webos,
  }
}
