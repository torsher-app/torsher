import type { MediaAudioTrack } from '@torsher/api-client'

const CODECS: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  av1: 'AV1',
  vp9: 'VP9',
  mpeg4: 'MPEG-4',
  aac: 'AAC',
  ac3: 'AC3',
  eac3: 'E-AC3',
  dts: 'DTS',
  truehd: 'TrueHD',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  vorbis: 'Vorbis',
  pcm_s16le: 'PCM',
  pcm_s24le: 'PCM',
  subrip: 'SRT',
  srt: 'SRT',
  ass: 'ASS',
  ssa: 'SSA',
  webvtt: 'WebVTT',
  mov_text: 'MOV',
}

/** Кодек так, как его пишут в раздачах: AC3, E-AC3, DTS */
export function codecLabel(codec: string) {
  return CODECS[codec] ?? codec.toUpperCase()
}

/** Каналы так, как их пишут в раздачах: 2.0, 5.1, 7.1 */
export function channelsLabel(channels: number | null) {
  if (!channels)
    return null

  return channels > 2 ? `${channels - 1}.1` : `${channels}.0`
}

/** Битрейт в кбит/с, округлённый до целых */
export function kilobits(bitrate: number | null) {
  return bitrate ? Math.round(bitrate / 1000) : null
}

/**
 * Позиция дорожки среди аудиодорожек файла: в том же порядке их отдаёт
 * `audioTracks` плеера.
 */
export function audioOrder(tracks: MediaAudioTrack[], index: number) {
  return tracks.findIndex(track => track.index === index)
}

const ALLOWED_TAGS = /^<\/?[ibu]>$/

/**
 * Реплика WebVTT для показа: курсив, жирный и подчёркивание остаются,
 * остальная разметка и HTML экранируются, переводы строк — `<br>`.
 */
export function subtitleHtml(text: string) {
  return text
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (ALLOWED_TAGS.test(part))
        return part

      if (part.startsWith('<'))
        return ''

      return part
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
    })
    .join('')
    .replace(/\n/g, '<br>')
}

export interface TimedCue {
  start: number
  end: number
  text: string
}

/** Реплики, видимые в момент `time` (их бывает несколько одновременно) */
export function activeCues(cues: TimedCue[], time: number) {
  return cues.filter(cue => cue.start <= time && time < cue.end)
}
