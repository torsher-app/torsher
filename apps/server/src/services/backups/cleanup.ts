import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { parseBackupName } from './names.ts'

/**
 * Брошенные прерванной копией файлы: весь временный каталог снимков и
 * `<имя>.tmp` в каталогах копий. В список они не попадают, но занимают место.
 */
export async function cleanupBackupTemp(input: {
  tmpDir: string
  dirs: string[]
}) {
  await rm(input.tmpDir, { recursive: true, force: true }).catch(() => {})

  for (const dir of new Set(input.dirs)) {
    const names = await readdir(dir).catch(() => [] as string[])

    for (const name of names) {
      if (name.endsWith('.tmp') && parseBackupName(name.slice(0, -4)))
        await rm(join(dir, name), { force: true }).catch(() => {})
    }
  }
}
