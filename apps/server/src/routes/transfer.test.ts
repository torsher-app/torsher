import { Buffer } from 'node:buffer'
import type { Stats } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { and, eq } from 'drizzle-orm'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../app.ts'
import { ACCESS_TOKEN_COOKIE, PROFILE_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  collectionHiddenProfiles,
  collections,
  collectionTitles,
  cyclePlaybackFacts,
  cycleProgress,
  devices,
  diaryEntries,
  diarySeen,
  indexerManagers,
  indexers,
  libraries,
  libraryFolders,
  mediaFiles,
  mineProfilePreferences,
  mineTitlePreferences,
  netRoutes,
  profiles,
  profileTitles,
  rewatchCycles,
  serverSettings,
  titleAliases,
  titleProgress,
  titleVoices,
  users,
} from '../db/schema.ts'
import { decryptSecret, encryptSecret } from '../services/secrets/index.ts'
import { persistedProbeKey } from '../services/library/playedSource.ts'
import { applyScan } from '../services/library/scan.ts'
import { parseProbe } from '../services/media/probe.ts'
import {
  getTitleProgress,
  launchSelectionOf,
  markWatched,
  rememberStartedSource,
  rememberVoice,
} from '../services/sources/progress.ts'
import { deleteProfile } from '../services/profiles/index.ts'
import {
  diaryTimeZone,
  ensureDiaryTimeZone,
} from '../services/transfer/diaryTimeZone.ts'
import { resumeTarget } from '../services/sources/resume.ts'
import { resetImportJobs } from '../services/transfer/imports.ts'
import { applyPendingDecisions } from '../services/transfer/libraryMatches.ts'
import {
  resetServerImports,
  serverImportDeps,
} from '../services/transfer/serverImport.ts'
import { signToken } from '../utils/token.ts'
import { readExportText } from './transfer.ts'
import { parseExportDocument } from '../services/transfer/document.ts'
import {
  encryptWithPassword,
  passwordKeyOf,
} from '../services/transfer/passwords.ts'

const app = createApp()
const fsControl = vi.hoisted(() => ({
  beforeStat: undefined as ((path: string) => Promise<void> | void) | undefined,
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    stat: async (...args: Parameters<typeof actual.stat>) => {
      await fsControl.beforeStat?.(String(args[0]))
      return actual.stat(...args)
    },
  }
})

function authed() {
  return { [ACCESS_TOKEN_COOKIE]: signToken('user-1', 'user_access') }
}

const ANNA = 'profile-anna'
const DAD = 'profile-dad'
// Синтетические каталожные ID
const MOVIE = 'tmdb:movie:9101'
const SHOW = 'tmdb:tv:9102'
const OTHER = 'tmdb:movie:9103'

function at(day: number) {
  return new Date(Date.UTC(2026, 0, day))
}

function clearViewerData() {
  const db = getDb()

  for (const table of [
    titleProgress,
    profileTitles,
    collectionTitles,
    collectionHiddenProfiles,
    collections,
    titleVoices,
    titleAliases,
    indexers,
    indexerManagers,
    netRoutes,
    devices,
    mediaFiles,
    libraryFolders,
    libraries,
    profiles,
  ]) {
    db.delete(table).run()
  }
  db.delete(serverSettings)
    .where(eq(serverSettings.key, 'mine.diaryTimeZone'))
    .run()
}

function seed() {
  const db = getDb()

  db.insert(profiles)
    .values([
      {
        id: ANNA,
        name: 'Аня',
        color: 'rose',
        pinHash: 'argon2-hash-of-pin',
        ageLimit: 12,
        position: 0,
      },
      { id: DAD, name: 'Папа', color: 'blue', position: 1 },
    ])
    .run()
  db.insert(titleProgress)
    .values([
      {
        profileId: ANNA,
        titleId: MOVIE,
        season: 0,
        episode: 0,
        position: 1200,
        duration: 5400,
        updatedAt: at(5),
      },
      {
        profileId: ANNA,
        titleId: SHOW,
        season: 1,
        episode: 2,
        position: 300,
        duration: 2400,
        voiceStudio: 'Студия',
        updatedAt: at(6),
      },
    ])
    .run()
  db.insert(profileTitles)
    .values([
      {
        profileId: ANNA,
        titleId: MOVIE,
        rating: 9,
        ratedAt: at(7),
        favoriteAt: at(7),
      },
      { profileId: DAD, titleId: OTHER, watchlistAt: at(8) },
    ])
    .run()
  db.insert(collections)
    .values({ id: 'c1', name: 'Новогоднее', nameKey: 'новогоднее' })
    .run()
  db.insert(collectionTitles)
    .values({
      collectionId: 'c1',
      titleId: MOVIE,
      addedAt: at(9),
      addedByProfileId: DAD,
    })
    .run()
  db.insert(collectionHiddenProfiles)
    .values({ collectionId: 'c1', profileId: ANNA })
    .run()
  db.insert(titleVoices)
    .values({ titleId: SHOW, season: 1, studio: 'Студия', updatedAt: at(6) })
    .run()
  db.insert(titleAliases)
    .values({
      titleId: SHOW,
      value: 'Тихая палата',
      normalized: 'тихая палата',
      kind: 'user',
      syncedAt: at(6),
    })
    .run()
  db.insert(indexers)
    .values({
      name: 'Indexer',
      url: 'http://indexer.example/torznab',
      apiKey: encryptSecret('indexer-secret-value'),
      sessionCookie: encryptSecret('sid=transfer-cookie-secret'),
      isPrivate: true,
      allowAutomation: false,
      minSeedRatio: 1.5,
      minSeedTimeMinutes: 120,
      seedCriteriaMode: 'or',
      policyCustomized: true,
    })
    .run()
  db.insert(devices)
    .values({ name: 'TV', type: 'tv', tokenHash: 'device-token-hash' })
    .run()
}

async function exportServer(payload: Record<string, unknown> = {}) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transfer/export',
    cookies: authed(),
    payload: {
      scope: 'server',
      include: { collections: true, libraries: true, settings: true },
      ...payload,
    },
  })

  expect(res.statusCode).toBe(200)

  return res.body
}

async function preview(body: string | Buffer, password?: string) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/transfer/import/preview',
    cookies: authed(),
    payload: { data: Buffer.from(body).toString('base64'), password },
  })

  return res
}

async function importServer(
  body: string,
  options: { password?: string, mapping?: Record<string, string> } = {},
) {
  const res = await preview(body, options.password)

  expect(res.statusCode).toBe(200)

  const shown = res.json()
  const mapping = Object.fromEntries(
    shown.profiles.map(
      (profile: { key: string, target: { kind: string, id?: string } }) => [
        profile.key,
        profile.target.kind === 'existing' ? profile.target.id : 'new',
      ],
    ),
  )
  const applied = await app.inject({
    method: 'POST',
    url: '/api/transfer/import/apply',
    cookies: authed(),
    payload: {
      token: shown.token,
      mapping: { ...mapping, ...options.mapping },
      conflicts: 'newer',
    },
  })

  expect(applied.statusCode).toBe(200)

  return { preview: shown, result: applied.json() }
}

function profileByName(name: string) {
  return getDb()
    .select()
    .from(profiles)
    .all()
    .find(row => row.name === name)!
}

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({
      id: 'user-1',
      username: 'Owner',
      passwordHash: 'hash',
    })
    .run()
})

beforeEach(() => {
  clearViewerData()
  seed()
  resetServerImports()
  resetImportJobs()
  vi.spyOn(serverImportDeps, 'backup').mockResolvedValue('pre-import-copy')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('export', () => {
  it('writes viewer data by catalog IDs without server secrets and IDs', async () => {
    const body = await exportServer()
    const document = JSON.parse(body)

    expect(document).toMatchObject({
      format: 'torsher-export',
      version: 2,
      scope: 'server',
    })
    expect(document.profiles.map((row: { name: string }) => row.name)).toEqual([
      'Аня',
      'Папа',
    ])
    expect(document.progress).toHaveLength(2)
    expect(document.mine).toHaveLength(2)
    expect(document.collections[0]).toMatchObject({
      name: 'Новогоднее',
      hiddenFrom: ['p1'],
      titles: [{ title: MOVIE, addedBy: 'p2' }],
    })
    expect(document.voices).toHaveLength(1)
    expect(document.aliases).toEqual([
      { title: SHOW, value: 'Тихая палата', lang: null },
    ])
    // Ни хеша PIN, ни внутренних ID, ни шифртекста ключа сервера
    expect(body).not.toContain('argon2-hash-of-pin')
    expect(body).not.toContain(ANNA)
    expect(body).not.toContain('device-token-hash')
    expect(body).not.toContain('"v1:')
    expect(body).not.toContain('torrentId')
    // Без пароля секретов нет совсем
    expect(document.encryption).toBeUndefined()
    expect(document.settings.indexers[0].apiKey).toBeNull()
    expect(document.settings.indexers[0].sessionCookie).toBeNull()
    expect(body).not.toContain('transfer-cookie-secret')
  })

  it.each([
    {
      scope: 'server',
      includeLibraries: false,
      managed: false,
      expectedNative: false,
    },
    {
      scope: 'server',
      includeLibraries: true,
      managed: false,
      expectedNative: true,
    },
    {
      scope: 'server',
      includeLibraries: true,
      managed: true,
      expectedNative: false,
    },
    {
      scope: 'profile',
      includeLibraries: true,
      managed: false,
      expectedNative: false,
    },
  ])(
    'exports native positions only with connected server libraries: $scope / $includeLibraries / managed=$managed',
    async ({ scope, includeLibraries, managed, expectedNative }) => {
      const db = getDb()
      db.insert(libraries)
        .values({ id: 'home-lib', kind: 'video', name: 'Home videos', managed })
        .run()
      db.insert(libraryFolders)
        .values({
          id: 'home-folder',
          libraryId: 'home-lib',
          path: '/home/videos',
        })
        .run()
      db.insert(mediaFiles)
        .values({
          id: 'home-file',
          folderId: 'home-folder',
          relPath: 'trip.mp4',
          size: 1,
          mtime: at(1),
        })
        .run()
      db.insert(titleProgress)
        .values({
          profileId: ANNA,
          titleId: 'file:home-file',
          season: 0,
          episode: 0,
          position: 42,
          duration: 120,
          updatedAt: at(6),
        })
        .run()
      const original = db.select().from(titleProgress).all()

      const res = await app.inject({
        method: 'POST',
        url: '/api/transfer/export',
        cookies: authed(),
        payload: {
          scope,
          profileId: scope === 'profile' ? ANNA : undefined,
          include: { libraries: includeLibraries },
        },
      })
      expect(res.statusCode).toBe(200)
      const document = res.json()
      expect(
        document.progress.filter((row: { title?: string }) => row.title),
      ).toEqual([
        expect.objectContaining({ title: MOVIE, position: 1200 }),
        expect.objectContaining({ title: SHOW, position: 300 }),
      ])
      expect(
        document.progress.filter((row: { file?: unknown }) => row.file),
      ).toEqual(
        expectedNative
          ? [
              expect.objectContaining({
                file: { folder: '/home/videos', path: 'trip.mp4' },
                position: 42,
              }),
            ]
          : [],
      )
      expect(document.libraries !== undefined).toBe(
        scope === 'server' && includeLibraries,
      )
      expect(db.select().from(titleProgress).all()).toEqual(original)
    },
  )

  it('encrypts secrets with the export password only', async () => {
    const body = await exportServer({ password: 'export-password-1' })
    const document = JSON.parse(body)

    expect(body).not.toContain('indexer-secret-value')
    expect(document.encryption.kdf).toBe('scrypt')
    expect(document.settings.indexers[0].apiKey).toMatch(/^p1:/)
    expect(document.settings.indexers[0].sessionCookie).toMatch(/^p1:/)
    expect(body).not.toContain('transfer-cookie-secret')
  })

  it('exports one profile without server sections', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfer/export',
      cookies: authed(),
      payload: { scope: 'profile', profileId: DAD },
    })
    const document = res.json()

    expect(document.scope).toBe('profile')
    expect(document.profiles).toHaveLength(1)
    expect(document.mine).toEqual([
      expect.objectContaining({ title: OTHER, profile: 'p1' }),
    ])
    expect(document.collections).toBeUndefined()
    expect(document.settings).toBeUndefined()
  })
})

describe('server import', () => {
  it('restores data on an empty server and creates profiles', async () => {
    const body = await exportServer({ password: 'export-password-1' })

    clearViewerData()

    const { preview: shown, result } = await importServer(body, {
      password: 'export-password-1',
    })

    expect(shown.secrets).toBe('ok')
    expect(
      shown.profiles.map(
        (row: { target: { kind: string } }) => row.target.kind,
      ),
    ).toEqual(['new', 'new'])
    expect(result).toMatchObject({
      backup: 'pre-import-copy',
      profiles: { created: 2, merged: 0 },
    })

    const anna = profileByName('Аня')

    expect(anna.pinHash).toBeNull()
    expect(anna.ageLimit).toBe(12)

    const progress = getDb()
      .select()
      .from(titleProgress)
      .where(eq(titleProgress.profileId, anna.id))
      .all()

    expect(progress).toHaveLength(2)
    // Время позиции — время просмотра, а не импорта
    expect(progress.find(row => row.titleId === SHOW)!.updatedAt).toEqual(
      at(6),
    )

    const collection = getDb().select().from(collections).get()!

    expect(getDb().select().from(collectionHiddenProfiles).all()).toEqual([
      { collectionId: collection.id, profileId: anna.id },
    ])

    const indexer = getDb().select().from(indexers).get()!

    expect(indexer).toMatchObject({
      isPrivate: true,
      allowAutomation: false,
      minSeedRatio: 1.5,
      minSeedTimeMinutes: 120,
      seedCriteriaMode: 'or',
      policyCustomized: true,
    })
    expect(decryptSecret(indexer.apiKey!)).toBe('indexer-secret-value')
    expect(decryptSecret(indexer.sessionCookie!)).toBe(
      'sid=transfer-cookie-secret',
    )
  })

  it('merges into existing profiles by name and changes nothing on repeat', async () => {
    const body = await exportServer()

    // На этом сервере серию досмотрели позже, чем на прежнем
    getDb()
      .update(titleProgress)
      .set({ position: 2000, updatedAt: at(20) })
      .where(eq(titleProgress.titleId, SHOW))
      .run()
    getDb().delete(profileTitles).where(eq(profileTitles.profileId, DAD)).run()

    const first = await importServer(body)

    expect(
      first.preview.profiles.map(
        (row: { target: { kind: string } }) => row.target.kind,
      ),
    ).toEqual(['existing', 'existing'])
    expect(first.result.profiles).toMatchObject({ created: 0, merged: 2 })
    expect(
      getDb()
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.titleId, SHOW))
        .get()!.position,
    ).toBe(2000)
    expect(
      getDb()
        .select()
        .from(profileTitles)
        .where(eq(profileTitles.profileId, DAD))
        .get()!.watchlistAt,
    ).toEqual(at(8))

    const second = await importServer(body)

    expect(second.result.profiles.changed).toBe(0)
    expect(getDb().select().from(collections).all()).toHaveLength(1)
    expect(getDb().select().from(indexers).all()).toHaveLength(1)
  })

  it('imports without secrets when the password is missing', async () => {
    const body = await exportServer({ password: 'export-password-1' })

    getDb().delete(indexers).run()

    const { preview: shown } = await importServer(body)

    expect(shown.secrets).toBe('locked')
    expect(getDb().select().from(indexers).get()!.apiKey).toBeNull()
  })

  it('skips profiles the owner chose to skip', async () => {
    const body = await exportServer()

    clearViewerData()
    await importServer(body, { mapping: { p2: 'skip' } })

    expect(
      getDb()
        .select()
        .from(profiles)
        .all()
        .map(row => row.name),
    ).toEqual(['Аня'])
  })

  it('accepts gzip and rejects files that are not exports', async () => {
    const body = await exportServer()

    expect((await preview(gzipSync(body))).statusCode).toBe(200)

    const wrong = await preview('{"hello": "world"}')

    expect(wrong.statusCode).toBe(400)
    expect(wrong.json().kind).toBe('notExport')

    const newer = await preview(
      JSON.stringify({ ...JSON.parse(body), version: 99 }),
    )

    expect(newer.json().kind).toBe('newerVersion')

    const packed = gzipSync(body)
    const truncated = await preview(packed.subarray(0, packed.length >> 1))

    expect(truncated.statusCode).toBe(400)
    expect(truncated.json().kind).toBe('broken')
  })

  it('rejects a gzip that inflates past the limit', async () => {
    const bomb = gzipSync(Buffer.alloc(1024 * 1024)).toString('base64')

    await expect(readExportText(bomb, 64 * 1024)).rejects.toMatchObject({
      name: 'DocumentError',
      kind: 'broken',
    })

    const small = gzipSync('{"ok":true}').toString('base64')

    await expect(readExportText(small, 64 * 1024)).resolves.toBe('{"ok":true}')
  })

  it('does not start without the pre-import backup', async () => {
    const body = await exportServer()
    const { BackupError } = await import('../services/backups/index.ts')

    vi.spyOn(serverImportDeps, 'backup').mockRejectedValue(
      new BackupError('no_space'),
    )

    const shown = (await preview(body)).json()
    const res = await app.inject({
      method: 'POST',
      url: '/api/transfer/import/apply',
      cookies: authed(),
      payload: { token: shown.token, mapping: {}, conflicts: 'newer' },
    })

    expect(res.statusCode).toBe(422)
    expect(res.json().kind).toBe('no_space')
  })
})

describe('profile import', () => {
  async function profileExport(id: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/api/transfer/export',
        cookies: authed(),
        payload: { scope: 'profile', profileId: id },
      })
    ).body
  }

  function upload(id: string, body: string) {
    return app.inject({
      method: 'POST',
      url: `/api/profiles/${id}/imports`,
      cookies: authed(),
      payload: {
        files: [
          {
            name: 'torsher-export-2026-01-10.json',
            data: Buffer.from(body).toString('base64'),
          },
        ],
      },
    })
  }

  const FIRST = 'ebc39ec1-f1c6-4511-8d96-1af3ab9d3eec'
  const SECOND = '01f82536-8a2b-4789-ad62-4c771d2a917c'
  const UNKNOWN = '88455bc2-89d9-44e0-87ae-968fc38a9c4c'
  const INSTANT = '73f3bc9e-eacf-452c-8f41-070b5de66ce0'
  const CYCLE = 'e923947b-888f-4ab9-b330-ffa2bf80cfe6'
  const ACTIVE = '18cc17fd-593d-4c7a-ba77-ccc70c7dc875'

  function seedPersonalSpace(profileId: string) {
    const db = getDb()
    const exact = { profileId, titleId: SHOW, season: 0, episode: 1 }
    const mark = { profileId, titleId: OTHER, season: 0, episode: 0 }
    const dates = { createdAt: at(5), updatedAt: at(6) }
    db.insert(rewatchCycles)
      .values({
        ...dates,
        profileId,
        id: CYCLE,
        titleId: SHOW,
        startSeason: 0,
        startEpisode: 1,
        targetSeason: 2,
        targetEpisode: 3,
        state: 'paused',
      })
      .run()
    db.insert(diaryEntries)
      .values([
        {
          ...exact,
          ...dates,
          id: FIRST,
          precision: 'day',
          day: '2024-02-29',
          origin: 'trakt',
          originKey: '9007199254740997',
          note: 'First note',
          viewingContext: 'Balcony with Sam',
        },
        {
          ...exact,
          ...dates,
          id: SECOND,
          precision: 'day',
          day: '2024-02-29',
          origin: 'trakt',
          originKey: '9007199254740998',
          rewatch: true,
        },
        {
          ...mark,
          ...dates,
          id: UNKNOWN,
          precision: 'unknown',
          origin: 'manual',
        },
        {
          ...exact,
          ...dates,
          id: INSTANT,
          precision: 'instant',
          instant: at(5),
          origin: 'playback',
          context: { kind: 'cycle', cycleId: CYCLE },
        },
      ])
      .run()
    db.insert(diarySeen)
      .values([
        exact,
        mark,
        { profileId, titleId: SHOW, season: 0, episode: 0 },
      ])
      .run()
    db.insert(cycleProgress)
      .values([
        {
          profileId,
          cycleId: CYCLE,
          season: 0,
          episode: 1,
          position: 5,
          duration: 300,
          source: {
            kind: 'library',
            folder: '/test/source',
            path: 'special.mkv',
          },
          voiceStudio: 'Original',
          voiceType: 'MVO',
          completedAt: at(4),
          updatedAt: at(3),
        },
        {
          profileId,
          cycleId: CYCLE,
          season: 2,
          episode: 3,
          position: 125,
          source: { kind: 'torrent', infoHash: 'b'.repeat(40), fileIndex: 7 },
          updatedAt: at(6),
        },
      ])
      .run()
    db.insert(cyclePlaybackFacts)
      .values({
        ...exact,
        watchedAt: at(1),
        lastPlayedAt: at(2),
        updatedAt: at(2),
      })
      .run()
    db.insert(mineTitlePreferences)
      .values({
        profileId,
        titleId: SHOW,
        note: 'Title note',
        continuation: 'hidden',
        notInterested: true,
        updatedAt: at(6),
      })
      .run()
    db.insert(mineProfilePreferences)
      .values({
        profileId,
        startSection: 'overview',
        updatedAt: at(6),
      })
      .run()
  }

  async function applyProfileFile(id: string, body: string) {
    const opened = await upload(id, body)
    expect(opened.statusCode).toBe(202)
    const job = opened.json()
    const applied = await app.inject({
      method: 'POST',
      url: `/api/profiles/${id}/imports/${job.id}/apply`,
      cookies: authed(),
      payload: { conflicts: 'newer' },
    })
    expect(applied.statusCode).toBe(200)
    return { preview: job.preview, ...applied.json() }
  }

  function undoBatch(profileId: string, id: string) {
    return app.inject({
      method: 'POST',
      url: `/api/profiles/${profileId}/imports/${id}/undo`,
      cookies: authed(),
    })
  }

  it('keeps native personal row counts separate from unique changed and unchanged titles', async () => {
    seedPersonalSpace(ANNA)
    const document = JSON.parse(await profileExport(ANNA))
    document.progress = []
    document.mine = []
    const body = JSON.stringify(document)
    const first = await applyProfileFile(DAD, body)
    expect(first).toMatchObject({
      imported: 2,
      unchanged: 0,
      unmatched: 0,
      personal: { changed: 13, unchanged: 0, skipped: 0 },
    })
    const repeated = await applyProfileFile(DAD, body)
    expect(repeated).toMatchObject({
      imported: 0,
      unchanged: 2,
      unmatched: 0,
      personal: { changed: 0, unchanged: 13, skipped: 0 },
    })
    const overview = await app.inject({
      url: `/api/profiles/${DAD}/imports`,
      cookies: authed(),
    })
    expect(overview.json().last.summary).toMatchObject({
      imported: 0,
      unchanged: 2,
      unmatched: 0,
      personal: { changed: 0, unchanged: 13, skipped: 0 },
    })
  })

  it('reports a native source conflict as skipped without promising manual matching', async () => {
    seedPersonalSpace(ANNA)
    const document = JSON.parse(await profileExport(ANNA))
    const event = document.personalSpace.diary.find(
      (row: { id: string }) => row.id === FIRST,
    )
    document.progress = []
    document.mine = []
    for (const key of Object.keys(document.personalSpace)) {
      if (key !== 'timeZone')
        document.personalSpace[key] = key === 'diary' ? [event] : []
    }
    getDb()
      .insert(diaryEntries)
      .values({
        profileId: DAD,
        titleId: OTHER,
        id: FIRST,
        season: 0,
        episode: 0,
        precision: 'day',
        day: '2024-02-29',
        origin: 'trakt',
        originKey: '9007199254740997',
        createdAt: at(5),
        updatedAt: at(6),
      })
      .run()
    expect(await applyProfileFile(DAD, JSON.stringify(document))).toMatchObject(
      {
        imported: 0,
        unchanged: 0,
        unmatched: 0,
        skipped: 1,
        personal: { changed: 0, unchanged: 0, skipped: 1 },
      },
    )
    const pending = await app.inject({
      url: `/api/profiles/${DAD}/imports/unmatched`,
      cookies: authed(),
    })
    expect(pending.statusCode).toBe(200)
    expect(pending.json()).toMatchObject({ total: 0, items: [] })
  })

  it('reports an applied start-section preference even when no title changes', async () => {
    getDb()
      .insert(mineProfilePreferences)
      .values({
        profileId: ANNA,
        startSection: 'diary',
        updatedAt: at(6),
      })
      .run()
    const document = JSON.parse(await profileExport(ANNA))
    document.progress = []
    document.mine = []
    const result = await applyProfileFile(DAD, JSON.stringify(document))
    expect(result).toMatchObject({
      imported: 0,
      unchanged: 0,
      unmatched: 0,
      personal: { changed: 1, unchanged: 0, skipped: 0 },
    })
    expect(
      getDb()
        .select()
        .from(mineProfilePreferences)
        .where(eq(mineProfilePreferences.profileId, DAD))
        .get()
        ?.startSection,
    ).toBe('diary')
  })

  it('round-trips every personal section across both import paths and keeps profile zones local', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    const collectionId = 'portable-start'
    db.insert(collections)
      .values({
        id: collectionId,
        name: 'Portable start',
        nameKey: 'portable start',
      })
      .run()
    db.update(mineProfilePreferences)
      .set({
        startSection: 'continue',
        startCollectionId: collectionId,
      })
      .where(eq(mineProfilePreferences.profileId, ANNA))
      .run()
    expect(ensureDiaryTimeZone('Pacific/Auckland')).toBe('Pacific/Auckland')
    const body = await profileExport(ANNA)
    const serverBody = await exportServer()
    const before = parseExportDocument(body)
    if (before.version !== 2)
      throw new Error('Expected a v2 export')

    expect(body).not.toContain('mutationToken')
    expect(body).not.toContain('mutation_token')
    expect(body).not.toContain(ANNA)
    expect(before.personalSpace).toMatchObject({
      timeZone: 'Pacific/Auckland',
      profilePreferences: [
        { startSection: 'continue', startCollectionName: 'Portable start' },
      ],
      cycleProgress: [
        { completedAt: at(4).toISOString() },
        { completedAt: null },
      ],
    })
    expect(body).not.toContain(collectionId)
    expect(body).not.toContain('lifecycleRevision')

    db.delete(serverSettings)
      .where(eq(serverSettings.key, 'mine.diaryTimeZone'))
      .run()
    expect(ensureDiaryTimeZone('America/Los_Angeles')).toBe(
      'America/Los_Angeles',
    )
    const first = await applyProfileFile(DAD, body)
    expect(first.preview.personal).toEqual({
      changed: 13,
      unchanged: 0,
      skipped: 0,
    })
    const target = parseExportDocument(await profileExport(DAD))
    expect(target).toMatchObject({
      personalSpace: {
        ...before.personalSpace,
        timeZone: 'America/Los_Angeles',
      },
    })
    expect(diaryTimeZone()).toBe('America/Los_Angeles')

    // Equal portable event UUIDs are valid in two profiles, with different local versions.
    const tokens = db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.id, FIRST))
      .all()
    expect(tokens).toHaveLength(2)
    expect(new Set(tokens.map(row => row.mutationToken)).size).toBe(2)
    const again = await applyProfileFile(DAD, body)
    expect(again.preview.personal).toEqual({
      changed: 0,
      unchanged: 13,
      skipped: 0,
    })
    expect(again.imported).toBe(0)
    expect(
      db.select().from(diaryEntries).where(eq(diaryEntries.id, FIRST)).all(),
    ).toEqual(tokens)

    clearViewerData()
    seed()
    const restored = await importServer(serverBody, {
      mapping: { p1: DAD, p2: 'skip' },
    })
    expect(restored.preview.profiles[0].counts.personal).toEqual({
      changed: 13,
      unchanged: 0,
      skipped: 0,
    })
    expect(parseExportDocument(await profileExport(DAD))).toMatchObject({
      personalSpace: before.personalSpace,
    })
    expect(diaryTimeZone()).toBe('Pacific/Auckland')
    expect(
      db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.profileId, ANNA))
        .all(),
    ).toEqual([])
  })

  it('uses native v3 only for profiles with Simkl provenance and restores it through both import paths', async () => {
    const db = getDb()
    const key = `${'a'.repeat(64)}/123:movie`
    db.insert(diaryEntries).values({
      profileId: ANNA,
      id: FIRST,
      titleId: 'tmdb:movie:99001',
      season: 0,
      episode: 0,
      precision: 'instant',
      instant: at(3),
      origin: 'simkl',
      originKey: key,
      createdAt: at(3),
      updatedAt: at(3),
    }).run()
    const file = await profileExport(ANNA)
    const server = await exportServer()
    const entry = { origin: 'simkl', originKey: key }
    expect(parseExportDocument(file)).toMatchObject({
      version: 3,
      personalSpace: { diary: [entry] },
    })
    expect(parseExportDocument(await profileExport(DAD)).version).toBe(2)
    const unversioned = file.replace('"version":3', '"version":2')
    expect(() => parseExportDocument(unversioned)).toThrow('broken')

    await applyProfileFile(DAD, file)
    expect(parseExportDocument(await profileExport(DAD))).toMatchObject({
      version: 3,
      personalSpace: { diary: [entry] },
    })

    clearViewerData()
    seed()
    await importServer(server, { mapping: { p1: DAD, p2: 'skip' } })
    expect(parseExportDocument(await profileExport(DAD))).toMatchObject({
      version: 3,
      personalSpace: { diary: [entry] },
    })
  })

  it('resolves a collection preference for the target profile and conditionally restores it on undo', async () => {
    const db = getDb()
    const newCollection = 'native-same-name'
    db.insert(collections)
      .values({ id: newCollection, name: 'Portable', nameKey: 'portable' })
      .run()
    db.insert(mineProfilePreferences)
      .values([
        {
          profileId: ANNA,
          startSection: 'continue',
          startCollectionId: newCollection,
          updatedAt: at(6),
        },
        {
          profileId: DAD,
          startSection: 'continue',
          startCollectionId: 'c1',
          updatedAt: at(5),
        },
      ])
      .run()
    const incoming = await profileExport(ANNA)
    const targetPreference = () =>
      db
        .select()
        .from(mineProfilePreferences)
        .where(eq(mineProfilePreferences.profileId, DAD))
        .get()
    const one = await applyProfileFile(DAD, incoming)
    expect(targetPreference()?.startCollectionId).toBe(newCollection)
    expect((await undoBatch(DAD, one.id)).statusCode).toBe(200)
    expect(targetPreference()?.startCollectionId).toBe('c1')

    // A hidden collection is never selected by another profile's file.
    db.insert(collectionHiddenProfiles)
      .values({ profileId: DAD, collectionId: newCollection })
      .run()
    const two = await applyProfileFile(DAD, incoming)
    expect(targetPreference()).toMatchObject({
      startSection: 'continue',
      startCollectionId: null,
    })
    db.delete(collections).where(eq(collections.id, 'c1')).run()
    expect((await undoBatch(DAD, two.id)).statusCode).toBe(200)
    expect(targetPreference()).toMatchObject({
      startSection: 'continue',
      startCollectionId: null,
    })

    db.delete(collections).where(eq(collections.id, newCollection)).run()
    await applyProfileFile(DAD, incoming)
    expect(targetPreference()).toMatchObject({
      startSection: 'continue',
      startCollectionId: null,
    })
  })

  it('falls back after the previous start collection is deleted and undoes independent data', async () => {
    const db = getDb()
    db.insert(collections)
      .values({ id: 'new-start', name: 'New start', nameKey: 'new start' })
      .run()
    db.insert(mineProfilePreferences)
      .values([
        {
          profileId: ANNA,
          startSection: 'continue',
          startCollectionId: 'new-start',
          updatedAt: at(6),
        },
        {
          profileId: DAD,
          startSection: 'continue',
          startCollectionId: 'c1',
          updatedAt: at(5),
        },
      ])
      .run()
    db.insert(mineTitlePreferences)
      .values({
        profileId: ANNA,
        titleId: SHOW,
        note: 'Independent imported note',
        updatedAt: at(6),
      })
      .run()
    const applied = await applyProfileFile(DAD, await profileExport(ANNA))
    const prefs = () =>
      db
        .select()
        .from(mineProfilePreferences)
        .where(eq(mineProfilePreferences.profileId, DAD))
        .get()!
    const after = prefs()
    expect(after.startCollectionId).toBe('new-start')
    db.delete(collections).where(eq(collections.id, 'c1')).run()
    expect(prefs().mutationToken).toBe(after.mutationToken)
    const undone = await undoBatch(DAD, applied.id)
    expect(undone.statusCode, undone.body).toBe(200)
    expect(prefs()).toMatchObject({
      startSection: 'continue',
      startCollectionId: null,
    })
    expect(prefs().mutationToken).not.toBe(after.mutationToken)
    expect(
      db
        .select()
        .from(mineTitlePreferences)
        .where(eq(mineTitlePreferences.profileId, DAD))
        .all(),
    ).toHaveLength(0)
  })

  it('transfers a newer explicit cycle restart and keeps omitted legacy completion unknown', async () => {
    seedPersonalSpace(ANNA)
    const db = getDb()
    const first = await profileExport(ANNA)
    await applyProfileFile(DAD, first)
    const cursor = (profileId: string) =>
      and(
        eq(cycleProgress.profileId, profileId),
        eq(cycleProgress.season, 0),
        eq(cycleProgress.episode, 1),
      )
    const current = () =>
      db.select().from(cycleProgress).where(cursor(DAD)).get()!
    expect(current().completedAt).toEqual(at(4))

    const omitted = parseExportDocument(first)
    if (omitted.version !== 2)
      throw new Error('Expected a v2 document')
    omitted.personalSpace.cycleProgress[0]!.updatedAt = at(7).toISOString()
    delete omitted.personalSpace.cycleProgress[0]!.completedAt
    await applyProfileFile(DAD, JSON.stringify(omitted))
    expect(current()).toMatchObject({ completedAt: at(4), updatedAt: at(7) })

    db.update(cycleProgress)
      .set({ position: 50, completedAt: null, updatedAt: at(8) })
      .where(cursor(ANNA))
      .run()
    const reset = await profileExport(ANNA)
    const changed = await applyProfileFile(DAD, reset)
    expect(current()).toMatchObject({
      completedAt: null,
      position: 50,
      updatedAt: at(8),
    })
    const token = current().mutationToken
    await applyProfileFile(DAD, first)
    expect(current().mutationToken).toBe(token)
    expect(current().completedAt).toBeNull()
    expect((await undoBatch(DAD, changed.id)).statusCode).toBe(200)
    expect(current()).toMatchObject({ completedAt: at(4), updatedAt: at(7) })
    deleteProfile(ANNA, DAD)
    expect(current()).toMatchObject({
      completedAt: null,
      position: 50,
      updatedAt: at(8),
    })
    expect(parseExportDocument(await profileExport(DAD))).toMatchObject({
      personalSpace: {
        cycleProgress: expect.arrayContaining([
          expect.objectContaining({ completedAt: null, position: 50 }),
        ]),
      },
    })
  })

  it('recalculates a Trakt repeat after native transfer and undo without storing the derived flag', async () => {
    const db = getDb()
    db.update(profiles)
      .set({ ageLimit: null })
      .where(eq(profiles.id, ANNA))
      .run()
    const fact = {
      titleId: MOVIE,
      season: 0,
      episode: 0,
      precision: 'instant' as const,
      origin: 'trakt' as const,
    }
    db.insert(diaryEntries)
      .values([
        {
          ...fact,
          profileId: ANNA,
          id: FIRST,
          originKey: 'id:1',
          instant: at(1),
          createdAt: at(3),
          updatedAt: at(3),
        },
        {
          ...fact,
          profileId: DAD,
          id: SECOND,
          originKey: 'id:2',
          instant: at(2),
          createdAt: at(2),
          updatedAt: at(2),
        },
      ])
      .run()
    const repeats = async (id: string) => {
      const response = await app.inject({
        url: '/api/mine/v1/diary',
        query: { expectedProfileId: id, rewatch: 'only' },
        cookies: { ...authed(), [PROFILE_COOKIE]: id },
      })
      expect(response.statusCode, response.body).toBe(200)
      return response.json()
    }
    expect(await repeats(DAD)).toMatchObject({ total: 0 })
    const introduced = await applyProfileFile(DAD, await profileExport(ANNA))
    expect(await repeats(DAD)).toMatchObject({
      total: 1,
      entries: [{ id: SECOND, rewatch: true }],
    })
    const exported = await profileExport(DAD)
    expect(parseExportDocument(exported)).toMatchObject({
      personalSpace: {
        diary: [
          expect.objectContaining({ origin: 'trakt', rewatch: false }),
          expect.objectContaining({ origin: 'trakt', rewatch: false }),
        ],
      },
    })
    await applyProfileFile(ANNA, exported)
    expect(await repeats(ANNA)).toMatchObject({
      total: 1,
      entries: [{ id: SECOND }],
    })
    expect((await undoBatch(DAD, introduced.id)).statusCode).toBe(200)
    expect(await repeats(DAD)).toMatchObject({ total: 0 })
  })

  async function viewingFile(id: string) {
    const document = parseExportDocument(await profileExport(ANNA))
    if (document.version !== 2)
      throw new Error('Expected a v2 export')

    const { diary, seen, timeZone } = document.personalSpace
    return JSON.stringify({
      ...document,
      progress: [],
      mine: [],
      personalSpace: {
        ...document.personalSpace,
        timeZone,
        diary: diary.filter(row => row.id === id),
        seen: seen.filter(row => row.title === SHOW && row.episode === 1),
        cycles: [],
        cycleProgress: [],
        cyclePlayback: [],
        titlePreferences: [],
        profilePreferences: [],
      },
    })
  }

  it('keeps the mark created by one import after a different event claims it', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    const first = await applyProfileFile(DAD, await viewingFile(FIRST))
    const mark = () =>
      db.select().from(diarySeen).where(eq(diarySeen.profileId, DAD)).get()!
    const firstToken = mark().mutationToken
    const laterFile = await viewingFile(SECOND)
    const later = await applyProfileFile(DAD, laterFile)
    const laterToken = mark().mutationToken
    expect(laterToken).not.toBe(firstToken)
    const repeated = await applyProfileFile(DAD, laterFile)
    expect(repeated.preview.personal).toEqual({
      changed: 0,
      unchanged: 2,
      skipped: 0,
    })
    expect(mark().mutationToken).toBe(laterToken)

    expect((await undoBatch(DAD, first.id)).json()).toEqual({
      restored: 0,
      kept: 2,
    })
    expect(mark().mutationToken).toBe(laterToken)
    expect(
      db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.profileId, DAD))
        .all(),
    ).toHaveLength(2)
    expect((await undoBatch(DAD, later.id)).json()).toEqual({
      restored: 1,
      kept: 0,
    })
    expect(mark().mutationToken).toBe(laterToken)
  })

  it('keeps a restored seen mark when the unchanged diary entry was edited later', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    const file = await viewingFile(FIRST)
    await applyProfileFile(DAD, file)
    db.delete(diarySeen).where(eq(diarySeen.profileId, DAD)).run()
    const restored = await applyProfileFile(DAD, file)
    expect(restored.preview.personal).toEqual({
      changed: 1,
      unchanged: 1,
      skipped: 0,
    })
    const entry = and(
      eq(diaryEntries.profileId, DAD),
      eq(diaryEntries.id, FIRST),
    )
    db.update(diaryEntries).set({ note: 'Newer note' }).where(entry).run()

    expect((await undoBatch(DAD, restored.id)).json()).toEqual({
      restored: 0,
      kept: 1,
    })
    expect(
      db.select().from(diarySeen).where(eq(diarySeen.profileId, DAD)).get(),
    ).toBeDefined()
    expect(db.select().from(diaryEntries).where(entry).get()?.note).toBe(
      'Newer note',
    )
  })

  const cycleImportCases = (['profile', 'server'] as const).flatMap(via =>
    (['full first', 'history first'] as const).flatMap(order =>
      [false, true].map(occupied => ({ via, order, occupied })),
    ),
  )

  it.each(cycleImportCases)(
    'keeps cycle identity through both snapshots ($via / $order / occupied=$occupied)',
    async ({ via, order, occupied }) => {
      const db = getDb()
      seedPersonalSpace(ANNA)
      const otherSeries = 'tmdb:tv:9910'
      if (occupied) {
        db.insert(rewatchCycles)
          .values({
            id: CYCLE,
            profileId: DAD,
            titleId: otherSeries,
            state: 'active',
            startSeason: 3,
            startEpisode: 2,
            targetSeason: 3,
            targetEpisode: 2,
            createdAt: at(3),
            updatedAt: at(3),
          })
          .run()
      }
      const file
        = via === 'profile' ? await profileExport(ANNA) : await exportServer()
      const source = parseExportDocument(file)
      if (source.version !== 2)
        throw new Error('Expected a v2 export')

      const { personalSpace: space } = source
      const earlierEntry = space.diary.find(entry => entry.id === INSTANT)!
      const historyEntry = {
        ...earlierEntry,
        id: '4db928c5-bf0b-4ef2-b20c-4597a5fa60cc',
      }
      const history = JSON.stringify({
        ...source,
        personalSpace: {
          ...space,
          diary: [historyEntry],
          cycles: [],
          cycleProgress: [],
        },
      })
      const full = JSON.stringify({
        ...source,
        personalSpace: {
          ...space,
          diary:
            order === 'history first'
              ? [...space.diary, historyEntry]
              : space.diary,
        },
      })
      const apply = (snapshot: string) =>
        via === 'profile'
          ? applyProfileFile(DAD, snapshot)
          : importServer(snapshot, { mapping: { p1: DAD, p2: 'skip' } })

      const initialSnapshot = order === 'full first' ? full : history
      const laterSnapshot = order === 'full first' ? history : full
      await apply(initialSnapshot)
      const interim = parseExportDocument(await profileExport(DAD))
      if (interim.version !== 2)
        throw new Error('Expected a v2 export')

      const initialEntryId = order === 'full first' ? INSTANT : historyEntry.id
      const initial = interim.personalSpace.diary.find(
        row => row.id === initialEntryId,
      )?.context
      if (initial?.kind !== 'cycle')
        throw new Error('Expected a cycle context')

      await apply(laterSnapshot)
      const final = parseExportDocument(await profileExport(DAD))
      if (final.version !== 2)
        throw new Error('Expected a v2 export')

      const cycle = final.personalSpace.cycles.find(
        row => row.title === SHOW,
      )
      expect(cycle?.id).toBe(initial.cycleId)
      expect(cycle?.id === CYCLE).toBe(!occupied)
      if (occupied) {
        expect(
          final.personalSpace.cycles.find(row => row.id === CYCLE)?.title,
        ).toBe(otherSeries)
      }
      for (const id of [INSTANT, historyEntry.id]) {
        expect(
          final.personalSpace.diary.find(row => row.id === id)?.context,
        ).toEqual({
          kind: 'cycle',
          cycleId: cycle!.id,
        })
      }
      expect(
        final.personalSpace.cycleProgress.map(row => row.cycleId),
      ).toEqual([cycle!.id, cycle!.id])

      for (const snapshot of [initialSnapshot, laterSnapshot]) {
        const replay = await apply(snapshot)
        if (via === 'profile') {
          expect(replay.preview.personal).toMatchObject({
            changed: 0,
            skipped: 0,
          })
        }
        else {
          // Preview suggests the profile with the original name. Apply above
          // overrides that suggestion, so check the actual merge result.
          expect(replay.result.profiles.changed).toBe(0)
          expect(replay.result.skipped).toBe(0)
        }
      }
      expect(parseExportDocument(await profileExport(DAD))).toMatchObject({
        personalSpace: final.personalSpace,
      })
    },
  )

  it('skips a cycle whose immutable starting episode conflicts and preserves both profiles on move', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    db.insert(rewatchCycles)
      .values({
        id: CYCLE,
        profileId: DAD,
        titleId: SHOW,
        state: 'active',
        startSeason: 1,
        startEpisode: 2,
        targetSeason: 1,
        targetEpisode: 2,
        createdAt: at(3),
        updatedAt: at(3),
      })
      .run()
    const imported = await applyProfileFile(DAD, await profileExport(ANNA))
    expect(imported.preview.personal.skipped).toBe(4)
    const target = parseExportDocument(await profileExport(DAD))
    if (target.version !== 2)
      throw new Error('Expected a v2 export')
    expect(target.personalSpace.cycles).toEqual([
      expect.objectContaining({
        id: CYCLE,
        startSeason: 1,
        startEpisode: 2,
        state: 'active',
      }),
    ])
    expect(target.personalSpace.diary.some(row => row.id === INSTANT)).toBe(
      false,
    )
    expect(target.personalSpace.cycleProgress).toEqual([])

    const entries = db.select().from(diaryEntries).all()
    const cycles = db.select().from(rewatchCycles).all()
    const moved = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${ANNA}?moveTo=${DAD}`,
      cookies: authed(),
    })
    expect(moved.statusCode).toBe(409)
    expect(moved.json()).toEqual({
      kind: 'personalMoveConflict',
      reason: 'cycleIdentity',
    })
    expect(
      db.select().from(profiles).where(eq(profiles.id, ANNA)).get(),
    ).toBeDefined()
    expect(db.select().from(diaryEntries).all()).toEqual(entries)
    expect(db.select().from(rewatchCycles).all()).toEqual(cycles)
  })

  it.each([
    { titleId: OTHER, episode: 0, reason: 'originTitle' },
    { titleId: SHOW, episode: 2, reason: 'originEpisode' },
  ])(
    'rejects a profile move with a different match for an imported event ($reason)',
    async ({ titleId, episode, reason }) => {
      const db = getDb()
      seedPersonalSpace(ANNA)
      db.insert(diaryEntries)
        .values({
          profileId: DAD,
          id: ACTIVE,
          titleId,
          season: 0,
          episode,
          precision: 'day',
          day: '2024-02-29',
          origin: 'trakt',
          originKey: '9007199254740997',
          note: 'Different match',
          createdAt: at(6),
          updatedAt: at(7),
        })
        .run()
      const before = {
        entries: db.select().from(diaryEntries).all(),
        cursors: db.select().from(titleProgress).all(),
        profiles: db.select().from(profiles).all(),
        cycles: db.select().from(rewatchCycles).all(),
      }
      const moved = await app.inject({
        method: 'DELETE',
        url: `/api/profiles/${ANNA}?moveTo=${DAD}`,
        cookies: authed(),
      })
      expect(moved.statusCode).toBe(409)
      expect(moved.json()).toEqual({ kind: 'personalMoveConflict', reason })
      expect(db.select().from(diaryEntries).all()).toEqual(before.entries)
      expect(db.select().from(titleProgress).all()).toEqual(before.cursors)
      expect(db.select().from(profiles).all()).toEqual(before.profiles)
      expect(db.select().from(rewatchCycles).all()).toEqual(before.cycles)
    },
  )

  const proof = 'a'.repeat(64)

  function seedProofSource(targetDay: number, localProof?: string) {
    const db = getDb()
    const event = {
      titleId: SHOW,
      season: 1,
      episode: 3,
      origin: 'trakt' as const,
      originKey: 'id:92352',
      createdAt: at(5),
      updatedAt: at(6),
    }
    db.insert(diaryEntries)
      .values([
        {
          ...event,
          profileId: ANNA,
          id: FIRST,
          precision: 'day',
          day: '2024-04-28',
          note: 'Source note',
          viewingContext: 'Cinema',
          sourceMatchKey: proof,
        },
        {
          ...event,
          profileId: DAD,
          id: SECOND,
          precision: 'day',
          day: '2024-04-29',
          note: 'Local note',
          viewingContext: 'At home',
          context: { kind: 'normal' },
          sourceMatchKey: localProof,
          updatedAt: at(targetDay),
        },
      ])
      .run()
    db.insert(diarySeen)
      .values({ profileId: DAD, titleId: SHOW, season: 1, episode: 3 })
      .run()
    return {
      where: and(eq(diaryEntries.profileId, DAD), eq(diaryEntries.id, SECOND)),
      mark: db
        .select()
        .from(diarySeen)
        .where(eq(diarySeen.profileId, DAD))
        .get(),
    }
  }

  function proofFile(body: string) {
    const document = parseExportDocument(body)
    return JSON.stringify({ ...document, progress: [], mine: [] })
  }

  it.each([
    { targetDay: 6, edit: false },
    { targetDay: 8, edit: true },
  ])(
    'fills a missing match proof without replacing local fields and guards undo ($targetDay / edit=$edit)',
    async ({ targetDay, edit }) => {
      const db = getDb()
      const { where, mark } = seedProofSource(targetDay)
      const entry = () => db.select().from(diaryEntries).where(where).get()!
      const before = entry()
      const body = proofFile(await profileExport(ANNA))
      const first = await applyProfileFile(DAD, body)
      expect(first.preview.personal).toEqual({
        changed: 1,
        unchanged: 0,
        skipped: 0,
      })
      const filled = entry()
      expect(filled).toEqual({
        ...before,
        sourceMatchKey: proof,
        mutationToken: expect.any(String),
      })
      expect(filled.mutationToken).not.toBe(before.mutationToken)
      expect(
        db.select().from(diarySeen).where(eq(diarySeen.profileId, DAD)).get(),
      ).toEqual(mark)

      const replay = await applyProfileFile(DAD, body)
      expect(replay.preview.personal).toEqual({
        changed: 0,
        unchanged: 1,
        skipped: 0,
      })
      expect(entry()).toEqual(filled)
      if (edit)
        db.update(diaryEntries).set({ note: 'Later edit' }).where(where).run()
      const expected = entry()
      const undone = await undoBatch(DAD, first.id)
      expect(undone.statusCode).toBe(200)
      if (edit) {
        expect(undone.json()).toEqual({ restored: 0, kept: 1 })
        expect(entry()).toEqual(expected)
      }
      else {
        expect(undone.json()).toEqual({ restored: 1, kept: 0 })
        expect(entry()).toEqual({
          ...before,
          mutationToken: expect.any(String),
        })
        expect(entry().mutationToken).not.toBe(before.mutationToken)
      }
    },
  )

  it('fills the same missing proof through server import without overwriting the newer diary entry', async () => {
    const db = getDb()
    const { where } = seedProofSource(8)
    const before = db.select().from(diaryEntries).where(where).get()!
    const body = proofFile(await exportServer())
    const first = await importServer(body, {
      mapping: { p1: DAD, p2: 'skip' },
    })
    expect(first.result.profiles.changed).toBe(1)
    const filled = db.select().from(diaryEntries).where(where).get()!
    expect(filled).toEqual({
      ...before,
      sourceMatchKey: proof,
      mutationToken: expect.any(String),
    })
    const repeated = await importServer(body, {
      mapping: { p1: DAD, p2: 'skip' },
    })
    expect(repeated.result.profiles.changed).toBe(0)
    expect(db.select().from(diaryEntries).where(where).get()).toEqual(filled)
  })

  it.each([
    { targetDay: 6, localProof: undefined },
    { targetDay: 8, localProof: undefined },
    { targetDay: 8, localProof: 'b'.repeat(64) },
  ])(
    'moves proof from an equal or older entry without replacing existing proof ($targetDay / $localProof)',
    ({ targetDay, localProof }) => {
      const db = getDb()
      const { where, mark } = seedProofSource(targetDay, localProof)
      const before = db.select().from(diaryEntries).where(where).get()!

      deleteProfile(ANNA, DAD)

      expect(
        db.select().from(profiles).where(eq(profiles.id, ANNA)).get(),
      ).toBeUndefined()
      const moved = db.select().from(diaryEntries).where(where).get()!
      expect(moved).toEqual({
        ...before,
        sourceMatchKey: localProof ?? proof,
        mutationToken: localProof ? before.mutationToken : expect.any(String),
      })
      if (!localProof)
        expect(moved.mutationToken).not.toBe(before.mutationToken)
      expect(
        db.select().from(diarySeen).where(eq(diarySeen.profileId, DAD)).get(),
      ).toEqual(mark)
    },
  )

  it('restores a previous viewing context when the replacement was untouched after import', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    const entry = and(
      eq(diaryEntries.profileId, ANNA),
      eq(diaryEntries.id, FIRST),
    )
    await applyProfileFile(DAD, await viewingFile(FIRST))
    db.update(diaryEntries)
      .set({ viewingContext: 'At home', updatedAt: at(7) })
      .where(entry)
      .run()
    const applied = await applyProfileFile(DAD, await viewingFile(FIRST))
    const target = and(
      eq(diaryEntries.profileId, DAD),
      eq(diaryEntries.id, FIRST),
    )
    expect(
      db.select().from(diaryEntries).where(target).get()?.viewingContext,
    ).toBe('At home')
    expect((await undoBatch(DAD, applied.id)).json()).toEqual({
      restored: 1,
      kept: 0,
    })
    expect(
      db.select().from(diaryEntries).where(target).get()?.viewingContext,
    ).toBe('Balcony with Sam')
  })

  it('restores the legacy source evidence from before import after a file is re-probed', async () => {
    const db = getDb()
    const libraryId = 'legacy-lib'
    const folderId = 'legacy-folder'
    const mediaFileId = 'legacy-file'
    const relPath = 'movie.mkv'
    function probe(width: number, height: number) {
      return parseProbe(
        { streams: [{ index: 0, codec_type: 'video', width, height }] },
        relPath,
      )
    }
    db.insert(libraries)
      .values({ id: libraryId, kind: 'video', name: 'Movies' })
      .run()
    db.insert(libraryFolders)
      .values({ id: folderId, libraryId, path: '/test/movies' })
      .run()
    const original = db
      .insert(mediaFiles)
      .values({
        id: mediaFileId,
        folderId,
        relPath,
        titleId: MOVIE,
        size: 10,
        mtime: at(1),
        inode: 1,
        probeKey: persistedProbeKey({ size: 10, mtimeMs: at(1).getTime() }),
        probe: probe(1920, 1080),
      })
      .returning()
      .get()
    const ref = { profileId: DAD, titleId: MOVIE, season: 0, episode: 0 }
    db.insert(titleProgress)
      .values({
        ...ref,
        mediaFileId,
        position: 25,
        duration: 100,
        voiceStudio: 'Old studio',
        lastPlayedAt: at(2),
        updatedAt: at(2),
      })
      .run()
    expect(getTitleProgress(ref)?.playedSource).toBeNull()
    const applied = await applyProfileFile(DAD, await profileExport(ANNA))
    const beforeProbe = getTitleProgress(ref)
    expect(beforeProbe?.playedSource).toEqual({ kind: 'unknown' })

    const nextFile = { relPath, size: 20, inode: 2, mtime: at(3).getTime() }
    expect(applyScan(folderId, [nextFile], [original]).changed).toEqual([
      mediaFileId,
    ])
    db.update(mediaFiles)
      .set({
        probeKey: persistedProbeKey({
          size: nextFile.size,
          mtimeMs: nextFile.mtime,
        }),
        probe: probe(3840, 2160),
      })
      .where(eq(mediaFiles.id, mediaFileId))
      .run()
    expect(getTitleProgress(ref)).toEqual(beforeProbe)

    expect((await undoBatch(DAD, applied.id)).json()).toEqual({
      restored: 3,
      kept: 0,
    })
    expect(getTitleProgress(ref)).toMatchObject({
      position: 25,
      playedSource: {
        kind: 'library',
        mediaFileId,
        quality: '1080p',
        voice: { studio: 'Old studio' },
      },
    })
  })

  it('uses the local zone for a profile file uploaded through server import as well', async () => {
    seedPersonalSpace(ANNA)
    const local = diaryTimeZone()
    const foreign
      = local === 'Pacific/Auckland' ? 'America/Los_Angeles' : 'Pacific/Auckland'
    ensureDiaryTimeZone(foreign)
    const file = await profileExport(ANNA)
    clearViewerData()
    seed()

    await importServer(file, { mapping: { p1: DAD } })

    expect(diaryTimeZone()).toBe(local)
  })

  it('rejects incomplete v2 and a cursor pointing to another profile before applying anything', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    const profileFile = JSON.parse(await profileExport(ANNA))
    delete profileFile.personalSpace.titlePreferences
    expect(
      (await upload(DAD, JSON.stringify(profileFile))).json(),
    ).toMatchObject({ kind: 'broken' })

    const source = JSON.parse(await exportServer())
    source.personalSpace.cycleProgress[0].profile = source.profiles[1].key
    const checked = await preview(JSON.stringify(source))
    expect(checked.statusCode).toBe(400)
    expect(checked.json()).toMatchObject({ kind: 'broken' })
    expect(
      db
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.profileId, DAD))
        .all(),
    ).toEqual([])
    expect(serverImportDeps.backup).not.toHaveBeenCalled()
  })

  it.each(['note', 'unwatch', 'recreate'] as const)(
    'keeps every linked entry and seen effect after %s but rolls back independent changes',
    async (edit) => {
      const db = getDb()
      seedPersonalSpace(ANNA)
      // Leave a pre-existing seen mark in this target to exercise the witness-only case.
      if (edit === 'unwatch') {
        db.insert(diarySeen)
          .values({ profileId: DAD, titleId: SHOW, season: 0, episode: 1 })
          .run()
      }
      const applied = await applyProfileFile(DAD, await profileExport(ANNA))
      const diaryKey = and(
        eq(diaryEntries.profileId, DAD),
        eq(diaryEntries.id, FIRST),
      )
      const seenKey = and(
        eq(diarySeen.profileId, DAD),
        eq(diarySeen.titleId, SHOW),
        eq(diarySeen.episode, 1),
      )
      if (edit === 'note') {
        db.update(diaryEntries)
          .set({ note: 'Later edit' })
          .where(diaryKey)
          .run()
      }
      else if (edit === 'unwatch') {
        db.delete(diarySeen).where(seenKey).run()
      }
      else {
        const { mutationToken: _token, ...row } = db
          .select()
          .from(diaryEntries)
          .where(diaryKey)
          .get()!
        db.delete(diaryEntries).where(diaryKey).run()
        db.insert(diaryEntries).values(row).run()
      }
      const current = db.select().from(diaryEntries).where(diaryKey).get()
      const undone = await undoBatch(DAD, applied.id)
      expect(undone.statusCode).toBe(200)
      expect(undone.json()).toEqual({
        restored: 12,
        kept: edit === 'unwatch' ? 3 : 4,
      })
      expect(db.select().from(diaryEntries).where(diaryKey).get()).toEqual(
        current,
      )
      expect(
        db
          .select()
          .from(diaryEntries)
          .where(eq(diaryEntries.profileId, DAD))
          .all(),
      ).toHaveLength(3)
      expect(!!db.select().from(diarySeen).where(seenKey).get()).toBe(
        edit !== 'unwatch',
      )
      expect(
        db
          .select()
          .from(mineTitlePreferences)
          .where(eq(mineTitlePreferences.profileId, DAD))
          .get(),
      ).toBeUndefined()
      const repeated = await undoBatch(DAD, applied.id)
      expect(repeated.statusCode).toBe(409)
      expect(db.select().from(diaryEntries).where(diaryKey).get()).toEqual(
        current,
      )
    },
  )

  it('preserves a manual unwatch even when the sort timestamp is unchanged', async () => {
    const db = getDb()
    db.update(titleProgress)
      .set({ watchedAt: at(6) })
      .where(
        and(
          eq(titleProgress.profileId, ANNA),
          eq(titleProgress.titleId, MOVIE),
        ),
      )
      .run()
    const applied = await applyProfileFile(DAD, await profileExport(ANNA))
    const ref = { profileId: DAD, titleId: MOVIE }
    const imported = getTitleProgress(ref)!
    expect(imported.watchedAt).toEqual(at(6))
    markWatched(ref, false)
    const unwatched = getTitleProgress(ref)!
    expect(unwatched.watchedAt).toBeNull()
    expect(unwatched.updatedAt).toEqual(imported.updatedAt)
    const undone = await undoBatch(DAD, applied.id)
    expect(undone.json()).toEqual({ restored: 2, kept: 1 })
    expect(getTitleProgress(ref)).toEqual(unwatched)
  })

  it('keeps a cycle and its imported positions if a new cursor appeared after import', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    const applied = await applyProfileFile(DAD, await profileExport(ANNA))
    db.insert(cycleProgress)
      .values({
        profileId: DAD,
        cycleId: CYCLE,
        season: 3,
        episode: 1,
        position: 25,
        updatedAt: at(7),
      })
      .run()
    const undone = await undoBatch(DAD, applied.id)
    expect(undone.statusCode).toBe(200)
    expect(undone.json().kept).toBe(3)
    expect(
      db
        .select()
        .from(cycleProgress)
        .where(eq(cycleProgress.profileId, DAD))
        .all(),
    ).toHaveLength(3)
    expect(
      db
        .select()
        .from(rewatchCycles)
        .where(eq(rewatchCycles.profileId, DAD))
        .get(),
    ).toMatchObject({ state: 'paused' })
  })

  it('moves all personal records and preserves both sets of cursors when active cycles collide', async () => {
    const db = getDb()
    seedPersonalSpace(ANNA)
    db.insert(rewatchCycles)
      .values({
        id: ACTIVE,
        profileId: DAD,
        titleId: SHOW,
        state: 'active',
        startSeason: 1,
        startEpisode: 1,
        targetSeason: 1,
        targetEpisode: 2,
        createdAt: at(4),
        updatedAt: at(6),
      })
      .run()
    const before = db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.id, FIRST))
      .get()!
    const previewed = await upload(DAD, await profileExport(ANNA))
    expect(previewed.json().preview.personal.skipped).toBe(1)

    deleteProfile(ANNA, DAD)

    const moved = parseExportDocument(await profileExport(DAD))
    expect(moved).toMatchObject({
      personalSpace: {
        diary: expect.arrayContaining([
          expect.objectContaining({
            id: FIRST,
            viewingContext: 'Balcony with Sam',
          }),
        ]),
        seen: expect.arrayContaining([
          expect.objectContaining({ title: OTHER }),
        ]),
        cycles: expect.arrayContaining([
          expect.objectContaining({ id: ACTIVE, state: 'active' }),
          expect.objectContaining({ id: CYCLE, state: 'ended' }),
        ]),
        cycleProgress: expect.arrayContaining([
          expect.objectContaining({ cycleId: CYCLE, position: 125 }),
        ]),
        cyclePlayback: [expect.objectContaining({ title: SHOW })],
        titlePreferences: [expect.objectContaining({ note: 'Title note' })],
        profilePreferences: [
          expect.objectContaining({ startSection: 'overview' }),
        ],
      },
    })
    const after = db
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.id, FIRST))
      .get()!
    expect(after.mutationToken).not.toBe(before.mutationToken)
    expect(after.profileId).toBe(DAD)
    expect(
      db.select().from(profiles).where(eq(profiles.id, ANNA)).get(),
    ).toBeUndefined()
  })

  it('round-trips title marks in profile v2, reads older v1 marks, and restores marks through profile undo', async () => {
    const mark = at(5)
    getDb()
      .insert(profileTitles)
      .values({ profileId: ANNA, titleId: SHOW, watchedMarkedAt: mark })
      .run()
    const body = await profileExport(ANNA)
    const document = parseExportDocument(body)
    expect(
      document.mine.find(row => row.title === SHOW)?.watchedMarkedAt,
    ).toBe(mark.toISOString())
    if (document.version !== 2)
      throw new Error('Expected a v2 export')
    const { personalSpace: _personalSpace, ...legacy } = document
    const old = { ...structuredClone(legacy), version: 1 }
    for (const row of old.mine) delete row.watchedMarkedAt
    expect(parseExportDocument(JSON.stringify(old)).version).toBe(1)
    const job = (await upload(DAD, body)).json()
    expect(job.preview.watched).toEqual({ new: 1, same: 0 })
    const applied = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
      cookies: authed(),
      payload: { conflicts: 'newer' },
    })
    expect(applied.statusCode).toBe(200)
    expect(
      getDb()
        .select()
        .from(profileTitles)
        .where(
          and(
            eq(profileTitles.profileId, DAD),
            eq(profileTitles.titleId, SHOW),
          ),
        )
        .get()
        ?.watchedMarkedAt,
    ).toEqual(mark)
    const repeat = (await upload(DAD, body)).json()
    expect(repeat.preview.watched).toEqual({ new: 0, same: 1 })
    const undone = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${applied.json().id}/undo`,
      cookies: authed(),
    })
    expect(undone.statusCode).toBe(200)
    expect(
      getDb()
        .select()
        .from(profileTitles)
        .where(
          and(
            eq(profileTitles.profileId, DAD),
            eq(profileTitles.titleId, SHOW),
          ),
        )
        .get(),
    ).toBeUndefined()
    // The profileData undo serializer must also preserve a pre-existing mark.
    getDb()
      .insert(profileTitles)
      .values({ profileId: DAD, titleId: SHOW, watchedMarkedAt: at(2) })
      .run()
    document.mine.find(row => row.title === SHOW)!.favoriteAt
      = at(6).toISOString()
    const next = (await upload(DAD, JSON.stringify(document))).json()
    const nextApplied = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${next.id}/apply`,
      cookies: authed(),
      payload: { conflicts: 'newer' },
    })
    await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${nextApplied.json().id}/undo`,
      cookies: authed(),
    })
    expect(
      getDb()
        .select()
        .from(profileTitles)
        .where(
          and(
            eq(profileTitles.profileId, DAD),
            eq(profileTitles.titleId, SHOW),
          ),
        )
        .get(),
    ).toMatchObject({ watchedMarkedAt: at(2), favoriteAt: null })
  })

  it.each([
    'unchanged',
    'new source',
    'new voice',
    'same imported voice',
    'round trip',
  ] as const)(
    'undo restores an untouched snapshot and skips later source or voice changes (%s)',
    async (selection) => {
      const db = getDb()
      const localSource = {
        kind: 'library' as const,
        mediaFileId: 'local-played-file',
        torrentId: null,
        fileIndex: null,
        quality: 'SD' as const,
        voice: { studio: 'Old voice' },
      }
      db.update(titleProgress)
        .set({
          mediaFileId: 'local-export-file',
          playedSource: { ...localSource, mediaFileId: 'local-export-file' },
          voiceStudio: 'Imported',
        })
        .where(eq(titleProgress.profileId, ANNA))
        .run()
      const body = await profileExport(ANNA)
      expect(body).not.toContain('local-export-file')
      expect(body).not.toContain('playedSource')
      expect(body).not.toContain('voiceSelectionRevision')
      expect(body).not.toContain('voice_selection_revision')
      db.insert(titleProgress)
        .values({
          profileId: DAD,
          titleId: MOVIE,
          season: 0,
          episode: 0,
          position: 10,
          duration: 100,
          mediaFileId: localSource.mediaFileId,
          playedSource: localSource,
          lastPlayedAt: at(1),
          updatedAt: at(1),
          voiceStudio: 'Old voice',
        })
        .run()
      const where = and(
        eq(titleProgress.profileId, DAD),
        eq(titleProgress.titleId, MOVIE),
      )
      const before = db.select().from(titleProgress).where(where).get()!
      const job = (await upload(DAD, body)).json()
      const applied = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
        cookies: authed(),
        payload: { conflicts: 'newer' },
      })
      expect(applied.statusCode).toBe(200)
      expect(db.select().from(titleProgress).where(where).get()).toMatchObject({
        position: 1200,
        playedSource: { kind: 'unknown' },
        voiceStudio: 'Imported',
        voiceSelectionRevision: before.voiceSelectionRevision,
      })
      const ref = { profileId: DAD, titleId: MOVIE }
      const id = applied.json().id
      const mediaFileId
        = selection === 'new source' ? 'local-selected-file' : before.mediaFileId
      const voiceStudio
        = selection === 'unchanged'
          ? before.voiceStudio
          : selection === 'same imported voice' || selection === 'round trip'
            ? 'Imported'
            : 'More recent voice'
      if (selection === 'round trip')
        rememberVoice(ref, { studio: 'Another' })
      if (selection !== 'unchanged') {
        rememberVoice(
          ref,
          { studio: voiceStudio! },
          {
            torrentId: null,
            fileIndex: null,
            mediaFileId,
          },
        )
      }
      const afterSelection = db
        .select()
        .from(titleProgress)
        .where(where)
        .get()!
      const undone = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${id}/undo`,
        cookies: authed(),
      })
      expect(undone.statusCode).toBe(200)
      const actual = db.select().from(titleProgress).where(where).get()
      if (selection === 'unchanged') {
        expect(undone.json()).toEqual({ restored: 3, kept: 0 })
        expect(actual).toEqual({
          ...before,
          mutationToken: expect.any(String),
        })
        expect(actual!.mutationToken).not.toBe(before.mutationToken)
      }
      else {
        expect(undone.json()).toEqual({ restored: 2, kept: 1 })
        expect(actual).toEqual(afterSelection)
      }
    },
  )

  it.each([false, true])(
    'skips an imported view after a later file choice; explicit voice=%s',
    async (explicit) => {
      getDb()
        .update(titleProgress)
        .set({ voiceStudio: 'Imported' })
        .where(
          and(
            eq(titleProgress.profileId, ANNA),
            eq(titleProgress.titleId, MOVIE),
          ),
        )
        .run()
      const job = (await upload(DAD, await profileExport(ANNA))).json()
      const applied = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
        cookies: authed(),
        payload: { conflicts: 'newer' },
      })
      expect(applied.statusCode).toBe(200)
      const ref = { profileId: DAD, titleId: MOVIE }
      const imported = getTitleProgress(ref)!
      expect(imported.position).toBe(1200)
      expect(imported.voiceStudio).toBe('Imported')
      const source = {
        mediaFileId: 'local-selected-file',
        torrentId: null,
        fileIndex: null,
      }
      if (explicit)
        rememberVoice(ref, { studio: 'Imported' }, source)
      else rememberStartedSource(ref, source, launchSelectionOf(ref, imported))
      const afterSelection = getTitleProgress(ref)
      expect(afterSelection?.mediaFileId).toBe(source.mediaFileId)
      const result = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${applied.json().id}/undo`,
        cookies: authed(),
      })
      expect(result.statusCode).toBe(200)
      expect(result.json()).toEqual({ restored: 2, kept: 1 })
      expect(getTitleProgress(ref)).toEqual(afterSelection)
    },
  )

  it.each([
    { name: 'empty original voice', studio: null, type: null },
    { name: 'original voice', studio: 'Before', type: 'MVO' },
  ])(
    'undo keeps the later source-only choice with $name',
    async ({ studio, type }) => {
      const db = getDb()
      const ref = { profileId: DAD, titleId: MOVIE, season: 0, episode: 0 }
      const playedSource = {
        kind: 'library' as const,
        mediaFileId: 'before-file',
        torrentId: null,
        fileIndex: null,
        quality: '1080p' as const,
        voice: null,
      }
      db.insert(titleProgress)
        .values({
          ...ref,
          mediaFileId: playedSource.mediaFileId,
          position: 21,
          duration: 100,
          playedSource,
          voiceStudio: studio,
          voiceType: type,
          lastPlayedAt: at(1),
          updatedAt: at(1),
        })
        .run()
      db.update(titleProgress)
        .set({ voiceStudio: 'Imported', voiceType: 'DVO' })
        .where(
          and(
            eq(titleProgress.profileId, ANNA),
            eq(titleProgress.titleId, MOVIE),
          ),
        )
        .run()
      const job = (await upload(DAD, await profileExport(ANNA))).json()
      const applied = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
        cookies: authed(),
        payload: { conflicts: 'newer' },
      })
      expect(applied.statusCode).toBe(200)
      const imported = getTitleProgress(ref)!
      rememberStartedSource(
        ref,
        { mediaFileId: 'selected-file', torrentId: null, fileIndex: null },
        launchSelectionOf(ref, imported),
      )
      expect(getTitleProgress(ref)).toMatchObject({
        mediaFileId: 'selected-file',
        voiceStudio: 'Imported',
        voiceType: 'DVO',
        voiceSelectionRevision: 0,
      })
      const id = applied.json().id
      const afterSelection = getTitleProgress(ref)
      const undone = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${id}/undo`,
        cookies: authed(),
      })
      expect(undone.statusCode).toBe(200)
      expect(undone.json()).toEqual({ restored: 2, kept: 1 })
      expect(getTitleProgress(ref)).toEqual(afterSelection)
    },
  )

  it.each([
    'confirmed',
    'same choice again',
    'choice round trip',
    'foreign source',
    'expired',
    'evicted',
    'delayed stat',
    'derived title delayed stat',
    'closed file replaced',
  ] as const)(
    'uses the playback launch to resume the actual library file after an import (%s)',
    async (scenario) => {
      const root = await mkdtemp(join(tmpdir(), 'torsher-import-resume-'))
      const db = getDb()
      const ref = { profileId: DAD, titleId: MOVIE }
      const title = { id: MOVIE }
      const cookies = { ...authed(), [PROFILE_COOKIE]: DAD }
      const sessions: string[] = []
      const source = (mediaFileId: string) => ({
        mediaFileId,
        torrentId: null,
        fileIndex: null,
      })
      const start = async (mediaFileId: string, inferredTitle = false) => {
        const response = await app.inject({
          method: 'POST',
          url: '/api/playback',
          cookies,
          payload: { mediaFileId, title: inferredTitle ? undefined : title },
        })
        expect(response.statusCode, response.body).toBe(200)
        const { sessionId } = response.json()
        expect(response.json()).toMatchObject({
          status: 'ready',
          reasons: ['ToolsMissing'],
        })
        sessions.push(sessionId)
        return sessionId as string
      }
      const checkpoint = async (
        mediaFileId: string,
        sessionId: string,
        position: number,
      ) => {
        const response = await app.inject({
          method: 'PUT',
          url: '/api/watch-state',
          cookies,
          payload: {
            mediaFileId,
            title,
            sessionId,
            position,
            duration: 5400,
            appliedAudioStream: null,
          },
        })
        expect(response.statusCode, response.body).toBe(200)
      }
      const close = (id: string) =>
        app.inject({ method: 'DELETE', url: `/api/playback/${id}`, cookies })
      let unblockStat: (() => void) | undefined
      try {
        const library = db
          .insert(libraries)
          .values({ kind: 'video', name: 'Import resume' })
          .returning()
          .get()
        const folder = db
          .insert(libraryFolders)
          .values({ libraryId: library.id, path: root, status: 'ok' })
          .returning()
          .get()
        const files = []
        for (const label of ['a', 'b', 'c']) {
          const relPath = `${label}.mkv`
          const path = join(root, relPath)
          await writeFile(path, label)
          const info = await stat(path)
          files.push(
            db
              .insert(mediaFiles)
              .values({
                folderId: folder.id,
                titleId: MOVIE,
                relPath,
                size: info.size,
                inode: info.ino,
                mtime: info.mtime,
              })
              .returning()
              .get().id,
          )
        }
        const [a, b, c] = files as [string, string, string]
        const previous = await start(a)
        await checkpoint(a, previous, 10)
        db.update(titleProgress)
          .set({ updatedAt: at(1), lastPlayedAt: at(1) })
          .where(eq(titleProgress.profileId, DAD))
          .run()
        const job = (await upload(DAD, await profileExport(ANNA))).json()
        const imported = await app.inject({
          method: 'POST',
          url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
          cookies: authed(),
          payload: { conflicts: 'newer' },
        })
        expect(imported.statusCode).toBe(200)
        expect(getTitleProgress(ref)).toMatchObject({
          mediaFileId: a,
          position: 1200,
          playedSource: { kind: 'unknown' },
        })

        if (scenario === 'evicted') {
          // With an ordinary factual A, the legacy path would allow B.
          await checkpoint(a, previous, 1225)
        }
        const pathB = join(root, 'b.mkv')
        function storeProbe(info: Stats, width: number, height: number) {
          db.update(mediaFiles)
            .set({
              probeKey: persistedProbeKey(info),
              probe: parseProbe(
                { streams: [{ index: 0, codec_type: 'video', width, height }] },
                'b.mkv',
              ),
            })
            .where(eq(mediaFiles.id, b))
            .run()
        }
        if (scenario === 'closed file replaced')
          storeProbe(await stat(pathB), 1920, 1080)
        const delayed
          = scenario === 'delayed stat'
            || scenario === 'derived title delayed stat'
        let waitForStat: Promise<void> | undefined
        if (delayed) {
          let enter!: () => void
          waitForStat = new Promise((resolve) => {
            enter = resolve
          })
          const gate = new Promise<void>((resolve) => {
            unblockStat = resolve
          })
          fsControl.beforeStat = (path) => {
            if (path === pathB) {
              fsControl.beforeStat = undefined
              enter()
              return gate
            }
          }
        }
        const request = start(b, scenario === 'derived title delayed stat')
        if (waitForStat) {
          await waitForStat
          rememberVoice(ref, { studio: 'Newer choice' }, source(c))
          unblockStat?.()
        }
        const playing = await request
        if (scenario === 'choice round trip')
          rememberVoice(ref, {}, source(c))
        if (
          scenario === 'same choice again'
          || scenario === 'choice round trip'
        ) {
          rememberVoice(ref, {}, source(a))
        }
        if (scenario === 'evicted') {
          for (let i = 0; i < 1024; i++)
            launchSelectionOf({ profileId: DAD, titleId: `tmdb:movie:${i}` })
        }
        if (scenario === 'confirmed' || scenario === 'closed file replaced')
          await checkpoint(b, playing, 1250)
        expect((await close(playing)).statusCode).toBe(200)
        if (scenario === 'closed file replaced') {
          expect(getTitleProgress(ref)?.playedSource).toMatchObject({
            quality: '1080p',
          })
          const replacement = join(root, '.replacement')
          await writeFile(replacement, 'new content')
          await rename(replacement, pathB)
          const info = await stat(pathB)
          const old = db
            .select()
            .from(mediaFiles)
            .where(eq(mediaFiles.id, b))
            .get()!
          expect(
            applyScan(
              folder.id,
              [
                {
                  relPath: old.relPath,
                  inode: info.ino,
                  size: info.size,
                  mtime: info.mtimeMs,
                },
              ],
              [old],
            ).changed,
          ).toEqual([b])
          storeProbe(info, 3840, 2160)
        }
        if (scenario === 'expired') {
          vi.useFakeTimers({ toFake: ['Date'] })
          vi.setSystemTime(Date.now() + 121_000)
        }
        await checkpoint(
          b,
          scenario === 'foreign source' ? previous : playing,
          1300,
        )
        const remembered
          = scenario === 'confirmed' || scenario === 'closed file replaced'
            ? b
            : delayed
              ? c
              : a
        expect(getTitleProgress(ref)).toMatchObject({
          position: 1300,
          mediaFileId: remembered,
          playedSource: { kind: 'library', mediaFileId: b, voice: null },
        })
        expect(
          (await resumeTarget(DAD, MOVIE, async () => []))?.mediaFileId,
        ).toBe(remembered)
        if (scenario === 'closed file replaced') {
          expect(getTitleProgress(ref)?.playedSource).toMatchObject({
            quality: '1080p',
          })
          await checkpoint(b, await start(b), 1350)
          expect(getTitleProgress(ref)?.playedSource).toMatchObject({
            quality: '2160p',
          })
        }
      }
      finally {
        fsControl.beforeStat = undefined
        unblockStat?.()
        if (scenario === 'expired')
          vi.useRealTimers()
        for (const id of sessions) await close(id)
        await rm(root, { recursive: true, force: true })
      }
    },
  )

  it('merges a profile export into another profile and undoes it', async () => {
    const body = await profileExport(ANNA)
    const res = await upload(DAD, body)

    expect(res.statusCode).toBe(202)

    const job = res.json()

    expect(job.state).toBe('ready')
    expect(job.preview).toMatchObject({
      sources: ['torsher'],
      progress: { new: 2, updated: 0, same: 0 },
      ratings: { new: 1 },
      favorites: { new: 1 },
    })

    const applied = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
      cookies: authed(),
      payload: { conflicts: 'newer' },
    })

    expect(applied.json()).toMatchObject({
      imported: 2,
      unchanged: 0,
      unmatched: 0,
    })
    const overview = await app.inject({
      url: `/api/profiles/${DAD}/imports`,
      cookies: authed(),
    })

    expect(overview.json().last.summary).toEqual({
      imported: 2,
      unchanged: 0,
      unmatched: 0,
      personal: { changed: 0, unchanged: 0, skipped: 0 },
    })
    expect(
      getDb()
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.profileId, DAD))
        .all(),
    ).toHaveLength(2)

    const again = (await upload(DAD, body)).json()

    expect(again.preview.progress).toEqual({ new: 0, updated: 0, same: 2 })
    const repeated = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${again.id}/apply`,
      cookies: authed(),
      payload: { conflicts: 'newer' },
    })

    expect(repeated.json()).toMatchObject({ imported: 0, unchanged: 2 })

    const undone = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${applied.json().id}/undo`,
      cookies: authed(),
    })

    expect(undone.json()).toEqual({ restored: 3, kept: 0 })
    expect(
      getDb()
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.profileId, DAD))
        .all(),
    ).toHaveLength(0)
  })

  it('counts multiple episode positions and mine changes once per imported title', async () => {
    const beforeMine = getDb()
      .select()
      .from(profileTitles)
      .where(eq(profileTitles.profileId, DAD))
      .all()
    const document = JSON.parse(await profileExport(ANNA))

    document.progress = document.progress.filter(
      (row: { title: string }) => row.title === SHOW,
    )
    document.progress.push({
      ...document.progress[0],
      episode: 3,
      position: 500,
    })
    document.mine = [{ ...document.mine[0], title: SHOW }]
    const job = (await upload(DAD, JSON.stringify(document))).json()
    const applied = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
      cookies: authed(),
      payload: { conflicts: 'newer' },
    })

    expect(applied.statusCode).toBe(200)
    expect(applied.json()).toMatchObject({
      imported: 1,
      unchanged: 0,
      unmatched: 0,
    })
    expect(
      getDb()
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.profileId, DAD))
        .all(),
    ).toHaveLength(2)
    expect(
      getDb()
        .select()
        .from(profileTitles)
        .where(eq(profileTitles.profileId, DAD))
        .all(),
    ).toHaveLength(beforeMine.length + 1)
    const undone = await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${applied.json().id}/undo`,
      cookies: authed(),
    })

    expect(undone.json()).toEqual({ restored: 3, kept: 0 })
    expect(
      getDb()
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.profileId, DAD))
        .all(),
    ).toHaveLength(0)
    expect(
      getDb()
        .select()
        .from(profileTitles)
        .where(eq(profileTitles.profileId, DAD))
        .all(),
    ).toEqual(beforeMine)
  })

  it('carries the watched mark and derives it from files of older versions', async () => {
    const document = JSON.parse(await profileExport(ANNA))
    const base = document.progress[0]
    const row = (episode: number, extra: object) => ({
      ...base,
      title: SHOW,
      season: 2,
      episode,
      voiceStudio: null,
      voiceType: null,
      updatedAt: at(4).toISOString(),
      ...extra,
    })
    const old = (episode: number, position: number, duration: number) => {
      const { watchedAt: _, ...rest } = row(episode, { position, duration })

      return rest
    }

    document.progress.push(
      // Отметка с карточки прошлых версий — позиция 1 из 1
      old(1, 1, 1),
      old(2, 2300, 2400),
      old(3, 600, 2400),
      row(4, { position: 0, duration: null, watchedAt: at(3).toISOString() }),
    )

    const job = (await upload(DAD, JSON.stringify(document))).json()

    await app.inject({
      method: 'POST',
      url: `/api/profiles/${DAD}/imports/${job.id}/apply`,
      cookies: authed(),
      payload: { conflicts: 'newer' },
    })

    const rows = getDb()
      .select()
      .from(titleProgress)
      .where(and(eq(titleProgress.profileId, DAD), eq(titleProgress.season, 2)))
      .orderBy(titleProgress.episode)
      .all()

    expect(
      rows.map(({ episode, position, duration, watchedAt }) => ({
        episode,
        position,
        duration,
        watchedAt,
      })),
    ).toEqual([
      { episode: 1, position: 0, duration: null, watchedAt: at(4) },
      { episode: 2, position: 2300, duration: 2400, watchedAt: at(4) },
      { episode: 3, position: 600, duration: 2400, watchedAt: null },
      { episode: 4, position: 0, duration: null, watchedAt: at(3) },
    ])
  })

  it('sends a server export with several profiles to the settings', async () => {
    const res = await upload(DAD, await exportServer())

    expect(res.statusCode).toBe(400)
    expect(res.json().kind).toBe('serverExport')
  })
})

describe('library decisions', () => {
  // Пустая настоящая папка: скан после импорта проходит без ошибок
  const folderPath = mkdtempSync(join(tmpdir(), 'torsher-transfer-'))

  function seedLibrary() {
    const db = getDb()

    db.insert(libraries)
      .values({ id: 'lib-1', kind: 'video', name: 'Фильмы' })
      .run()
    db.insert(libraryFolders)
      .values({ id: 'folder-1', libraryId: 'lib-1', path: folderPath })
      .run()
    db.insert(mediaFiles)
      .values([
        {
          id: 'file-1',
          folderId: 'folder-1',
          relPath: 'Old Movie/old.mkv',
          size: 1,
          mtime: at(1),
          titleId: MOVIE,
          season: 0,
          episode: 0,
          matchStatus: 'matched',
          matchSource: 'user',
        },
        {
          id: 'file-2',
          folderId: 'folder-1',
          relPath: 'Parsed/parsed.mkv',
          size: 1,
          mtime: at(1),
          titleId: OTHER,
          matchStatus: 'matched',
          matchSource: 'parser',
        },
      ])
      .run()
  }

  it('carries manual matches and applies them to files after the scan', async () => {
    seedLibrary()

    const body = await exportServer()
    const document = JSON.parse(body)

    expect(document.libraries).toEqual([
      expect.objectContaining({
        name: 'Фильмы',
        folders: [{ path: folderPath, hint: 'auto' }],
        files: [
          expect.objectContaining({
            folder: folderPath,
            path: 'Old Movie/old.mkv',
            match: expect.objectContaining({ title: MOVIE, status: 'matched' }),
          }),
        ],
      }),
    ])

    getDb().delete(mediaFiles).run()
    getDb().delete(libraryFolders).run()
    getDb().delete(libraries).run()

    const { preview: shown, result } = await importServer(body)

    expect(shown.libraries).toMatchObject({
      folders: { new: 1, existing: 0 },
      missingFolders: [],
      decisions: 1,
    })
    expect(result).toMatchObject({ folders: 1, decisions: 0 })

    // Скан нашёл файл: решение из импорта ложится до матчера
    const folder = getDb().select().from(libraryFolders).get()!

    getDb()
      .insert(mediaFiles)
      .values({
        id: 'file-new',
        folderId: folder.id,
        relPath: 'Old Movie/old.mkv',
        size: 1,
        mtime: at(1),
      })
      .run()

    expect(applyPendingDecisions(folder.id, ['file-new'])).toEqual([])
    expect(
      getDb()
        .select()
        .from(mediaFiles)
        .where(eq(mediaFiles.id, 'file-new'))
        .get(),
    ).toMatchObject({ titleId: MOVIE, matchSource: 'user' })
  })

  it('applies a decision at once when the file is already on the server', async () => {
    seedLibrary()

    const body = await exportServer()

    getDb()
      .update(mediaFiles)
      .set({ titleId: OTHER, matchSource: 'parser' })
      .where(eq(mediaFiles.id, 'file-1'))
      .run()

    const { result } = await importServer(body)

    expect(result).toMatchObject({ folders: 0, decisions: 1 })
    expect(
      getDb()
        .select()
        .from(mediaFiles)
        .where(eq(mediaFiles.id, 'file-1'))
        .get(),
    ).toMatchObject({ titleId: MOVIE, matchSource: 'user' })
  })
})

describe('imported Torznab cookie validation', () => {
  it.each([
    'sid=secret\r\nHeader: secret',
    'sid=secret; cf_clearance=challenge',
    'not-a-cookie',
  ])(
    'rejects crafted protected cookies without exposing them',
    async (cookie) => {
      const password = 'export-password-1'
      const document = JSON.parse(await exportServer({ password }))
      const key = passwordKeyOf(password, document.encryption.salt)
      document.settings.indexers[0].sessionCookie = encryptWithPassword(
        key,
        cookie,
      )
      const result = await preview(JSON.stringify(document), password)
      expect(result.statusCode).toBe(400)
      expect(result.json().kind).toBe('broken')
      expect(result.body).not.toContain(cookie)
      expect(result.body).not.toContain('challenge')
    },
  )
  it('accepts old export files without the optional cookie field', async () => {
    const document = JSON.parse(await exportServer())
    delete document.settings.indexers[0].sessionCookie
    expect((await preview(JSON.stringify(document))).statusCode).toBe(200)
  })
  it('round-trips the maximum cookie size through password encryption', async () => {
    getDb()
      .update(indexers)
      .set({ sessionCookie: encryptSecret(`sid=${'x'.repeat(8188)}`) })
      .run()
    const body = await exportServer({ password: 'export-password-1' })
    expect((await preview(body, 'export-password-1')).statusCode).toBe(200)
  })
})

it('server transfer previews and restores title marks without changing progress', async () => {
  const mark = at(5)
  getDb()
    .insert(profileTitles)
    .values({ profileId: ANNA, titleId: SHOW, watchedMarkedAt: mark })
    .run()
  const body = await exportServer()
  getDb().delete(profileTitles).where(eq(profileTitles.titleId, SHOW)).run()
  const positions = getDb().select().from(titleProgress).all()
  const imported = await importServer(body)
  expect(
    imported.preview.profiles.find(
      (row: { name: string }) => row.name === 'Аня',
    ).counts.watched,
  ).toEqual({ new: 1, same: 0 })
  expect(
    getDb()
      .select()
      .from(profileTitles)
      .where(
        and(eq(profileTitles.profileId, ANNA), eq(profileTitles.titleId, SHOW)),
      )
      .get()
      ?.watchedMarkedAt,
  ).toEqual(mark)
  expect(getDb().select().from(titleProgress).all()).toEqual(positions)
})

describe('manager browser address transfer', () => {
  it.each(['prowlarr', 'jackett'] as const)(
    'round-trips %s and preserves the address of an existing connection',
    async (kind) => {
      const db = getDb()
      const browserUrl = 'https://manager.example/base/'
      db.insert(indexerManagers)
        .values({
          kind,
          url: 'http://manager.example:9696',
          apiKey: encryptSecret('manager-secret'),
          browserUrl,
        })
        .run()
      const body = await exportServer({ password: 'export-password-1' })
      const document = JSON.parse(body)
      expect(document.settings.managers[0].browserUrl).toBe(browserUrl)
      db.delete(indexerManagers).run()
      await importServer(body, { password: 'export-password-1' })
      expect(db.select().from(indexerManagers).get()).toMatchObject({
        kind,
        browserUrl,
      })
      expect(
        decryptSecret(db.select().from(indexerManagers).get()!.apiKey),
      ).toBe('manager-secret')

      db.update(indexerManagers)
        .set({ browserUrl: 'https://current.example' })
        .run()
      await importServer(body, { password: 'export-password-1' })
      expect(db.select().from(indexerManagers).get()?.browserUrl).toBe(
        'https://current.example',
      )

      delete document.settings.managers[0].browserUrl
      db.delete(indexerManagers).run()
      await importServer(JSON.stringify(document), {
        password: 'export-password-1',
      })
      expect(db.select().from(indexerManagers).get()?.browserUrl).toBeNull()
    },
  )
})
