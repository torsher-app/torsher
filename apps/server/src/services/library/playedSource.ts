import type { Stats } from 'node:fs'
import { stat } from 'node:fs/promises'
import type {
  MediaFile,
  PlayedSource,
  TitleProgress,
} from '../../db/schema.ts'
import type { VideoClass, VoiceType } from '@torsher/release-parser'
import { basename } from 'node:path'
import {
  frameResolution,
  parseRelease,
  videoClassOf,
} from '@torsher/release-parser'
import { and, eq, isNull } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { mediaFiles, titleProgress } from '../../db/schema.ts'

type FileStat = Pick<Stats, 'size' | 'mtimeMs' | 'ino' | 'dev'>

export function persistedProbeKey(info: Pick<FileStat, 'size' | 'mtimeMs'>) {
  return `${info.size}:${info.mtimeMs}`
}

export function libraryProbeKey(id: string, info: FileStat) {
  return `library:${id}:${info.dev}:${info.ino}:${persistedProbeKey(info)}`
}

export function libraryContentKey(info: FileStat) {
  return `library:${info.ino}:${persistedProbeKey(info)}`
}

export async function libraryRevisionMatches(
  path: string,
  id: string,
  expected: string,
) {
  const info = await stat(path).catch(() => undefined)
  return !!info?.isFile() && libraryProbeKey(id, info) === expected
}

/** Scanner truncates, while fs.Stats.mtime rounds to a whole millisecond. */
export function sameStoredMtime(stored: Date, mtimeMs: number) {
  return (
    stored.getTime() === Math.trunc(mtimeMs)
    || stored.getTime() === Math.round(mtimeMs)
  )
}

export function storedProbeMatches(file: MediaFile, info: FileStat) {
  return (
    file.inode === info.ino
    && file.size === info.size
    && sameStoredMtime(file.mtime, info.mtimeMs)
    && file.probeKey === persistedProbeKey(info)
  )
}

export interface SourceEvidence {
  path?: string
  contentKey?: string
  video?: { width: number | null, height: number | null } | null
}

export type PlayedVoice = Exclude<PlayedSource, { kind: 'unknown' }>['voice']

export function rememberedVoice(
  row: Pick<TitleProgress, 'voiceStudio' | 'voiceType'>,
): PlayedVoice {
  return row.voiceStudio || row.voiceType
    ? {
        studio: row.voiceStudio ?? undefined,
        type: (row.voiceType as VoiceType | null) ?? undefined,
      }
    : null
}

export function evidenceQuality(
  evidence: SourceEvidence,
  previous?: VideoClass | null,
): VideoClass | null {
  const { video, path } = evidence
  if (video?.width && video.height && video.width > 0 && video.height > 0)
    return videoClassOf(frameResolution(video.width, video.height))
  if (previous)
    return previous
  const parsed = path && parseRelease(basename(path)).quality
  return parsed ? videoClassOf(parsed) : null
}

/** Uses the stored revision, including files currently marked missing. */
export function storedLibraryEvidence(file?: MediaFile): SourceEvidence {
  if (!file)
    return {}
  const key = file.probeKey?.match(/^(\d+):(-?\d+(?:\.\d+)?)$/)
  return {
    path: file.relPath,
    contentKey: `library:${file.inode ?? ''}:${file.size}:${file.mtime.getTime()}`,
    video:
      key
      && Number(key[1]) === file.size
      && sameStoredMtime(file.mtime, Number(key[2]))
        ? file.probe?.video
        : null,
  }
}

export function storedLibraryFile(id: string) {
  return getDb().select().from(mediaFiles).where(eq(mediaFiles.id, id)).get()
}

/** Freeze legacy history before committing new metadata for the same media ID. */
export function freezeLibraryProgress(mediaFileId: string, known?: MediaFile) {
  const db = getDb()
  const file = known ?? storedLibraryFile(mediaFileId)
  const evidence = storedLibraryEvidence(file)
  for (const row of db
    .select()
    .from(titleProgress)
    .where(
      and(
        eq(titleProgress.mediaFileId, mediaFileId),
        isNull(titleProgress.playedSource),
      ),
    )
    .all()) {
    const playedSource: PlayedSource | null
      = row.position > 0 || row.lastPlayedAt !== null
        ? {
            kind: 'library',
            mediaFileId,
            torrentId: row.torrentId,
            fileIndex: row.fileIndex,
            contentKey: evidence.contentKey,
            quality: evidenceQuality(evidence),
            voice: rememberedVoice(row),
          }
        : row.watchedAt
          ? { kind: 'unknown' }
          : null
    if (playedSource) {
      db.update(titleProgress)
        .set({ playedSource })
        .where(
          and(
            eq(titleProgress.profileId, row.profileId),
            eq(titleProgress.titleId, row.titleId),
            eq(titleProgress.season, row.season),
            eq(titleProgress.episode, row.episode),
          ),
        )
        .run()
    }
  }
}
