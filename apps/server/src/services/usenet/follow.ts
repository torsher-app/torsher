import type { UsenetJob } from '../../db/schema.ts'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { followEpisodes, follows } from '../../db/schema.ts'
import { recordHistory } from '../follow/history.ts'

type JobEvent = 'grabbed' | 'downloaded' | 'blocklisted'

function followFor(job: UsenetJob) {
  if (job.origin !== 'follow' || !job.followId)
    return undefined

  return getDb()
    .select()
    .from(follows)
    .where(and(eq(follows.id, job.followId), eq(follows.titleId, job.titleId)))
    .get()
}

/** Call in the transaction that commits the corresponding job transition. */
export function recordUsenetFollow(job: UsenetJob, kind: JobEvent) {
  const follow = followFor(job)
  if (!follow)
    return undefined

  const at = new Date()
  recordHistory(
    {
      followId: follow.id,
      titleId: job.titleId,
      kind,
      season: job.season,
      episodes: [job.episode],
      releaseTitle: job.releaseTitle,
      indexerId: job.sourceId,
    },
    at,
  )

  const db = getDb()
  if (kind === 'downloaded' && follow.mode === 'download') {
    const acquired = {
      pending: null,
      waitUntil: null,
      stateNote: null,
      torrentId: null,
      fileIndex: null,
      grabbedAt: job.createdAt,
      grabbedTitle: job.releaseTitle,
      downloadedAt: at,
    }
    db.insert(followEpisodes)
      .values({
        followId: follow.id,
        season: job.season,
        episode: job.episode,
        firstSeenAt: job.createdAt,
        ...acquired,
      })
      .onConflictDoUpdate({
        target: [
          followEpisodes.followId,
          followEpisodes.season,
          followEpisodes.episode,
        ],
        set: { ...acquired, notifiedAt: null },
        setWhere: and(
          isNull(followEpisodes.downloadedAt),
          isNull(followEpisodes.upgradeFrom),
        ),
      })
      .run()
  }

  if (kind === 'blocklisted' && follow.state === 'active') {
    // Persist the wake-up alongside the job. The caller also requests a
    // budgeted retry in memory for the current session.
    db.update(follows)
      .set({ nextSearchAt: at })
      .where(eq(follows.id, follow.id))
      .run()
    return follow.id
  }
}
