export interface SkipSegment {
  id: string
  kind: 'intro' | 'credits'
  start: number
  end: number
  source: 'audio' | 'visual'
}

// Increment when extraction, matching, or boundary rules change.
export const ANALYSIS_VERSION = 4
export const FINGERPRINT_WINDOW = 600
export const FINGERPRINT_STEP = 4096 / 33075
export const FRAME_WIDTH = 320
export const FRAME_HEIGHT = 180
export const FRAME_SIZE = FRAME_WIDTH * FRAME_HEIGHT
export type AnalysisStatus
  = 'ready' | 'no-match' | 'insufficient' | 'unsupported' | 'error' | 'cancelled'
export interface AnalysisData {
  status: AnalysisStatus
  audioStatus?: AnalysisStatus
  visualDone: boolean
  fingerprint: number[] | null
  audioTrack: number | null
  window: number
  segments: SkipSegment[]
  references: { id: string, revision: string, identity: string }[]
}

export function introWindow(duration: number) {
  return Math.min(FINGERPRINT_WINDOW, duration * 0.5)
}

export function creditsWindow(duration: number) {
  return Math.min(600, duration * 0.15)
}
