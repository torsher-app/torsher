import type { AddonSourcePlayback } from '@torsher/api-client'
import { api } from '../api.ts'
import { captureTitleViewer, isTitleViewer } from '../titleActions.ts'
import { playerRoute } from './continue.ts'
import { playbackIdentity } from './viewingRestart.ts'

const RESOLVE_LIMIT_MS = 60_000
const RESOLVE_INTERVAL_MS = 2500
const MAX_LAUNCHES = 32
const launches = new Map<string, { id: string, viewer: number }>()

export function addonLaunchOf(instance: string) {
  const entry = launches.get(instance)
  return entry && isTitleViewer(entry.viewer) ? entry.id : undefined
}

interface Target {
  id: string
  season?: number | null
  episode?: number | null
}

export function addonSourcesRoute(id: string, target?: Omit<Target, 'id'>) {
  return {
    path: `/title/${id}/sources`,
    query: {
      season: target?.season != null ? String(target.season) : undefined,
      episode: target?.episode != null ? String(target.episode) : undefined,
    },
  }
}

function waitForMetadata(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', stop)
      resolve()
    }, RESOLVE_INTERVAL_MS)
    function stop() {
      clearTimeout(timer)
      reject(new Error('Cancelled'))
    }
    if (signal.aborted)
      stop()
    else signal.addEventListener('abort', stop, { once: true })
  })
}

export async function selectAddonSource(
  id: string,
  candidateId: string,
  signal: AbortSignal,
) {
  const end = Date.now() + RESOLVE_LIMIT_MS
  for (;;) {
    if (signal.aborted)
      return undefined
    const result = await api.titles.postTitleAddonSourcePlay(
      id,
      { candidateId },
      { signal },
    )
    if (result.kind !== 'torrent' || result.status !== 'resolving')
      return result
    if (Date.now() >= end)
      throw new Error('Timeout')
    await waitForMetadata(signal)
  }
}

export function addonPlaybackRoute(
  result: AddonSourcePlayback,
  target: Target,
  fromStart = false,
) {
  const { query } = addonSourcesRoute(target.id, target)
  if (result.kind === 'http') {
    const instance = playbackIdentity()
    if (launches.size >= MAX_LAUNCHES)
      launches.delete(launches.keys().next().value!)
    launches.set(instance, {
      id: result.launchId,
      viewer: captureTitleViewer(),
    })
    return {
      path: `/play/addon/${instance}`,
      query: { ...query, title: target.id, start: fromStart ? '0' : undefined },
    }
  }
  if (result.status === 'ready' && 'fileIndex' in result) {
    const route = playerRoute(result, target)
    return {
      ...route,
      query: { ...route.query, start: fromStart ? '0' : undefined },
    }
  }
  return {
    path: `/title/${target.id}/files/${result.torrentId}`,
    query: {
      ...query,
      addonSelection: '1',
      start: fromStart ? '0' : undefined,
    },
  }
}
