import { z } from 'zod'
import { diagnosticId } from '../../dto/diagnostics.ts'

const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const ms = z.number().int().min(0).max(31_536_000_000)
const infoHash = z.string().regex(/^[a-f0-9]{40}$/)
const torrent = { torrentId: diagnosticId, infoHash }
export const storageErrnos = [
  'EACCES',
  'EPERM',
  'EROFS',
  'ENOTDIR',
  'EEXIST',
  'ENOENT',
  'ENOSPC',
  'EDQUOT',
  'EIO',
  'ESTALE',
  'unknown',
] as const
export type StorageErrno = (typeof storageErrnos)[number]
export function storageErrno(err: unknown): StorageErrno {
  const code
    = err && typeof err === 'object' && 'code' in err ? err.code : undefined
  return storageErrnos.includes(code as StorageErrno)
    ? (code as StorageErrno)
    : 'unknown'
}
export const engineRequestOperations = z.enum([
  'postTorrent',
  'deleteTorrent',
  'postTorrentRetry',
  'postTorrentDownload',
  'putTorrentPriority',
  'postTorrentPause',
  'postTorrentResume',
  'putTorrentRetention',
  'deleteTorrentLibrary',
  'getTorrentStats',
  'getStorage',
  'putStoragePolicy',
  'putStoragePath',
  'postStorageMove',
  'postStorageMoveCancel',
  'postTitleWatch',
  'postTitleOpen',
  'postTitleDownload',
  'deleteTitleDownload',
  'postTitleKeep',
  'openFollowPick',
  'postPlayback',
  'streamTorrentFile',
  'restartEngine',
  'unknown',
])
export const engineRequestDiagnostic = z.object({
  operation: engineRequestOperations,
  errorKind: z.enum([
    'unavailable',
    'not_found',
    'rejected',
    'timeout',
    'moving',
    'failed',
  ]),
  status: z.number().int().min(100).max(599).optional(),
  unavailable: z.enum(['starting', 'stopped', 'not_installed']).optional(),
  torrentId: diagnosticId.optional(),
  infoHash: infoHash.optional(),
  requestId: diagnosticId.optional(),
})
export const storageDiagnosticEvents = {
  'storage.metadata_failed': z.object({
    ...torrent,
    reason: z.enum(['timeout', 'rejected', 'failed', 'hash_mismatch']),
    elapsedMs: ms,
  }),
  'storage.insufficient_space': z.object({
    ...torrent,
    kind: z.enum(['stream', 'download', 'unknown']),
    shortage: z.enum(['no_space', 'cache_limit']),
    needed: count,
    available: count,
    free: count,
    minFree: count,
    cacheLimit: count,
  }),
  'storage.folder_rejected': z.object({
    setting: z.enum(['downloads', 'library']),
    errorKind: z.enum([
      'not_absolute',
      'not_directory',
      'denied',
      'inside_data',
      'overlaps_other',
      'library_folder',
      'no_space',
    ]),
    errno: z.enum(storageErrnos),
    uid: count.optional(),
    gid: count.optional(),
  }),
}
export function storageDiagnosticRule(event: unknown) {
  return typeof event === 'string'
    && Object.hasOwn(storageDiagnosticEvents, event)
    ? storageDiagnosticEvents[event as keyof typeof storageDiagnosticEvents]
    : undefined
}
