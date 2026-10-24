import type { BackupName } from './names.ts'
import { readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseBackupName } from './names.ts'

export interface BackupItem extends BackupName {
  size: number
  /** `fallback` — копия перед обновлением, упавшая в каталог по умолчанию */
  dirKind: 'main' | 'fallback'
  path: string
}

async function readDir(dir: string, dirKind: BackupItem['dirKind']) {
  const names = await readdir(dir)
  const items: BackupItem[] = []

  for (const name of names) {
    const parsed = parseBackupName(name)

    if (!parsed)
      continue

    const path = join(dir, name)
    const info = await stat(path).catch(() => undefined)

    if (info?.isFile())
      items.push({ ...parsed, size: info.size, dirKind, path })
  }

  return items
}

/**
 * Копии по именам файлов, новые сверху. Если каталог выбран в панели, к
 * нему добавляются копии перед обновлением из каталога по умолчанию: туда
 * они падают, когда выбранный каталог недоступен.
 */
export async function listBackupsIn(dir: string, defaultDir: string) {
  let items: BackupItem[] = []
  let available = true

  try {
    items = await readDir(dir, 'main')
  }
  catch {
    available = false
  }

  if (resolve(dir) !== resolve(defaultDir)) {
    const fallback = await readDir(defaultDir, 'fallback').catch(() => [])

    items.push(...fallback.filter(item => item.reason === 'pre-update'))
  }

  items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

  return { items, available }
}
