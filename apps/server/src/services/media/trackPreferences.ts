import type { AudioStreamInfo, MediaInfo } from './probe.ts'
import type { ExternalSubtitle } from './subtitles.ts'
import { parseAudioLabel } from '@torsher/release-parser'

function voiceOfTrack(track: AudioStreamInfo) {
  return track.title ? parseAudioLabel(track.title) : undefined
}

export interface SavedAudioPreference {
  language: string | null
  studio: string | null
  voiceType: string | null
}
export interface SavedSubtitlePreference {
  enabled: boolean
  language: string | null
  forced: boolean
}
export interface SavedTrackPreferences {
  audio?: SavedAudioPreference | null
  subtitles?: SavedSubtitlePreference | null
}

const ALIASES: Record<string, string> = {
  ru: 'rus',
  en: 'eng',
  uk: 'ukr',
  fr: 'fra',
  fre: 'fra',
  de: 'deu',
  ger: 'deu',
  es: 'spa',
  it: 'ita',
  pt: 'por',
  ja: 'jpn',
  ko: 'kor',
  zh: 'zho',
  chi: 'zho',
}
export function trackLanguage(language: string | null) {
  const code = language?.toLowerCase()
  return code && code !== 'und' ? (ALIASES[code] ?? code) : null
}
export function audioPreferenceOf(
  track: AudioStreamInfo,
): SavedAudioPreference {
  const voice = voiceOfTrack(track)
  return {
    language: trackLanguage(track.language),
    studio: voice?.studio ?? null,
    voiceType: voice?.type ?? null,
  }
}
export function matchesAudio(
  track: AudioStreamInfo,
  preference: SavedAudioPreference,
) {
  const voice = voiceOfTrack(track)
  // Unknown metadata cannot confirm a preference across files.
  return (
    !!(preference.language || preference.studio || preference.voiceType)
    && (!preference.language
      || trackLanguage(track.language) === preference.language)
    && (!preference.studio
      || voice?.studio?.toLowerCase() === preference.studio.toLowerCase())
    && (!preference.voiceType || voice?.type === preference.voiceType)
  )
}
export function preferredSubtitle(
  media: MediaInfo,
  external: ExternalSubtitle[],
  preference?: SavedSubtitlePreference | null,
) {
  if (!preference?.enabled || !preference.language)
    return null
  const embedded = media.subtitles.find(
    track =>
      (track.text || track.image)
      && trackLanguage(track.language) === preference.language
      && track.forced === preference.forced,
  )
  if (embedded)
    return `s${embedded.index}`
  const sidecar = external.find(
    track =>
      trackLanguage(track.language) === preference.language
      && track.forced === preference.forced,
  )
  return sidecar ? `f${sidecar.fileIndex}` : null
}
