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
  devices,
  indexerManagers,
  indexers,
  libraries,
  libraryFolders,
  mediaFiles,
  netRoutes,
  profileImports,
  profiles,
  profileTitles,
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
  rememberStartedSource,
  rememberVoice,
} from '../services/sources/progress.ts'
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
      version: 1,
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

  it('round-trips title marks in profile v1, preserves old v1 compatibility and restores marks through profile undo', async () => {
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
    const old = structuredClone(document)
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
    'legacy journal',
  ] as const)(
    'undo restores the factual source and preserves selection changes (%s)',
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
          : selection === 'same imported voice'
            || selection === 'round trip'
            || selection === 'legacy journal'
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
      if (selection === 'legacy journal') {
        const entry = db
          .select()
          .from(profileImports)
          .where(eq(profileImports.id, id))
          .get()!
        for (const item of entry.undo!) {
          if ('table' in item) {
            delete item.afterVoice
            delete item.afterVoiceRevision
          }
        }
        db.update(profileImports)
          .set({ undo: entry.undo })
          .where(eq(profileImports.id, id))
          .run()
      }
      const undone = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${id}/undo`,
        cookies: authed(),
      })
      expect(undone.statusCode).toBe(200)
      expect(db.select().from(titleProgress).where(where).get()).toEqual({
        ...before,
        mediaFileId,
        voiceStudio,
        voiceSelectionRevision:
          selection === 'unchanged' ? 0 : selection === 'round trip' ? 2 : 1,
      })
    },
  )

  it.each([false, true])(
    'keeps a new file choice while removing its imported view; explicit voice=%s',
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
      expect(
        (
          await app.inject({
            method: 'POST',
            url: `/api/profiles/${DAD}/imports/${applied.json().id}/undo`,
            cookies: authed(),
          })
        ).statusCode,
      ).toBe(200)
      expect(getTitleProgress(ref)).toMatchObject({
        mediaFileId: 'local-selected-file',
        voiceStudio: explicit ? 'Imported' : null,
        voiceSelectionRevision: explicit ? 1 : 0,
        position: 0,
        duration: null,
        watchedAt: null,
        lastPlayedAt: null,
        playedSource: null,
        updatedAt: imported.updatedAt,
      })
    },
  )

  it.each([
    { name: 'empty original voice', studio: null, type: null, legacy: false },
    { name: 'original voice', studio: 'Before', type: 'MVO', legacy: false },
    { name: 'legacy journal', studio: 'Before', type: 'MVO', legacy: true },
  ])(
    'undo keeps the later source-only choice with $name',
    async ({ studio, type, legacy }) => {
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
      if (legacy) {
        const where = eq(profileImports.id, id)
        const journal = db.select().from(profileImports).where(where).get()!.undo!
        for (const entry of journal) {
          if ('table' in entry)
            delete entry.afterVoiceRevision
        }
        db.update(profileImports).set({ undo: journal }).where(where).run()
      }
      const undone = await app.inject({
        method: 'POST',
        url: `/api/profiles/${DAD}/imports/${id}/undo`,
        cookies: authed(),
      })
      expect(undone.statusCode).toBe(200)
      expect(getTitleProgress(ref)).toMatchObject({
        mediaFileId: 'selected-file',
        position: 21,
        duration: 100,
        playedSource,
        voiceStudio: legacy ? 'Imported' : studio,
        voiceType: legacy ? 'DVO' : type,
        voiceSelectionRevision: 0,
        updatedAt: at(1),
      })
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

    expect(repeated.json()).toMatchObject({ imported: 0, unchanged: 3 })

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
