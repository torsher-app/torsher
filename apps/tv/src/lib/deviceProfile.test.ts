import { describe, expect, it } from 'vitest'
import { deviceProfileOf } from './deviceProfile.ts'

function supportOf(
  types: string[],
  options: { webos?: boolean, audioTracks?: boolean } = {},
) {
  const has = (type: string) => types.includes(type)

  return {
    canPlay: has,
    mse: has,
    audioTracks: options.audioTracks ?? false,
    webos: options.webos ?? false,
  }
}

// Ответы Chrome на Mac: MKV и AC3 не объявляет
const CHROME = [
  'video/mp4',
  'video/webm',
  'video/mp4; codecs="avc1.640029"',
  'video/webm; codecs="vp9"',
  'audio/mp4; codecs="mp4a.40.2"',
  'audio/mpeg',
  'audio/webm; codecs="opus"',
  'video/mp4; codecs="avc1.42E01E,mp4a.40.2"',
]

describe('deviceProfileOf', () => {
  it('chrome: без MKV и AC3, с HLS через MSE', () => {
    expect(deviceProfileOf(supportOf(CHROME))).toEqual({
      containers: ['mp4', 'webm'],
      video: ['h264', 'vp9'],
      audio: ['aac', 'mp3', 'opus'],
      audioTracks: false,
      embeddedSubtitles: false,
      hls: true,
    })
  })

  it('webOS: MKV, HEVC, AC3 и E-AC3 — всегда, дорожки переключает сам', () => {
    expect(
      deviceProfileOf(supportOf(CHROME, { webos: true, audioTracks: true })),
    ).toMatchObject({
      containers: ['mp4', 'webm', 'mkv', 'ts'],
      video: ['h264', 'vp9', 'hevc'],
      audio: ['aac', 'mp3', 'opus', 'ac3', 'eac3'],
      audioTracks: true,
    })
  })

  it('браузер с AC3 и MKV', () => {
    const profile = deviceProfileOf(
      supportOf([...CHROME, 'video/x-matroska', 'audio/mp4; codecs="ac-3"']),
    )

    expect(profile.containers).toContain('mkv')
    expect(profile.audio).toContain('ac3')
  })

  it('без MSE и нативного HLS — HLS нет', () => {
    expect(deviceProfileOf(supportOf(['video/mp4'])).hls).toBe(false)
    expect(
      deviceProfileOf(supportOf(['application/vnd.apple.mpegurl'])).hls,
    ).toBe(true)
  })
})
