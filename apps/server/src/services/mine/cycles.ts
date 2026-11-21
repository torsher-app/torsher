import type { CycleSource } from '../../db/schema.ts'
import type { MineCycle } from '../../dto/minePersonal.ts'
import type { CurrentProfile } from './personalAccess.ts'
import { and, eq, isNotNull, ne, sql } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import {
  cycleProgress,
  libraryFolders,
  mediaFiles,
  rewatchCycles,
} from '../../db/schema.ts'
import { titleLibraryFiles } from '../library/files.ts'
import {
  playableMediaFile,
  unavailableTorrentFiles,
} from '../library/folders.ts'
import { titleAllowedCached } from '../profiles/access.ts'
import { getSeason, TmdbError } from '../tmdb/index.ts'
import { playableFile, torrentsByInfoHash } from '../torrents/index.ts'
import { diaryTimeZone } from '../transfer/diaryTimeZone.ts'
import { calendarDayAt } from './calendar.ts'
import { allowMineTitle, MinePersonalError } from './personalAccess.ts'
import { localTitleDetails } from './personalMetadata.ts'
import { getCycleCursor } from './viewing.ts'

type Cycle = typeof rewatchCycles.$inferSelect
interface Episode {
  season: number
  episode: number
}

function cycleById(profileId: string, cycleId: string) {
  return getDb()
    .select()
    .from(rewatchCycles)
    .where(
      and(
        eq(rewatchCycles.profileId, profileId),
        eq(rewatchCycles.id, cycleId),
      ),
    )
    .get()
}

export function unfinishedCycle(profileId: string, titleId: string) {
  return getDb()
    .select()
    .from(rewatchCycles)
    .where(
      and(
        eq(rewatchCycles.profileId, profileId),
        eq(rewatchCycles.titleId, titleId),
        ne(rewatchCycles.state, 'ended'),
      ),
    )
    .get()
}

export async function requireAvailableEpisode(
  profileId: string,
  titleId: string,
  target: Episode,
  language: string,
) {
  if (
    titleLibraryFiles(titleId, undefined, target).some(file =>
      playableMediaFile(file.id, profileId),
    )
  ) {
    return
  }
  const season = localTitleDetails(titleId, language)?.seasons?.find(
    row => row.number === target.season,
  )
  if (season && season.airedEpisodeCount >= target.episode)
    return

  try {
    const details = await getSeason(titleId, target.season, language)
    const item = details?.episodes.find(
      episode => episode.number === target.episode,
    )
    if (
      item?.airDate
      && item.airDate <= calendarDayAt(Date.now(), diaryTimeZone())
    ) {
      return
    }
  }
  catch (error) {
    if (!(error instanceof TmdbError))
      throw error
    if (error.kind !== 'not_found')
      throw new MinePersonalError('catalogUnavailable', 503)
  }
  throw new MinePersonalError('invalidEpisode', 400)
}

export function visibleCycleSource(
  profileId: string,
  titleId: string,
  target: Episode,
  source: CycleSource | null | undefined,
): NonNullable<MineCycle['resume']>['source'] {
  if (source?.kind === 'library') {
    const db = getDb()
    const row = db
      .select({ id: mediaFiles.id })
      .from(mediaFiles)
      .innerJoin(libraryFolders, eq(libraryFolders.id, mediaFiles.folderId))
      .where(
        and(
          eq(libraryFolders.path, source.folder),
          eq(mediaFiles.relPath, source.path),
        ),
      )
      .get()
    const file = row && playableMediaFile(row.id, profileId)?.file
    return file
      && file.titleId === titleId
      && file.season === target.season
      && file.episode !== null
      && target.episode >= file.episode
      && target.episode <= (file.episodeTo ?? file.episode)
      ? { kind: 'library', mediaFileId: file.id }
      : null
  }
  if (source?.kind === 'torrent') {
    const torrent = torrentsByInfoHash([source.infoHash]).get(source.infoHash)
    return torrent?.titleId === titleId
      && torrent.status === 'ready'
      && playableFile(torrent, source.fileIndex)
      && !unavailableTorrentFiles(profileId, torrent.id).has(source.fileIndex)
      ? { kind: 'torrent', torrentId: torrent.id, fileIndex: source.fileIndex }
      : null
  }
  return null
}

function nextCycleEpisode(cycle: Cycle, language: string): Episode | undefined {
  const completed = new Set(
    getDb()
      .select({ season: cycleProgress.season, episode: cycleProgress.episode })
      .from(cycleProgress)
      .where(
        and(
          eq(cycleProgress.profileId, cycle.profileId),
          eq(cycleProgress.cycleId, cycle.id),
          isNotNull(cycleProgress.completedAt),
        ),
      )
      .all()
      .map(row => `${row.season}:${row.episode}`),
  )
  const afterTarget = (item: Episode) =>
    item.season > cycle.targetSeason
    || (item.season === cycle.targetSeason && item.episode > cycle.targetEpisode)
  const unseen = (item: Episode) =>
    afterTarget(item) && !completed.has(`${item.season}:${item.episode}`)
  const details = localTitleDetails(cycle.titleId, language)
  const aired = [...(details?.seasons ?? [])].sort(
    (a, b) => a.number - b.number,
  )
  let next: Episode | undefined
  for (const season of aired) {
    if (season.number < cycle.targetSeason)
      continue
    const first
      = season.number === cycle.targetSeason ? cycle.targetEpisode + 1 : 1
    for (let episode = first; episode <= season.airedEpisodeCount; episode++) {
      const candidate = { season: season.number, episode }
      if (unseen(candidate)) {
        next = candidate
        break
      }
    }
    if (next)
      break
  }

  // Files can establish later episodes even when the catalog is offline.
  for (const file of titleLibraryFiles(cycle.titleId)) {
    if (
      file.season === null
      || file.episode === null
      || !playableMediaFile(file.id, cycle.profileId)
    ) {
      continue
    }
    const start
      = file.season === cycle.targetSeason
        ? Math.max(file.episode, cycle.targetEpisode + 1)
        : file.episode
    for (
      let episode = start;
      episode <= (file.episodeTo ?? file.episode);
      episode++
    ) {
      const local = { season: file.season, episode }
      if (
        unseen(local)
        && (!next
          || local.season < next.season
          || (local.season === next.season && local.episode < next.episode))
      ) {
        return local
      }
    }
  }
  return next
}

export function cycleWire(cycle: Cycle, language: string): MineCycle {
  const target = { season: cycle.targetSeason, episode: cycle.targetEpisode }
  const started = {
    profileId: cycle.profileId,
    titleId: cycle.titleId,
    ...target,
  }
  const cursor = getCycleCursor(started, cycle.id)
  const next = cursor?.completedAt
    ? nextCycleEpisode(cycle, language)
    : undefined
  const resume
    = cycle.state === 'active'
      ? (next ?? (cursor?.completedAt ? undefined : target))
      : undefined
  const resumeCursor = next
    ? getCycleCursor({ ...started, ...next }, cycle.id)
    : cursor
  return {
    id: cycle.id,
    titleId: cycle.titleId,
    state: cycle.state,
    start: { season: cycle.startSeason, episode: cycle.startEpisode },
    target,
    updatedAt: cycle.updatedAt.toISOString(),
    resume: resume
      ? {
          ...resume,
          position: resumeCursor?.position ?? 0,
          duration: resumeCursor?.duration ?? null,
          source: visibleCycleSource(
            cycle.profileId,
            cycle.titleId,
            resume,
            resumeCursor?.source,
          ),
          voiceStudio: resumeCursor?.voiceStudio ?? cursor?.voiceStudio ?? null,
          voiceType: resumeCursor?.voiceType ?? cursor?.voiceType ?? null,
          next: !!next,
        }
      : null,
  }
}

export async function createCycle(
  current: CurrentProfile,
  titleId: string,
  input: Episode & { requestId: string, language: string },
) {
  const profileId = current()
  const title = await allowMineTitle(titleId, current)
  if (title.type !== 'tv')
    throw new MinePersonalError('invalidEpisode', 400)
  const db = getDb()
  const previous = () =>
    db
      .select()
      .from(rewatchCycles)
      .where(
        and(
          eq(rewatchCycles.profileId, profileId),
          eq(rewatchCycles.createRequestId, input.requestId),
        ),
      )
      .get()
  function retry(row: Cycle) {
    if (
      row.titleId !== titleId
      || row.startSeason !== input.season
      || row.startEpisode !== input.episode
    ) {
      throw new MinePersonalError('conflict', 409)
    }
    return cycleWire(row, input.language)
  }
  const receipt = previous()
  if (receipt)
    return retry(receipt)

  await requireAvailableEpisode(profileId, titleId, input, input.language)
  current()
  if (!titleAllowedCached(profileId, titleId))
    throw new MinePersonalError('notFound', 404)
  return db.transaction(() => {
    const repeated = previous()
    if (repeated)
      return retry(repeated)
    if (unfinishedCycle(profileId, titleId))
      throw new MinePersonalError('conflict', 409)
    const now = new Date()
    return cycleWire(
      db
        .insert(rewatchCycles)
        .values({
          profileId,
          titleId,
          createRequestId: input.requestId,
          startSeason: input.season,
          startEpisode: input.episode,
          targetSeason: input.season,
          targetEpisode: input.episode,
          state: 'active',
          createdAt: now,
          updatedAt: now,
        })
        .returning()
        .get(),
      input.language,
    )
  })
}

export async function changeCycle(
  current: CurrentProfile,
  cycleId: string,
  action: 'pause' | 'resume' | 'end',
  language: string,
) {
  const profileId = current()
  const before = cycleById(profileId, cycleId)
  if (!before)
    throw new MinePersonalError('notFound', 404)
  await allowMineTitle(before.titleId, current)
  const db = getDb()
  return db.transaction(() => {
    const cycle = cycleById(current(), cycleId)
    if (!cycle)
      throw new MinePersonalError('notFound', 404)
    const state
      = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'ended'
    if (cycle.state === state)
      return cycleWire(cycle, language)
    if (cycle.state === 'ended')
      throw new MinePersonalError('conflict', 409)
    db.update(rewatchCycles)
      .set({ state, updatedAt: new Date() })
      .where(
        and(
          eq(rewatchCycles.profileId, profileId),
          eq(rewatchCycles.id, cycleId),
          // Reject deleting a cycle in another concurrent profile action.
          sql`${rewatchCycles.lifecycleRevision} = ${cycle.lifecycleRevision}`,
        ),
      )
      .run()
    return cycleWire(cycleById(profileId, cycleId)!, language)
  })
}
