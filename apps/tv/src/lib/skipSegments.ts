import type { Playback } from '@torsher/api-client'
import { clampTime } from './player.ts'

export function currentSkip(
  segments: Playback['skipSegments'],
  position: number,
  duration: number,
) {
  if (!Number.isFinite(position) || !Number.isFinite(duration) || duration <= 0)
    return undefined
  return segments?.find(
    segment =>
      Number.isFinite(segment.start)
      && Number.isFinite(segment.end)
      && segment.start >= 0
      && segment.end > segment.start
      && position >= segment.start
      && position < segment.end
      && clampTime(segment.end, duration) > position + 0.25,
  )
}
