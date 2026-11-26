import type { MaintenanceManifestPath } from '../../db/schema.ts'
import { lstat } from 'node:fs/promises'
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from 'node:path'
import {
  ownedIdentity,
  rootIdentity,
  verifyOwnedFile,
} from '../libraryMaintenance/identity.ts'

export interface CleanupFile extends MaintenanceManifestPath {
  entry: string
  blocks: number
  links: number
  reflink: boolean
}

export type CleanupFailure
  = 'busy' | 'private' | 'conflict' | 'unavailable' | 'missing'

export class CleanupError extends Error {
  readonly reason: CleanupFailure

  constructor(reason: CleanupFailure) {
    super(reason)
    this.reason = reason
  }
}

export function under(root: string, path: string) {
  const rel = relative(root, path)
  return !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

export async function cleanupFile(
  root: string,
  path: string,
  kind: CleanupFile['kind'],
  mediaFileId: string | null,
  reflink = false,
): Promise<CleanupFile | null> {
  if (
    resolve(root) !== root
    || resolve(path) !== path
    || root === path
    || !under(root, path)
  ) {
    throw new CleanupError('conflict')
  }
  const owner = await rootIdentity(root)
  if (!owner)
    throw new CleanupError('unavailable')
  const identity = await ownedIdentity(root, path)
  if (!identity) {
    const state = await verifyOwnedFile({
      root,
      path,
      ...owner,
      device: '',
      inode: 0,
      size: 0,
      mtime: 0,
    })
    if (state === 'missing')
      return null
    throw new CleanupError('conflict')
  }
  if (
    identity.rootDevice !== owner.rootDevice
    || identity.rootInode !== owner.rootInode
  ) {
    throw new CleanupError('conflict')
  }
  const [file, parent] = await Promise.all([
    lstat(path),
    lstat(dirname(path), { bigint: true }),
  ])
  if (
    !file.isFile()
    || !parent.isDirectory()
    || file.ino !== identity.inode
    || String(file.dev) !== identity.device
    || file.size !== identity.size
    || file.mtimeMs !== identity.mtime
  ) {
    throw new CleanupError('conflict')
  }
  return {
    ...identity,
    fileId: path,
    mediaFileId,
    kind,
    entry: `${parent.dev}:${parent.ino}:${basename(path)}`,
    blocks: file.blocks,
    links: file.nlink,
    reflink,
  }
}

export function estimatedReclaim(files: CleanupFile[]) {
  const inodes = new Map<
    string,
    { links: number, blocks: number, entries: Set<string> }
  >()
  for (const file of files) {
    if (
      file.reflink
      || !Number.isSafeInteger(file.blocks)
      || !Number.isSafeInteger(file.links)
    ) {
      return null
    }
    const key = `${file.device}:${file.inode}`
    let inode = inodes.get(key)
    if (!inode) {
      inode = { links: file.links, blocks: file.blocks, entries: new Set() }
      inodes.set(key, inode)
    }
    if (inode.links !== file.links || inode.blocks !== file.blocks)
      return null
    inode.entries.add(file.entry)
  }
  let bytes = 0
  for (const inode of inodes.values()) {
    if (inode.entries.size === inode.links)
      bytes += inode.blocks * 512
  }
  return Number.isSafeInteger(bytes) ? bytes : null
}

export function manifestFile(file: CleanupFile): MaintenanceManifestPath {
  const {
    entry: _entry,
    blocks: _blocks,
    links: _links,
    reflink: _reflink,
    ...manifest
  } = file
  return manifest
}
