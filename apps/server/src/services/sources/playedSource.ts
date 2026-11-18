import type { PlayedSource, TitleProgress } from '../../db/schema.ts'
import type { PlayedVoice, SourceEvidence } from '../library/playedSource.ts'
import type { AudioStreamInfo } from '../media/probe.ts'
import { stat } from 'node:fs/promises'
import { getMediaFile } from '../library/files.ts'
import {
  evidenceQuality,
  libraryContentKey,
  libraryProbeKey,
  rememberedVoice,
  storedLibraryEvidence,
  storedLibraryFile,
  storedProbeMatches,
} from '../library/playedSource.ts'
import { peekMediaProbe } from '../media/probe.ts'
import { getTorrent } from '../torrents/index.ts'

export interface SourceRef {
  torrentId: string | null
  fileIndex: number | null
  mediaFileId?: string | null
}

export interface PreparedPlayedSource extends SourceEvidence {
  ref: SourceRef
  audio?: AudioStreamInfo[]
}

/** Проверка текущих bytes до SQL-транзакции; новую пробу не запускает. */
export async function preparePlayedSource(
  ref: SourceRef,
): Promise<PreparedPlayedSource | undefined> {
  if (!ref.mediaFileId)
    return undefined
  const found = getMediaFile(ref.mediaFileId)
  const prepared: PreparedPlayedSource = { ref, path: found?.path }
  if (!found)
    return prepared
  const info = await stat(found.path).catch(() => undefined)
  if (!info?.isFile())
    return prepared
  const probe
    = peekMediaProbe(libraryProbeKey(ref.mediaFileId, info))
      ?? (storedProbeMatches(found.file, info) ? found.file.probe : null)
  prepared.contentKey = libraryContentKey(info)
  prepared.video = probe?.video
  prepared.audio = probe?.audio
  return prepared
}

export function sameSource(a: SourceRef | PlayedSource, b: SourceRef) {
  if ('kind' in a && a.kind === 'unknown')
    return false
  const mediaFileId = 'mediaFileId' in a ? a.mediaFileId : null
  if (mediaFileId || b.mediaFileId)
    return !!mediaFileId && mediaFileId === b.mediaFileId
  return (
    a.torrentId !== null
    && a.torrentId === b.torrentId
    && a.fileIndex === b.fileIndex
  )
}

/** Снимок сохранённых метаданных: без чтения файлов и повторного ffprobe. */
export function capturePlayedSource(
  ref: SourceRef,
  voice: PlayedVoice,
  previous?: PlayedSource | null,
  prepared?: PreparedPlayedSource,
): PlayedSource {
  let evidence: SourceEvidence
  let playedRef = ref
  if (prepared && sameSource(prepared.ref, ref)) {
    evidence = prepared
    playedRef = prepared.ref
  }
  else if (ref.mediaFileId) {
    evidence = storedLibraryEvidence(storedLibraryFile(ref.mediaFileId))
  }
  else if (ref.torrentId && ref.fileIndex !== null) {
    const torrent = getTorrent(ref.torrentId)
    evidence = {
      path: torrent?.files?.[ref.fileIndex]?.path,
      contentKey: torrent && `torrent:${torrent.infoHash}:${ref.fileIndex}`,
      video:
        torrent
        && peekMediaProbe(`${torrent.infoHash}:${ref.fileIndex}`)?.video,
    }
  }
  else {
    return { kind: 'unknown' }
  }

  const { contentKey } = evidence
  const previousQuality
    = previous
      && previous.kind !== 'unknown'
      && contentKey
      && previous.contentKey === contentKey
      && sameSource(previous, ref)
      ? previous.quality
      : null
  const quality = evidenceQuality(evidence, previousQuality)
  return ref.mediaFileId
    ? {
        kind: 'library',
        mediaFileId: ref.mediaFileId,
        torrentId: playedRef.torrentId,
        fileIndex: playedRef.fileIndex,
        quality,
        contentKey,
        voice,
      }
    : {
        kind: 'torrent',
        torrentId: ref.torrentId!,
        fileIndex: ref.fileIndex!,
        quality,
        contentKey,
        voice,
      }
}

/** Совместимое чтение legacy: до первой смены выбора сохраняем реальный источник. */
export function freezePlayedSource(row: TitleProgress) {
  return (
    row.playedSource
    ?? (row.position > 0 || row.lastPlayedAt !== null
      ? capturePlayedSource(row, rememberedVoice(row))
      : row.watchedAt !== null
        ? { kind: 'unknown' as const }
        : null)
  )
}
