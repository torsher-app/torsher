import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listBackupsIn } from './list.ts'
import { BACKUP_REASONS, formatBackupName } from './names.ts'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })),
  )
})

describe('critical fallback backups', () => {
  it('lists a critical copy once when the selected directory aliases the default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'torsher-backup-alias-'))
    dirs.push(root)
    const fallback = join(root, 'backups')
    const alias = join(root, 'selected')
    await mkdir(fallback)
    await symlink(fallback, alias, 'dir')
    const name = formatBackupName({
      createdAt: new Date(),
      reason: 'pre-import',
      version: '1.8.0',
      encrypted: false,
    })
    await writeFile(join(fallback, name), 'archive')
    const result = await listBackupsIn(alias, fallback)
    expect(result.available).toBe(true)
    expect(result.items.map(item => [item.name, item.dirKind])).toEqual([
      [name, 'main'],
    ])
  })
  it.each([true, false])(
    'discovers safety copies with main available=%s',
    async (available) => {
      const root = await mkdtemp(join(tmpdir(), 'torsher-backup-list-'))
      dirs.push(root)
      const main = join(root, 'custom')
      const fallback = join(root, 'backups')
      await mkdir(fallback)
      if (available)
        await mkdir(main)
      else await writeFile(main, 'owned unavailable directory marker')

      for (const [index, reason] of BACKUP_REASONS.entries()) {
        const name = formatBackupName({
          createdAt: new Date(2026, 0, index + 1),
          reason,
          version: '1.8.0',
          encrypted: true,
        })
        await writeFile(join(fallback, name), 'archive')
      }
      await writeFile(join(fallback, 'unrelated.txt'), 'not a backup')
      const result = await listBackupsIn(main, fallback)
      expect(result.available).toBe(available)
      expect(result.items.map(item => item.reason)).toEqual([
        'pre-import',
        'pre-restore',
        'pre-update',
      ])
      expect(
        result.items.every(
          item =>
            item.dirKind === 'fallback'
            && item.path === join(fallback, item.name),
        ),
      ).toBe(true)
    },
  )

  it('keeps all reasons in the selected directory without duplicates when it is the default', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'torsher-backup-list-'))
    dirs.push(dir)
    for (const reason of BACKUP_REASONS) {
      await writeFile(
        join(
          dir,
          formatBackupName({
            createdAt: new Date(),
            reason,
            version: '1.8.0',
            encrypted: false,
          }),
        ),
        'archive',
      )
    }
    const result = await listBackupsIn(dir, dir)
    expect(result.available).toBe(true)
    expect(result.items).toHaveLength(BACKUP_REASONS.length)
    expect(result.items.every(item => item.dirKind === 'main')).toBe(true)
  })
})
