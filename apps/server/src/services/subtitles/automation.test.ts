import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { expect, it, vi } from 'vitest'
import { config } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  libraries,
  libraryFolders,
  mediaFiles,
  subtitleJobs,
} from '../../db/schema.ts'
import { libraryProbeKey, persistedProbeKey } from '../library/playedSource.ts'
import { setNetTransport } from '../net/index.ts'
import { deleteSetting, setSetting } from '../settings/index.ts'
import { enqueueSubtitlesForNewFile, runSubtitleJobs } from './automation.ts'
import { clearOpenSubtitlesLogin } from './opensubtitles.ts'
import { SUBTITLE_SETTINGS_KEY, updateSubtitleConfig } from './settings.ts'

vi.mock('../media/subtitles.ts', async (original) => {
  const module = await original<typeof import('../media/subtitles.ts')>()
  return {
    ...module,
    convertSubtitle: async () => [{ start: 1, end: 3, text: 'Subtitle' }],
  }
})

it('reserves the last download, then resumes the queued new file and publishes only once', async () => {
  await migrateDb()
  const db = getDb()
  const directory = mkdtempSync(join(tmpdir(), 'torsher-subtitle-jobs-'))
  const dataDir = vi.spyOn(config, 'dataDir', 'get').mockReturnValue(directory)
  const relPath = 'Synthetic.Title.1080p.WEB-DL.mkv'
  const path = join(directory, relPath)
  const sidecar = join(directory, 'Synthetic.Title.1080p.WEB-DL.en.srt')
  const content = '1\n00:00:01,000 --> 00:00:03,000\nSubtitle\n'
  writeFileSync(path, 'fixture for an already probed library file')
  const info = statSync(path)
  const library = db
    .insert(libraries)
    .values({ name: 'Fixture', kind: 'video', managed: true })
    .returning()
    .get()
  const folder = db
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: directory })
    .returning()
    .get()
  const row = db
    .insert(mediaFiles)
    .values({
      folderId: folder.id,
      relPath,
      titleId: 'tmdb:movie:625',
      matchStatus: 'matched',
      inode: info.ino,
      size: info.size,
      mtime: info.mtime,
      probeKey: persistedProbeKey(info),
      probe: {
        container: 'mkv',
        duration: 30,
        audio: [],
        subtitles: [],
        video: null,
      },
    })
    .returning()
    .get()

  let remaining = 1
  let downloads = 0
  let searches = 0
  setNetTransport(async (address) => {
    const url = new URL(address)
    if (url.pathname === '/api/v1/login')
      return Response.json({ token: 'synthetic-token' })
    if (url.pathname === '/api/v1/infos/user')
      return Response.json({ data: { remaining_downloads: remaining } })
    if (url.pathname === '/api/v1/subtitles') {
      searches++
      expect(url.searchParams.get('tmdb_id')).toBe('625')
      return Response.json({
        data: [
          {
            attributes: {
              language: 'en',
              release: 'Synthetic.Title.1080p.WEB-DL',
              feature_details: { tmdb_id: 625 },
              files: [{ file_id: 39 }],
            },
          },
        ],
      })
    }
    if (url.pathname === '/api/v1/download') {
      downloads++
      return Response.json({
        link: 'https://www.opensubtitles.com/file.srt',
        remaining: --remaining,
      })
    }
    expect(url.hostname).toBe('www.opensubtitles.com')
    return new Response(content)
  })

  try {
    updateSubtitleConfig({
      openSubtitles: {
        apiKey: 'first-test-key',
        username: 'test-user',
        password: 'test-password',
        autoDownload: true,
        languages: ['en'],
      },
    })
    const revision = libraryProbeKey(row.id, info)
    enqueueSubtitlesForNewFile(row.id, revision)
    enqueueSubtitlesForNewFile(row.id, revision)
    const makeDue = () =>
      db
        .update(subtitleJobs)
        .set({ nextAt: new Date(0) })
        .where(eq(subtitleJobs.mediaFileId, row.id))
        .run()
    const jobs = () =>
      db
        .select()
        .from(subtitleJobs)
        .where(eq(subtitleJobs.mediaFileId, row.id))
        .all()
    makeDue()
    setSetting('maintenanceRestoreHold', true)
    try {
      await runSubtitleJobs()
      expect(jobs()).toMatchObject([
        { language: 'en', state: 'queued', attempts: 0 },
      ])
      expect(searches).toBe(0)
      expect(downloads).toBe(0)
    }
    finally {
      deleteSetting('maintenanceRestoreHold')
    }

    makeDue()
    await runSubtitleJobs()
    expect(jobs()).toMatchObject([
      { language: 'en', state: 'queued', attempts: 0 },
    ])
    expect(downloads).toBe(0)
    expect(existsSync(sidecar)).toBe(false)

    remaining = 5
    updateSubtitleConfig({ openSubtitles: { apiKey: 'second-test-key' } })
    makeDue()
    await runSubtitleJobs()
    await runSubtitleJobs()
    expect(jobs()).toMatchObject([
      { language: 'en', state: 'done', attempts: 0 },
    ])
    expect(downloads).toBe(1)
    expect(readFileSync(sidecar, 'utf8')).toBe(content)
  }
  finally {
    setNetTransport(null)
    clearOpenSubtitlesLogin()
    deleteSetting(SUBTITLE_SETTINGS_KEY)
    db.delete(libraries).where(eq(libraries.id, library.id)).run()
    dataDir.mockRestore()
    rmSync(directory, { recursive: true, force: true })
  }
})
