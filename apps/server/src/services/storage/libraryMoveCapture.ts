import type { Stats } from 'node:fs'
import type {
  DirectorySnapshot,
  FileSnapshot,
  LibraryIntent,
} from './moveIntent.ts'
import {
  link,
  lstat,
  mkdir,
  readdir,
  realpath,
  rename,
  rmdir,
  stat,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import process from 'node:process'

export const LIBRARY_MOVE_FILE_LIMIT = 256

export function fileSnapshot(path: string, info: Stats): FileSnapshot {
  return {
    path,
    size: info.size,
    dev: info.dev,
    ino: info.ino,
    mtimeMs: info.mtimeMs,
  }
}

export function sameFileSnapshot(info: Stats | undefined, item: FileSnapshot) {
  return (
    info?.isFile()
    && info.dev === item.dev
    && info.ino === item.ino
    && info.size === item.size
    && info.mtimeMs === item.mtimeMs
  )
}

export async function lstatIfPresent(path: string) {
  return lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT')
      throw error
    return undefined
  })
}

export async function directorySnapshot(
  path: string,
): Promise<DirectorySnapshot> {
  const real = await realpath(path)
  const info = await stat(real)
  if (!info.isDirectory())
    throw new Error('Storage move directory is unavailable')
  return { path, real, dev: info.dev, ino: info.ino }
}

function sameDirectorySnapshot(a: DirectorySnapshot, b: DirectorySnapshot) {
  return a.real === b.real && a.dev === b.dev && a.ino === b.ino
}

export function within(parent: string, path: string) {
  const suffix = relative(parent, path)
  return (
    suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix)
  )
}

function stagePath(intent: LibraryIntent) {
  return join(intent.sourceParent.real, `.torsher-move-${intent.token}`)
}

function slotOf(intent: LibraryIntent, index: number) {
  return join(stagePath(intent), String(index))
}

function capturedSource(intent: LibraryIntent, file: FileSnapshot) {
  return join(intent.sourceParent.real, basename(file.path))
}

export class MoveCaptureConflict extends Error {}

async function checkRootAndParent(
  root: DirectorySnapshot,
  parent: DirectorySnapshot,
) {
  const [actualRoot, actualParent] = await Promise.all([
    directorySnapshot(root.path),
    directorySnapshot(parent.path),
  ])
  if (
    !sameDirectorySnapshot(root, actualRoot)
    || !sameDirectorySnapshot(parent, actualParent)
    || !within(root.real, parent.real)
  ) {
    throw new MoveCaptureConflict('Library move directory changed')
  }
}

async function checkMoveDirectories(intent: LibraryIntent) {
  await Promise.all([
    checkRootAndParent(intent.sourceRoot, intent.sourceParent),
    checkRootAndParent(intent.targetRoot, intent.targetParent),
  ])
  if (
    intent.sourceParent.dev === intent.targetParent.dev
    && intent.sourceParent.ino === intent.targetParent.ino
  ) {
    throw new MoveCaptureConflict(
      'Library move source and target share a directory',
    )
  }
}

async function checkStage(intent: LibraryIntent) {
  const path = stagePath(intent)
  const info = await lstatIfPresent(path)
  if (!info)
    return undefined
  if (
    !info.isDirectory()
    || (info.mode & 0o777) !== 0o700
    || (process.getuid && info.uid !== process.getuid())
    || info.dev !== intent.sourceParent.dev
  ) {
    throw new MoveCaptureConflict('Invalid library move staging directory')
  }

  const proof = { path, real: path, dev: info.dev, ino: info.ino }
  if (
    intent.stage
    && (intent.stage.path !== path || !sameDirectorySnapshot(intent.stage, proof))
  ) {
    throw new MoveCaptureConflict('Library move staging directory changed')
  }
  return proof
}

export async function createMoveStage(intent: LibraryIntent) {
  await checkMoveDirectories(intent)
  const path = stagePath(intent)
  try {
    await mkdir(path, { mode: 0o700 })
  }
  catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
      throw err
  }
  const stage = await checkStage(intent)
  if (!stage || (await readdir(path)).length)
    throw new MoveCaptureConflict('Library move staging directory is occupied')
  return stage
}

async function requireMoveTarget(intent: LibraryIntent, target: FileSnapshot) {
  const actual = await lstatIfPresent(
    join(intent.targetParent.real, basename(target.path)),
  )
  if (!sameFileSnapshot(actual, target))
    throw new MoveCaptureConflict('Library move target changed')
}

export async function requireMoveTargets(intent: LibraryIntent) {
  await checkMoveDirectories(intent)
  for (const { target } of intent.files)
    await requireMoveTarget(intent, target)
}

export async function captureLibraryFiles(intent: LibraryIntent) {
  await requireMoveTargets(intent)
  if (!intent.stage || !(await checkStage(intent)))
    throw new MoveCaptureConflict('Library move staging directory disappeared')

  for (const [index, { source }] of intent.files.entries()) {
    const publicPath = capturedSource(intent, source)
    const slot = slotOf(intent, index)
    let captured = await lstatIfPresent(slot)
    if (!captured) {
      if (!sameFileSnapshot(await lstatIfPresent(publicPath), source))
        throw new MoveCaptureConflict('Library move source changed')
      await rename(publicPath, slot)
      captured = await lstatIfPresent(slot)
    }
    if (
      !sameFileSnapshot(captured, source)
      || (await lstatIfPresent(publicPath))
    ) {
      throw new MoveCaptureConflict('Captured library move source changed')
    }
  }
  await requireMoveTargets(intent)
  for (const { source } of intent.files) {
    if (await lstatIfPresent(capturedSource(intent, source)))
      throw new MoveCaptureConflict('Library move source was recreated')
  }
}

export async function restoreCapturedLibraryFiles(intent: LibraryIntent) {
  await checkRootAndParent(intent.sourceRoot, intent.sourceParent)
  if (!intent.stage)
    return
  if (!(await checkStage(intent)))
    throw new MoveCaptureConflict('Library move staging directory disappeared')

  let conflict = false
  for (const [index, { source }] of intent.files.entries()) {
    const slot = slotOf(intent, index)
    const captured = await lstatIfPresent(slot)
    if (!captured)
      continue

    const publicPath = capturedSource(intent, source)
    if (!captured.isFile()) {
      conflict = true
      continue
    }
    const proof = fileSnapshot(slot, captured)
    try {
      await link(slot, publicPath)
    }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST')
        throw err
    }
    // Also handles a crash after restoring the entry but before slot cleanup.
    if (!sameFileSnapshot(await lstatIfPresent(publicPath), proof)) {
      conflict = true
      continue
    }
    await unlink(slot)
  }
  if (conflict)
    throw new MoveCaptureConflict('Captured library file cannot be restored')
}

export async function discardCapturedLibraryFiles(intent: LibraryIntent) {
  await requireMoveTargets(intent)
  if (!intent.stage || !(await checkStage(intent)))
    throw new MoveCaptureConflict('Library move staging directory disappeared')

  for (const [index, { source, target }] of intent.files.entries()) {
    const slot = slotOf(intent, index)
    const captured = await lstatIfPresent(slot)
    if (await lstatIfPresent(capturedSource(intent, source)))
      throw new MoveCaptureConflict('Library move source was recreated')
    if (!captured)
      continue
    if (!sameFileSnapshot(captured, source))
      throw new MoveCaptureConflict('Captured library file changed')
    await checkMoveDirectories(intent)
    await requireMoveTarget(intent, target)
    await unlink(slot)
  }
}

export async function removeMoveStage(intent: LibraryIntent) {
  if (intent.stage && (await checkStage(intent)))
    await rmdir(stagePath(intent))
}

export async function removeEmptyMoveParents(intent: LibraryIntent) {
  for (
    let path = intent.sourceParent.real;
    path !== intent.sourceRoot.real && within(intent.sourceRoot.real, path);
    path = dirname(path)
  ) {
    try {
      await rmdir(path)
    }
    catch {
      break
    }
  }
}
