import type { MediaFile } from '../../db/schema.ts'
import { stat } from 'node:fs/promises'
import process from 'node:process'
import { beforeAll, expect, it, vi } from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  profiles,
} from '../../db/schema.ts'
import { itemId, projectLibrary, selectItems } from './library.ts'

vi.mock('node:fs/promises', async original => ({
  ...(await original<typeof import('node:fs/promises')>()),
  stat: vi.fn(async () => ({ isFile: () => true })),
}))
beforeAll(async () => {
  await migrateDb()
})

it('counts beyond 10,000 entries and only stats the chosen item for playback', async () => {
  const db = getDb()
  const profile = db
    .insert(profiles)
    .values({ name: 'Scale test', color: 'violet' })
    .returning()
    .get()
  const library = db
    .insert(libraries)
    .values({ name: 'Synthetic videos', kind: 'home' })
    .returning()
    .get()
  const folder = db
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: '/synthetic' })
    .returning()
    .get()
  const count = 10_001
  const rows = Array.from({ length: count }, (_, index) => ({
    folderId: folder.id,
    relPath: `Video ${index}.mp4`,
    size: 1,
    mtime: new Date(),
  }))
  let target: MediaFile | undefined
  db.transaction(() => {
    for (const row of rows)
      target = db.insert(mediaFiles).values(row).returning().get()
  })
  vi.mocked(stat).mockClear()
  const started = performance.now()
  const projection = await projectLibrary(profile.id)
  const page = selectItems(projection, {
    recursive: true,
    includeitemtypes: 'Video',
    startindex: 10_000,
    limit: 10,
  })
  const browseMs = Math.round(performance.now() - started)
  expect(page.total).toBe(count)
  expect(page.items).toHaveLength(1)
  expect(stat).toHaveBeenCalledTimes(count)
  vi.mocked(stat).mockClear()
  const directStarted = performance.now()
  const direct = await projectLibrary(
    profile.id,
    itemId('Video', library.id, target!.id),
  )
  expect(stat).toHaveBeenCalledTimes(1)
  expect(
    [...direct.items.values()].filter(item => item.type === 'Video'),
  ).toHaveLength(1)
  process.stdout.write(
    `Synthetic 10001-row projection (mock stat): browse ${browseMs}ms, targeted ${Math.round(performance.now() - directStarted)}ms\n`,
  )
})
