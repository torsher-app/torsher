import type { EngineTorrentState } from '../engine/index.ts'

/**
 * Что происходит с раздачей: `idle` — данных нет (не смотрели или вытеснена),
 * `partial` — что-то скачано потоком, но целиком ничего не качается,
 * `downloading` — качаются выбранные файлы или открыт поток,
 * `stalled` — качается, а пиров нет, `seeding` — выбранное скачано и раздаётся,
 * `complete` — скачано и не раздаётся, `paused`.
 */
export type DownloadState
  = | 'idle'
    | 'partial'
    | 'downloading'
    | 'stalled'
    | 'seeding'
    | 'complete'
    | 'paused'

export function downloadStateOf(
  live: EngineTorrentState | undefined,
  streaming: boolean,
): DownloadState {
  if (!live)
    return 'idle'

  if (live.paused)
    return 'paused'

  if (live.bytesWanted > 0 && live.wantedCompleted >= live.bytesWanted)
    return live.seeding ? 'seeding' : 'complete'

  if (live.bytesWanted === 0 && !streaming)
    return live.bytesCompleted > 0 ? 'partial' : 'idle'

  return live.peers.connected === 0 ? 'stalled' : 'downloading'
}
