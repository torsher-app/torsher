import type { RouteLocationNormalizedLoaded } from 'vue-router'

export function sourceReturnState(
  route: Pick<RouteLocationNormalizedLoaded, 'path' | 'query'>,
  position: number,
  paused: boolean,
) {
  return { path: route.path, query: { ...route.query }, position, paused }
}

export function playbackResume(value: unknown) {
  if (!value || typeof value !== 'object')
    return undefined
  const state = value as Record<string, unknown>
  if (
    typeof state.position !== 'number'
    || !Number.isFinite(state.position)
    || state.position < 0
    || state.position > 1_000_000
    || typeof state.paused !== 'boolean'
  ) {
    return undefined
  }
  return { position: state.position, paused: state.paused }
}

/** Only the originating player for this title can be restored by cancellation. */
export function sourceReturnRoute(value: unknown, titleId: string) {
  const resume = playbackResume(value)
  if (!resume)
    return undefined
  const state = value as Record<string, unknown>
  if (
    typeof state.path !== 'string'
    || !/^\/play\/(?:library\/[^/?#]+|[^/?#]+\/\d+)$/.test(state.path)
    || !state.query
    || typeof state.query !== 'object'
    || Array.isArray(state.query)
  ) {
    return undefined
  }
  const query = state.query as Record<string, unknown>
  if (query.title !== titleId)
    return undefined
  const copy: Record<string, string | null | (string | null)[]> = {}
  for (const [key, val] of Object.entries(query)) {
    if (typeof val === 'string' || val === null) {
      copy[key] = val
    }
    else if (
      Array.isArray(val)
      && val.every(item => typeof item === 'string' || item === null)
    ) {
      copy[key] = val
    }
    else {
      return undefined
    }
  }
  return {
    path: state.path,
    query: copy,
    state: { sourceReturn: null, resumePlayback: resume },
  }
}
