import type { ResumeLike } from '../lib/continue.ts'
import type { DiagnosticContext } from './index.ts'
import { diagnostic } from './index.ts'

const received = new WeakMap<object, number>()
export function noteContinueReceived(items: object[]) {
  for (const item of items) received.set(item, Date.now())
}
export function continueSnapshot(
  event: 'continue.presented' | 'continue.selected',
  titleId: string,
  item: ResumeLike & { mediaFileId?: string | null },
  context?: DiagnosticContext,
) {
  diagnostic(
    {
      event,
      titleId,
      decisionId: item.decisionId,
      season: item.season ?? undefined,
      episode: item.episode ?? undefined,
      torrentId: item.file?.torrentId,
      fileIndex: item.file?.fileIndex,
      mediaFileId: item.mediaFileId ?? undefined,
      position: item.position,
      duration: item.duration,
      next: item.next,
      followNewEpisode: !!item.followNewEpisode,
      snapshotAgeMs: Math.min(
        1_000_000,
        Math.max(0, Date.now() - (received.get(item) ?? Date.now())),
      ),
    },
    context,
    event === 'continue.selected',
  )
}
