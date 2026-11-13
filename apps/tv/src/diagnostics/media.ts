import type { DiagnosticMediaSnapshot, Playback } from '@torsher/api-client'

function number(value: unknown, max: number, integer = false) {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0
    && value <= max
    && (!integer || Number.isInteger(value))
    ? value
    : undefined
}
/** Only explicitly supported properties; native facade does not supply dimensions/counters. */
export function mediaSnapshot(
  video: HTMLVideoElement | undefined,
  native: boolean,
  playback?: Playback,
  hls: DiagnosticMediaSnapshot['hls'] = 'unsupported',
  selection?: { audioStream?: number, subtitle?: string | null },
): DiagnosticMediaSnapshot {
  const result: DiagnosticMediaSnapshot = {
    source: native ? 'native' : 'html_video',
    state: video ? 'available' : 'unsupported',
    hls,
    native: native ? 'unknown' : 'unsupported',
  }
  if (!video)
    return result
  // Older devices can throw from optional media API getters. Keep the observed prefix.
  try {
    result.position = number(video.currentTime, 10_000_000)
    result.duration = number(video.duration, 10_000_000)
    result.paused = video.paused
    result.ended = video.ended
    result.readyState = number(video.readyState, 4, true)
    if (native) {
      result.native = video.error
        ? 'error'
        : video.ended
          ? 'ended'
          : video.paused
            ? 'paused'
            : video.readyState < 3
              ? 'buffering'
              : 'playing'
    }
    else {
      result.seeking = video.seeking
      result.networkState = number(video.networkState, 3, true)
      result.width = number(video.videoWidth, 16384, true)
      result.height = number(video.videoHeight, 16384, true)
      if (typeof video.getVideoPlaybackQuality === 'function') {
        const quality = video.getVideoPlaybackQuality()
        result.droppedFrames = number(
          quality.droppedVideoFrames,
          1_000_000,
          true,
        )
        result.totalFrames = number(quality.totalVideoFrames, 1_000_000, true)
      }
    }
    const ranges = video.buffered
    const near: { start: number, end: number }[] = []
    const distance = (range: { start: number, end: number }) =>
      Math.max(
        range.start - (result.position ?? 0),
        (result.position ?? 0) - range.end,
        0,
      )
    for (let i = 0; i < Math.min(ranges.length, 128); i++) {
      const start = number(ranges.start(i), 10_000_000)
      const end = number(ranges.end(i), 10_000_000)
      if (start !== undefined && end !== undefined && end >= start) {
        near.push({ start, end })
        near.sort((a, b) => distance(a) - distance(b))
        if (near.length > 4)
          near.pop()
      }
    }
    result.buffered = near.sort((a, b) => a.start - b.start)
  }
  catch {
    result.state = 'unknown'
  }
  if (playback) {
    result.mode = playback.mode ?? 'unknown'
    result.video = playback.transcode?.video ? 'encode' : 'copy'
    result.audio = playback.transcode?.audio
    const reasons: NonNullable<DiagnosticMediaSnapshot['reasons']> = [
      'ContainerNotSupported',
      'VideoCodecNotSupported',
      'VideoBitDepthNotSupported',
      'AudioCodecNotSupported',
      'AudioTrackSwitchNotSupported',
      'SubtitleCodecNotSupported',
      'HlsNotSupported',
      'ToolsMissing',
      'ProbeFailed',
      'DurationUnknown',
    ]
    result.reasons = reasons.filter(reason =>
      playback.reasons?.includes(reason),
    )
    result.audioTrack = number(
      selection?.audioStream ?? playback.audioStream,
      1000,
      true,
    )
    const subtitle = selection?.subtitle ?? playback.subtitle
    result.subtitleTrack
      = subtitle === 'off'
        ? -1
        : number(
            playback.media?.subtitles.findIndex(
              track => track.id === subtitle,
            ),
            1000,
            true,
          )
    const audio = playback.media?.audio.find(
      track => track.index === result.audioTrack,
    )
    if (audio) {
      const codecs = [
        'aac',
        'ac3',
        'eac3',
        'dts',
        'truehd',
        'mp3',
        'flac',
        'opus',
        'vorbis',
        'pcm',
      ]
      const languages = [
        'en',
        'ru',
        'de',
        'fr',
        'es',
        'it',
        'pt',
        'ja',
        'ko',
        'zh',
        'uk',
        'und',
      ]
      result.audioCodec = (
        codecs.includes(audio.codec ?? '') ? audio.codec : 'unknown'
      ) as DiagnosticMediaSnapshot['audioCodec']
      result.audioLanguage = (
        languages.includes(audio.language ?? '') ? audio.language : 'unknown'
      ) as DiagnosticMediaSnapshot['audioLanguage']
    }
  }
  return result
}
