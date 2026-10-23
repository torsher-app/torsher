export { extensionKind, matchFiles } from './files.ts'
export { parseAudioLabel } from './label.ts'
export { matchTitle } from './match.ts'
export type {
  MatchConfidence,
  MatchIssue,
  TitleMatch,
  TitleTarget,
} from './match.ts'
export { normalizeTitle, titleKey, transliterate } from './normalize.ts'
export { parseRelease } from './parse.ts'
export {
  frameResolution,
  videoClassOf,
  videoResolution,
} from './resolution.ts'
export { findStudio, studios } from './studios.ts'
export type { Studio } from './studios.ts'
export type * from './types.ts'
