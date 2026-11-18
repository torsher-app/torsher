import { execFile } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import {
  clearProbeCache,
  hlsTiming,
  parseProbe,
  peekMediaProbe,
  probeMedia,
} from './probe.ts'

vi.mock('node:child_process', async importOriginal => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFile: vi.fn(),
}))

it('does not publish a probe under the previous library revision when the file changed', async () => {
  const key = 'library:fixture:1:2:3:4'
  const child = vi.mocked(execFile)
  child.mockImplementation((...args: unknown[]) => {
    const callback = args[3] as (error: Error | null, stdout: string) => void
    callback(
      null,
      JSON.stringify({
        streams: [{ index: 0, codec_type: 'video', width: 3840, height: 2160 }],
      }),
    )
    return undefined as never
  })
  try {
    await expect(
      probeMedia(key, '/fixture.mkv', 'fixture.mkv', async () => false),
    ).rejects.toThrow('Media file changed during probe')
    expect(peekMediaProbe(key)).toBeUndefined()
    await expect(
      probeMedia(key, '/fixture.mkv', 'fixture.mkv', async () => true),
    ).resolves.toMatchObject({ video: { width: 3840, height: 2160 } })
    expect(child).toHaveBeenCalledTimes(2)
  }
  finally {
    child.mockReset()
    clearProbeCache()
  }
})

describe('source timing', () => {
  it('retains signed origins and falls back from N/A duration to duration_ts/time_base', () => {
    const media = parseProbe(
      {
        format: { start_time: '-2', duration: '75' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            start_time: '-1.5',
            duration: 'N/A',
            duration_ts: 120,
            time_base: '1/2',
          },
          { index: 1, codec_type: 'audio', start_time: '-2', duration: '60' },
          { index: 2, codec_type: 'audio', start_time: '-2', duration: '75' },
        ],
      },
      'timing.mkv',
    )
    expect(media.startTime).toBe(-2)
    expect(media.video).toMatchObject({ startTime: -1.5, duration: 60 })
    expect(hlsTiming(media, 1)).toEqual({ videoEnd: 60.5, duration: 60.5 })
    expect(hlsTiming(media, 2)).toEqual({ videoEnd: 60.5, duration: 75 })
    expect(media.duration).toBe(75)
  })

  it('treats MKVToolNix statistics as elapsed duration at a nonzero origin', () => {
    const media = parseProbe(
      {
        format: {
          format_name: 'matroska,webm',
          start_time: '100',
          duration: '175',
          tags: { ENCODER: 'libebml v1.4.5 + libmatroska v1.7.1' },
        },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            start_time: '100.08',
            tags: {
              DURATION: '00:01:00.000000000',
              _STATISTICS_WRITING_APP: 'mkvmerge v102',
            },
          },
        ],
      },
      'timing.mkv',
    )
    expect(media.video?.duration).toBe(60)
    expect(hlsTiming(media, null).videoEnd).toBeCloseTo(60.08)
  })

  it('requires packet evidence when a plain duration has only an old statistics writer', () => {
    const media = parseProbe(
      {
        format: {
          format_name: 'matroska,webm',
          start_time: '100',
          duration: '106',
        },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            tags: {
              DURATION: '00:01:46.000000000',
              _STATISTICS_WRITING_APP: 'mkvmerge v90',
            },
          },
        ],
      },
      'ambiguous.mkv',
    )
    expect(hlsTiming(media, null).videoEnd).toBeNull()
    expect(hlsTiming(media, null, new Map([[0, 106]]))).toEqual({
      videoEnd: 6,
      duration: 6,
    })
  })

  it('uses language-suffixed MKVToolNix durations and their matching writer markers', () => {
    const media = parseProbe(
      {
        format: { start_time: '100', duration: '175' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            start_time: '100.08',
            tags: {
              'DURATION-eng': '00:01:00.000000000',
              '_STATISTICS_WRITING_APP-eng': 'mkvmerge v102',
            },
          },
          {
            index: 1,
            codec_type: 'audio',
            start_time: '100',
            tags: {
              'DURATION-eng': '00:01:00.000000000',
              '_STATISTICS_WRITING_APP-eng': 'mkvmerge v102',
            },
          },
          {
            index: 2,
            codec_type: 'audio',
            start_time: '100',
            tags: {
              'DURATION-eng': '00:01:15.000000000',
              '_STATISTICS_WRITING_APP-eng': 'mkvmerge v102',
            },
          },
        ],
      },
      'timing.mkv',
    )
    expect(media.video?.duration).toBe(60)
    expect(hlsTiming(media, 1).duration).toBeCloseTo(60.08)
    expect(hlsTiming(media, 2).duration).toBe(75)
  })

  it('prefers a plain FFmpeg end tag without borrowing a suffixed writer marker', () => {
    const media = parseProbe(
      {
        format: { start_time: '100', duration: '175' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            start_time: '100.08',
            tags: {
              'DURATION': '00:02:40.080000000',
              'DURATION-eng': '00:01:15.000000000',
              '_STATISTICS_WRITING_APP-eng': 'mkvmerge v102',
            },
          },
        ],
      },
      'timing.mkv',
    )
    expect(media.video?.duration).toBeCloseTo(60)
    expect(hlsTiming(media, null).duration).toBeCloseTo(60.08)
  })

  it('treats an unpaired suffixed duration as a source-clock end timestamp', () => {
    const media = parseProbe(
      {
        format: { start_time: '100', duration: '175' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            start_time: '100.08',
            tags: {
              'DURATION-eng': '00:02:40.080000000',
              '_STATISTICS_WRITING_APP-rus': 'mkvmerge v102',
            },
          },
        ],
      },
      'timing.mkv',
    )
    expect(media.video?.duration).toBeCloseTo(60)
    expect(hlsTiming(media, null).duration).toBeCloseTo(60.08)
  })

  it('uses the format origin for an absolute Matroska tag without a stream start', () => {
    const media = parseProbe(
      {
        format: {
          format_name: 'matroska,webm',
          start_time: '100',
          duration: '109',
        },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            tags: { DURATION: '00:01:46.000000000' },
          },
        ],
      },
      'origin.mkv',
    )
    expect(hlsTiming(media, null)).toEqual({ videoEnd: 6, duration: 6 })
    expect(media.duration).toBe(109)
  })

  it.each(['mov,mp4', 'mpegts'])(
    'keeps %s container durations relative to a nonzero origin',
    (format_name) => {
      const media = parseProbe(
        {
          format: { format_name, start_time: '100', duration: '9' },
          streams: [
            { index: 0, codec_type: 'video' },
            { index: 1, codec_type: 'audio' },
          ],
        },
        'recording',
      )
      expect(hlsTiming(media, 1)).toEqual({ videoEnd: 9, duration: 9 })
    },
  )

  it('keeps unknown Matroska stream ends out of the HLS duration', () => {
    const media = parseProbe(
      {
        format: { format_name: 'matroska,webm', duration: '75' },
        streams: [
          {
            index: 0,
            codec_type: 'video',
            start_time: '0.08',
            tags: { DURATION: '00:01:00.080000000' },
          },
          { index: 1, codec_type: 'audio' },
        ],
      },
      'timing.mkv',
    )
    expect(media.video?.duration).toBe(60)
    expect(hlsTiming(media, 1)).toEqual({ videoEnd: 60.08, duration: null })
    expect(hlsTiming(media, null)).toEqual({
      videoEnd: 60.08,
      duration: 60.08,
    })
  })
})
