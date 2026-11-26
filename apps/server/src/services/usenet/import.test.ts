import type { UsenetClient } from './config.ts'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { eq } from 'drizzle-orm'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { libraryFolders, mediaFiles, usenetJobs } from '../../db/schema.ts'
import { managedFolder } from '../library/files.ts'
import { videoPath } from '../library/layout.ts'
import * as tmdb from '../tmdb/index.ts'
import { chooseUsenetVideo, importDeps, importUsenet } from './import.ts'
import { releaseUsenetJob } from './jobs.ts'
import { storageParts } from './paths.ts'
import { sabAttemptName } from './sab.ts'

it('maps only a storage path below the category and the current job directory', () => {
  expect(
    storageParts(
      '/completed/torsher',
      '/completed/torsher/demo/video.mkv',
      'demo',
    ),
  ).toEqual(['demo', 'video.mkv'])
  expect(
    storageParts('/completed/torsher', '/completed/torsher/demo', 'demo'),
  ).toEqual(['demo'])
  expect(() =>
    storageParts(
      '/completed/torsher',
      '/completed/torsher2/demo/video.mkv',
      'demo',
    ),
  ).toThrow('output_invalid')
  expect(() =>
    storageParts(
      '/completed/torsher',
      '/completed/torsher/demo/../neighbor/video.mkv',
      'demo',
    ),
  ).toThrow('output_invalid')
  expect(() =>
    storageParts(
      '/completed/torsher',
      '/completed/torsher/neighbor/video.mkv',
      'demo',
    ),
  ).toThrow('output_invalid')
})

it('selects the exact episode, discards samples and rejects ambiguous videos', () => {
  const job = {
    season: 2,
    episode: 3,
    releaseTitle: 'Synthetic Show S02E03 1080p DEMO',
  }
  const match = { path: 'Synthetic.Show.S02E03.mkv', size: 1024 }
  expect(
    chooseUsenetVideo(job, [match, { path: 'sample.mkv', size: 5 }]).path,
  ).toBe(match.path)
  expect(() =>
    chooseUsenetVideo(job, [{ ...match, path: 'Synthetic.Show.S02E04.mkv' }]),
  ).toThrow('output_invalid')
  expect(() =>
    chooseUsenetVideo(job, [match, { ...match, path: 'Another.S02E03.mp4' }]),
  ).toThrow('output_invalid')
})

describe.skipIf(process.platform !== 'linux')(
  'durable import on a pinned filesystem',
  () => {
    const metadata = {
      kind: 'movie' as const,
      tmdbId: 9000001,
      names: [
        { value: 'Synthetic Film', lang: 'en', kind: 'official' as const },
      ],
      year: 2026,
    }
    let root: string
    let inbox: string
    let library: string
    let client: UsenetClient

    beforeAll(async () => {
      await migrateDb()
    })

    beforeEach(async () => {
      const db = getDb()
      db.delete(usenetJobs).run()
      db.delete(mediaFiles).run()
      db.delete(libraryFolders).run()
      root = await mkdtemp(join(tmpdir(), 'torsher-nzb-'))
      inbox = join(root, 'inbox')
      library = join(root, 'library')
      await mkdir(inbox)
      vi.stubEnv('USENET_INBOX_PATH', inbox)
      vi.stubEnv('LIBRARY_PATH', library)
      client = {
        id: 'sabnzbd',
        generation: 'synthetic-client',
        url: 'https://sab.example',
        category: 'torsher',
        remoteRoot: '/completed/torsher',
        localRoot: inbox,
        lanAddresses: [],
        enabled: true,
        followEnabled: true,
        verified: true,
        encryptedApiKey: 'not-read-during-import',
      }
      vi.spyOn(tmdb, 'getTitleIdentity').mockResolvedValue(metadata)
      vi.spyOn(importDeps, 'queueProbe').mockResolvedValue(undefined)
    })

    afterEach(async () => {
      vi.restoreAllMocks()
      vi.unstubAllEnvs()
      await rm(root, { recursive: true, force: true })
    })

    async function localJob() {
      const id = randomUUID()
      const attempt = sabAttemptName(id)
      const path = join(inbox, attempt, 'Synthetic.Film.2026.mkv')
      await mkdir(dirname(path))
      const job = getDb()
        .insert(usenetJobs)
        .values({
          id,
          clientGeneration: client.generation,
          sourceId: 'synthetic-source',
          sourceRevision: 'synthetic-revision',
          releaseKey: 'synthetic-release',
          releaseTitle: 'Synthetic Film.2026.1080p.DEMO',
          titleId: 'tmdb:movie:9000001',
          origin: 'manual',
          state: 'importing',
          active: true,
          nzoId: id,
          storage: `${client.remoteRoot}/${attempt}/Synthetic.Film.2026.mkv`,
        })
        .returning()
        .get()
      return { job, path }
    }

    it('publishes an independent copy of a single completed file', async () => {
      const { job, path } = await localJob()
      await writeFile(path, 'synthetic-video')
      await importUsenet(job, client, () => {})
      const file = getDb().select().from(mediaFiles).get()!
      const stored = join(library, file.relPath)

      expect(file).toMatchObject({
        titleId: job.titleId,
        torrentId: null,
        linkMode: 'copy',
      })
      expect((await stat(stored)).ino).not.toBe((await stat(path)).ino)
      await rm(path)
      expect(await readFile(stored, 'utf8')).toBe('synthetic-video')
      expect(getDb().select().from(usenetJobs).get()).toMatchObject({
        state: 'imported',
        active: false,
        mediaFileId: file.id,
      })
    })

    it('recovers a recorded published inode even if the original output is gone', async () => {
      const { job } = await localJob()
      const folder = managedFolder()
      const relPath = videoPath(
        {
          kind: 'movie',
          name: 'Synthetic Film',
          tmdbId: metadata.tmdbId,
          year: 2026,
        },
        'mkv',
      )
      const published = join(library, relPath)
      await mkdir(dirname(published), { recursive: true })
      await writeFile(published, 'synthetic-video')
      const info = await stat(published, { bigint: true })
      const receipt = JSON.stringify({
        folderId: folder.id,
        folderPath: folder.path,
        relPath,
        identity: {
          device: info.dev.toString(),
          inode: info.ino.toString(),
          modified: info.mtimeNs.toString(),
          size: Number(info.size),
        },
      })
      getDb()
        .update(usenetJobs)
        .set({ receipt })
        .where(eq(usenetJobs.id, job.id))
        .run()
      await importUsenet({ ...job, receipt }, client, () => {})
      expect(getDb().select().from(mediaFiles).all()).toHaveLength(1)
    })

    it('cleans the staging link before registering and can then resume from the final file', async () => {
      const { job, path } = await localJob()
      const relPath = videoPath(
        {
          kind: 'movie',
          name: 'Synthetic Film',
          tmdbId: metadata.tmdbId,
          year: 2026,
        },
        'mkv',
      )
      const published = join(library, relPath)
      const temporary = join(
        dirname(published),
        `.torsher-usenet-${job.id}.torsher-tmp`,
      )
      await writeFile(path, 'synthetic-video')

      await expect(
        importUsenet(job, client, () => {
          if (existsSync(published))
            throw new Error('Interrupted before registration')
        }),
      ).rejects.toThrow('Interrupted before registration')
      await expect(stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' })
      expect((await stat(published)).nlink).toBe(1)
      expect(getDb().select().from(mediaFiles).all()).toHaveLength(0)

      await rm(path)
      const interrupted = getDb()
        .select()
        .from(usenetJobs)
        .where(eq(usenetJobs.id, job.id))
        .get()!
      await importUsenet(interrupted, client, () => {})
      expect(getDb().select().from(usenetJobs).get()).toMatchObject({
        state: 'imported',
        active: false,
      })
    })

    it('releases an unpublished receipt and cleans only its staged inode', async () => {
      const { job } = await localJob()
      const folder = managedFolder()
      const relPath = videoPath(
        {
          kind: 'movie',
          name: 'Synthetic Film',
          tmdbId: metadata.tmdbId,
          year: 2026,
        },
        'mkv',
      )
      const final = join(library, relPath)
      const temporary = join(
        dirname(final),
        `.torsher-usenet-${job.id}.torsher-tmp`,
      )
      await mkdir(dirname(final), { recursive: true })
      await writeFile(temporary, 'prepared bytes')
      const info = await stat(temporary, { bigint: true })
      const receipt = JSON.stringify({
        folderId: folder.id,
        folderPath: folder.path,
        relPath,
        identity: {
          device: info.dev.toString(),
          inode: info.ino.toString(),
          modified: info.mtimeNs.toString(),
          size: Number(info.size),
        },
      })
      getDb()
        .update(usenetJobs)
        .set({ state: 'attention', receipt })
        .where(eq(usenetJobs.id, job.id))
        .run()

      await link(temporary, final)
      await expect(releaseUsenetJob(job.id)).rejects.toThrow('review_required')
      await rm(final)
      await writeFile(final, 'an unrelated file')
      await expect(releaseUsenetJob(job.id)).resolves.toMatchObject({
        state: 'released',
      })
      await expect(stat(temporary)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(final, 'utf8')).toBe('an unrelated file')
    })

    it('reuses the ID of a missing Usenet file only at its verified empty path', async () => {
      const prior = await localJob()
      await writeFile(prior.path, 'initial-video')
      await importUsenet(prior.job, client, () => {})
      const file = getDb().select().from(mediaFiles).get()!
      const known = join(library, file.relPath)
      await rm(known)
      getDb()
        .update(mediaFiles)
        .set({ state: 'missing', missingSince: new Date() })
        .where(eq(mediaFiles.id, file.id))
        .run()

      const current = await localJob()
      await writeFile(current.path, 'new synthetic video')
      await importUsenet(current.job, client, () => {})
      expect(getDb().select().from(mediaFiles).all()).toMatchObject([
        { id: file.id, state: 'present', missingSince: null },
      ])
      expect(await readFile(known, 'utf8')).toBe('new synthetic video')
    })

    it('rejects a symlink in completed output', async () => {
      const { job, path } = await localJob()
      const outside = join(root, 'outside.mkv')
      await writeFile(outside, 'synthetic-video')
      await symlink(outside, path)

      await expect(importUsenet(job, client, () => {})).rejects.toThrow(
        'output_invalid',
      )
      expect(getDb().select().from(mediaFiles).all()).toEqual([])
    })
  },
)
