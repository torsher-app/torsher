import type { FileHandle } from 'node:fs/promises'
import { constants } from 'node:fs'
import { access, mkdir, open, realpath } from 'node:fs/promises'
import { posix } from 'node:path'
import process from 'node:process'
import { UsenetError } from './errors.ts'

export function absolutePosixPath(value: string) {
  if (
    !value.startsWith('/')
    || value.includes('\\')
    || value.includes('\0')
    || value.split('/').some(part => part === '..' || part === '.')
  ) {
    throw new UsenetError('path_unreadable')
  }
  const path = posix.normalize(value).replace(/\/$/, '')
  if (!path)
    throw new UsenetError('path_unreadable')
  return path
}

export function insidePath(root: string, path: string) {
  return path.startsWith(`${root}/`)
}

export function storageParts(
  remoteRoot: string,
  storage: string,
  attemptName: string,
) {
  let path: string
  try {
    path = absolutePosixPath(storage)
  }
  catch {
    throw new UsenetError('output_invalid')
  }
  if (!insidePath(remoteRoot, path))
    throw new UsenetError('output_invalid')
  const parts = path.slice(remoteRoot.length + 1).split('/')
  if (parts[0] !== attemptName)
    throw new UsenetError('output_invalid')
  return parts
}

export function fdPath(file: FileHandle) {
  return `/proc/self/fd/${file.fd}`
}

const DIRECTORY_FLAGS
  = constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_RDONLY

export async function openDirectoryChild(parent: FileHandle, name: string) {
  return open(`${fdPath(parent)}/${name}`, DIRECTORY_FLAGS)
}

/**
 * Node does not expose openat(). Under Linux, /proc/self/fd anchors each
 * component to the directory just opened. O_NOFOLLOW applies to every step.
 */
export async function withPinnedDirectory<T>(
  path: string,
  create: boolean,
  run: (directory: FileHandle) => Promise<T>,
): Promise<T> {
  if (process.platform !== 'linux')
    throw new UsenetError('path_unreadable')

  const normalized = absolutePosixPath(path)
  let directory = await open('/', DIRECTORY_FLAGS)
  try {
    for (const name of normalized.slice(1).split('/')) {
      const child = `${fdPath(directory)}/${name}`
      if (create) {
        await mkdir(child).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST')
            throw error
        })
      }
      const next = await open(child, DIRECTORY_FLAGS)
      await directory.close()
      directory = next
    }
    await assertPinnedPath(directory, normalized)
    return await run(directory)
  }
  finally {
    await directory.close()
  }
}

export async function assertPinnedPath(file: FileHandle, expected: string) {
  if ((await realpath(fdPath(file))) !== expected)
    throw new UsenetError('path_unreadable')
}

export async function canReadPinnedDirectory(path: string) {
  try {
    await withPinnedDirectory(path, false, directory =>
      access(fdPath(directory), constants.R_OK | constants.X_OK))
    return true
  }
  catch {
    return false
  }
}
