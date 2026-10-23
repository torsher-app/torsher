import type { DeviceProfile } from './decide.ts'
import type { MediaInfo } from './probe.ts'
import { describe, expect, it } from 'vitest'
import mkvProbe from './fixtures/probe-mkv.json' with { type: 'json' }
import mp4Probe from './fixtures/probe-mp4.json' with { type: 'json' }
import { decidePlayback, pickAudioStream } from './decide.ts'
import { parseProbe } from './probe.ts'

// Профили как у витрины: Chrome на Mac и webOS
const chrome: DeviceProfile = {
  containers: ['mp4', 'webm'],
  video: ['h264', 'vp9', 'av1'],
  audio: ['aac', 'mp3', 'opus', 'flac'],
  audioTracks: false,
  embeddedSubtitles: false,
  hls: true,
}

const webos: DeviceProfile = {
  containers: ['mp4', 'webm', 'mkv', 'ts'],
  video: ['h264', 'hevc', 'vp9'],
  audio: ['aac', 'mp3', 'ac3', 'eac3'],
  audioTracks: true,
  embeddedSubtitles: false,
  hls: true,
}

const mkv = parseProbe(mkvProbe, 'Film.2024.mkv')
const mp4 = parseProbe(mp4Probe, 'Film.2024.mp4')

function decide(
  media: MediaInfo,
  device: DeviceProfile,
  overrides: {
    audioStream?: number | null
    embeddedSubtitle?: boolean
    burnSubtitle?: boolean
    toolsReady?: boolean
    canEncode?: boolean
  } = {},
) {
  return decidePlayback({
    media,
    device,
    audioStream: overrides.audioStream ?? media.audio[0]?.index ?? null,
    embeddedSubtitle: overrides.embeddedSubtitle ?? false,
    burnSubtitle: overrides.burnSubtitle ?? false,
    toolsReady: overrides.toolsReady ?? true,
    canEncode: overrides.canEncode ?? true,
  })
}

// Xvid в AVI с AC3, как старые рипы
const avi: MediaInfo = {
  container: 'avi',
  duration: 8118,
  video: {
    index: 0,
    codec: 'mpeg4',
    profile: 'Advanced Simple Profile',
    width: 720,
    height: 400,
    highBitDepth: false,
    hdr: false,
    frameRate: 25,
    interlaced: false,
    bitrate: 1_700_000,
    pixelAspect: 1,
  },
  audio: [
    {
      index: 1,
      language: null,
      title: null,
      codec: 'ac3',
      channels: 2,
      bitrate: 192_000,
      default: false,
    },
  ],
  subtitles: [],
}

describe('parseProbe', () => {
  it('разбирает MKV с двумя озвучками и субтитрами', () => {
    expect(mkv.container).toBe('mkv')
    expect(mkv.duration).toBe(120)
    expect(mkv.video).toMatchObject({
      codec: 'h264',
      width: 1280,
      highBitDepth: false,
    })
    expect(mkv.audio).toEqual([
      {
        index: 1,
        language: 'rus',
        title: 'LostFilm',
        codec: 'ac3',
        channels: 6,
        bitrate: 384000,
        default: true,
      },
      {
        index: 2,
        language: 'eng',
        title: 'Original',
        codec: 'eac3',
        channels: 2,
        bitrate: 192000,
        default: false,
      },
    ])
    expect(
      mkv.subtitles.map(track => [track.index, track.codec, track.text]),
    ).toEqual([
      [3, 'subrip', true],
      [4, 'ass', true],
    ])
  })

  it('убирает служебное название дорожки MP4', () => {
    expect(mp4.container).toBe('mp4')
    expect(mp4.audio[0]).toMatchObject({
      codec: 'aac',
      title: null,
      language: 'eng',
    })
  })
})

describe('decidePlayback', () => {
  it('chrome: MKV с AC3 — перепаковка, звук в AAC', () => {
    expect(decide(mkv, chrome)).toEqual({
      mode: 'hls',
      reasons: ['ContainerNotSupported', 'AudioCodecNotSupported'],
      video: 'copy',
      audio: 'aac',
      audioSwitch: 'restart',
    })
  })

  it('chrome: MP4 с AAC — напрямую', () => {
    expect(decide(mp4, chrome)).toMatchObject({ mode: 'direct', reasons: [] })
  })

  it('webOS: MKV с AC3 — напрямую, озвучка меняется на месте', () => {
    expect(decide(mkv, webos, { audioStream: 2 })).toEqual({
      mode: 'direct',
      reasons: [],
      video: null,
      audio: null,
      audioSwitch: 'platform',
    })
  })

  it('без `audioTracks` не первая озвучка — перепаковка', () => {
    const profile = {
      ...chrome,
      containers: [...chrome.containers, 'mkv' as const],
      audio: [...chrome.audio, 'ac3', 'eac3'],
    }

    expect(decide(mkv, profile, { audioStream: 2 })).toMatchObject({
      mode: 'hls',
      reasons: ['AudioTrackSwitchNotSupported'],
      audio: 'aac',
    })
    expect(decide(mkv, profile, { audioStream: 1 })).toMatchObject({
      mode: 'direct',
    })
  })

  it('aC3 копией, если плеер его играет', () => {
    const profile = { ...chrome, audio: [...chrome.audio, 'ac3'] }

    expect(decide(mkv, profile)).toMatchObject({ mode: 'hls', audio: 'copy' })
  })

  it('встроенные субтитры, которые плеер не покажет, — перепаковка', () => {
    expect(decide(mkv, webos, { embeddedSubtitle: true })).toMatchObject({
      mode: 'hls',
      reasons: ['SubtitleCodecNotSupported'],
      audio: 'copy',
    })
  })

  it('xvid в AVI с AC3 — перекодирование видео, звук в AAC', () => {
    expect(decide(avi, chrome)).toEqual({
      mode: 'hls',
      reasons: [
        'ContainerNotSupported',
        'AudioCodecNotSupported',
        'VideoCodecNotSupported',
      ],
      video: 'encode',
      audio: 'aac',
      audioSwitch: 'restart',
    })
  })

  it('hEVC в MP4 без декодера — перекодирование, AAC копией', () => {
    const hevc = { ...mp4, video: { ...mp4.video!, codec: 'hevc' } }

    expect(decide(hevc, chrome)).toMatchObject({
      mode: 'hls',
      reasons: ['VideoCodecNotSupported'],
      video: 'encode',
      audio: 'copy',
    })
  })

  it('h.264 High 10 — перекодирование', () => {
    const high10 = { ...mp4, video: { ...mp4.video!, highBitDepth: true } }

    expect(decide(high10, chrome)).toMatchObject({
      reasons: ['VideoBitDepthNotSupported'],
      video: 'encode',
    })
  })

  it('графические субтитры — перекодирование с прожигом', () => {
    expect(decide(mkv, webos, { burnSubtitle: true })).toMatchObject({
      mode: 'hls',
      reasons: ['SubtitleCodecNotSupported'],
      video: 'encode',
      audio: 'copy',
    })
  })

  it('без кодировщика H.264 — напрямую с причиной', () => {
    expect(decide(avi, chrome, { canEncode: false })).toMatchObject({
      mode: 'direct',
      reasons: [
        'ContainerNotSupported',
        'AudioCodecNotSupported',
        'VideoCodecNotSupported',
        'ToolsMissing',
      ],
    })
  })

  it('без HLS у плеера — напрямую с причиной', () => {
    expect(decide(avi, { ...chrome, hls: false })).toMatchObject({
      mode: 'direct',
      reasons: expect.arrayContaining(['HlsNotSupported']),
    })
  })

  it('без ffmpeg — напрямую с причиной', () => {
    expect(decide(mkv, chrome, { toolsReady: false })).toMatchObject({
      mode: 'direct',
      reasons: [
        'ContainerNotSupported',
        'AudioCodecNotSupported',
        'ToolsMissing',
      ],
    })
  })
})

describe('pickAudioStream', () => {
  const media: MediaInfo = {
    ...mkv,
    audio: [
      {
        index: 1,
        language: 'eng',
        title: 'Original',
        codec: 'eac3',
        channels: 6,
        bitrate: null,
        default: true,
      },
      {
        index: 2,
        language: 'rus',
        title: 'MVO NewStudio',
        codec: 'ac3',
        channels: 6,
        bitrate: null,
        default: false,
      },
      {
        index: 3,
        language: 'rus',
        title: 'Многоголосый закадровый | LostFilm',
        codec: 'ac3',
        channels: 6,
        bitrate: null,
        default: false,
      },
    ],
  }

  it('студия из листа источников', () => {
    expect(
      pickAudioStream(media, { studio: 'LostFilm', locale: 'ru_RU' }),
    ).toBe(3)
  })

  it('без студии — язык профиля', () => {
    expect(
      pickAudioStream(media, { studio: 'Кубик в Кубе', locale: 'ru_RU' }),
    ).toBe(2)
  })

  it('без совпадений — `default`', () => {
    expect(pickAudioStream(media, { locale: 'uk_UA' })).toBe(1)
  })

  it('без звука — null', () => {
    expect(pickAudioStream({ ...media, audio: [] }, {})).toBeNull()
  })
})
