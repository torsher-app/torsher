import type { SubtitleProvider } from '../../dto/subtitles.ts'
import type { SubtitleLanguage } from './languages.ts'

export interface SubtitleCandidate {
  provider: SubtitleProvider
  remoteId: string
  fileLink?: string
  language: SubtitleLanguage
  release: string
  match: 'hash' | 'release' | 'title'
  forced?: boolean
  hearingImpaired?: boolean
}

export function boundedLabel(value: unknown) {
  return typeof value === 'string'
    ? value
        .replace(/[\s\p{Cc}\p{Cf}]+/gu, ' ')
        .trim()
        .slice(0, 220)
    : ''
}

export function bool(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}
