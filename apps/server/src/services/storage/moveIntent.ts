export interface DownloadIntent {
  kind: 'downloads'
  token: string
  torrentId: string
  infoHash: string
  source: string
  target: string
  bytes: number
}

export interface FileSnapshot {
  path: string
  size: number
  dev: number
  ino: number
  mtimeMs: number
}

export interface MoveFileReceipt {
  source: FileSnapshot
  target: FileSnapshot
}

export interface DirectorySnapshot {
  path: string
  real: string
  dev: number
  ino: number
}

export interface LibraryIntent {
  kind: 'library'
  token: string
  mediaId: string
  sourceFolderId: string
  targetFolderId: string
  sourceRoot: DirectorySnapshot
  targetRoot: DirectorySnapshot
  sourceParent: DirectorySnapshot
  targetParent: DirectorySnapshot
  relPath: string
  bytes: number
  orphan?: true
  files: MoveFileReceipt[]
  linkMode: 'hardlink' | 'reflink' | 'copy' | null
  stage?: DirectorySnapshot
  phase: 'prepared' | 'committed' | 'rollback' | 'rolled_back' | 'cleaned'
}

export interface StorageMoveRecovery {
  cancelRequested?: boolean
  current?: DownloadIntent | LibraryIntent
}
