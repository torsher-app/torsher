import type { Continuation } from '@torsher/api-client'
import {
  frameResolution,
  videoClassOf,
} from '@torsher/release-parser/resolution'

/** Compare source frames, never release names or transcoded output dimensions. */
export function lowerContinuationQuality(
  baseline: Continuation['baseline'] | undefined,
  candidate: { width: number | null, height: number | null } | null | undefined,
  file: NonNullable<Continuation['baseline']>['file'],
) {
  if (
    !baseline?.video
    || !candidate?.width
    || !candidate.height
    || baseline.video.basis !== 'probe'
  ) {
    return null
  }
  if (
    baseline.file.kind === 'library'
    && file.kind === 'library'
    && baseline.file.mediaFileId === file.mediaFileId
  ) {
    return null
  }
  if (
    baseline.file.kind === 'torrent'
    && file.kind === 'torrent'
    && baseline.file.torrentId === file.torrentId
    && baseline.file.fileIndex === file.fileIndex
  ) {
    return null
  }
  if (
    ![
      baseline.video.width,
      baseline.video.height,
      candidate.width,
      candidate.height,
    ].every(value => Number.isFinite(value) && value > 0)
  ) {
    return null
  }
  const before = videoClassOf(
    frameResolution(baseline.video.width, baseline.video.height),
  )
  const after = videoClassOf(
    frameResolution(candidate.width, candidate.height),
  )
  const order = ['SD', '720p', '1080p', '2160p']
  return order.indexOf(after) < order.indexOf(before) ? after : null
}

/** A running session may fill an evicted probe only for the server-selected exact file. */
export function continuationBaseline(
  continuation: Continuation | undefined,
  current?: NonNullable<Continuation['baseline']>,
) {
  const baseline = continuation?.baseline
  if (!baseline || baseline.video || !current?.video)
    return baseline
  const a = baseline.file
  const b = current.file
  // Library IDs survive file changes; without a version token only the
  // server's fresh persisted probe can establish their dimensions.
  const same
    = a.kind === 'torrent'
      && b.kind === 'torrent'
      && a.torrentId === b.torrentId
      && a.fileIndex === b.fileIndex
  return same ? { ...baseline, video: current.video } : baseline
}
