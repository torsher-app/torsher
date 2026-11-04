import type { maintenanceFiles } from '../../db/schema.ts'
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export async function rootIdentity(path: string) {
  const absolute = resolve(path)
  try {
    const [canonical, info] = await Promise.all([
      realpath(absolute),
      lstat(absolute),
    ])
    if (
      canonical !== absolute
      || !info.isDirectory()
      || !Number.isSafeInteger(info.ino)
      || !Number.isSafeInteger(info.dev)
    ) {
      return undefined
    }
    return { rootDevice: String(info.dev), rootInode: info.ino }
  }
  catch {
    return undefined
  }
}

export async function ownedIdentity(root: string, path: string) {
  const base = resolve(root)
  const absolute = resolve(path)
  const rel = relative(base, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return undefined
  const identity = await rootIdentity(base)
  if (!identity)
    return undefined
  try {
    const [canonical, info] = await Promise.all([
      realpath(absolute),
      lstat(absolute),
    ])
    if (
      canonical !== absolute
      || !info.isFile()
      || !Number.isSafeInteger(info.ino)
      || !Number.isSafeInteger(info.dev)
      || !Number.isSafeInteger(info.size)
    ) {
      return undefined
    }
    return {
      root: base,
      path: absolute,
      ...identity,
      device: String(info.dev),
      inode: info.ino,
      size: info.size,
      mtime: info.mtimeMs,
    }
  }
  catch {
    return undefined
  }
}

/** ENOENT допустим только на том же доступном томе; symlink/offline не отсутствие. */
export async function verifyOwnedFile(
  file: typeof maintenanceFiles.$inferSelect,
) {
  const root = await rootIdentity(file.root)
  if (
    !root
    || root.rootDevice !== file.rootDevice
    || root.rootInode !== file.rootInode
  ) {
    return 'root_unavailable' as const
  }
  try {
    await lstat(file.path)
  }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Пропавший родитель проверяется отдельно: он мог быть заменён symlink.
      let parent = resolve(file.path, '..')
      while (parent !== file.root) {
        try {
          if ((await realpath(parent)) !== parent)
            return 'identity_changed' as const
          break
        }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            return 'root_unavailable' as const
        }
        const next = resolve(parent, '..')
        if (next === parent)
          return 'identity_changed' as const
        parent = next
      }
      return 'missing' as const
    }
    return 'root_unavailable' as const
  }
  const current = await ownedIdentity(file.root, file.path)
  if (
    !current
    || current.device !== file.device
    || current.inode !== file.inode
    || current.size !== file.size
    || current.mtime !== file.mtime
  ) {
    return 'identity_changed' as const
  }
  return 'present' as const
}
