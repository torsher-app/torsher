import type { Playback } from '@torsher/api-client'
import type { DiagnosticInput } from './collector.ts'

type Gate = Extract<
  DiagnosticInput,
  { event: 'upnext.visibility' | 'upnext.selected' | 'upnext.dismissed' }
>['gate']
/** Describes the actual computed visibility; it never decides whether to show the card. */
export function upNextGate(state: {
  available: boolean
  hasTarget: boolean
  displayed: boolean
  dismissed: boolean
  playing: boolean
  restarting: boolean
  error: boolean
  panel: boolean
  credits: boolean
  ended: boolean
  duration: number
}): Gate {
  if (!state.hasTarget)
    return 'no_target'
  if (!state.available)
    return 'no_sources_or_library'
  if (state.dismissed)
    return 'dismissed'
  if (!state.playing)
    return 'not_playing'
  if (state.restarting)
    return 'restarting'
  if (state.error)
    return 'error'
  if (state.panel)
    return 'panel'
  if (state.displayed)
    return state.ended ? 'ended' : state.credits ? 'credits' : 'remaining'
  return state.duration > 0 ? 'before_threshold' : 'duration_unknown'
}

export function diagnosticPlaybackMode(playback: Playback | undefined) {
  if (!playback?.mode)
    return undefined
  if (playback.mode === 'direct')
    return 'direct' as const
  return playback.transcode?.video
    || (playback.transcode?.audio && playback.transcode.audio !== 'copy')
    ? ('transcode' as const)
    : ('remux' as const)
}
