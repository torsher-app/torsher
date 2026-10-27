import { Buffer } from 'node:buffer'
import { mkdtempSync } from 'node:fs'
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
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  collectionHiddenProfiles,
  collections,
  collectionTitles,
  devices,
  indexers,
  libraries,
  libraryFolders,
  mediaFiles,
  netRoutes,
  profiles,
  profileTitles,
  titleAliases,
  titleProgress,
  titleVoices,
  users,
} from '../db/schema.ts'
import { decryptSecret, encryptSecret } from '../services/secrets/index.ts'
import { resetImportJobs } from '../services/transfer/imports.ts'
import { applyPendingDecisions } from '../services/transfer/libraryMatches.ts'
import {
  resetServerImports,
  serverImportDeps,
} from '../services/transfer/serverImport.ts'
import { signToken } from '../utils/token.ts'
import { readExportText } from './transfer.ts'

const app = createApp()

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
  })

  it('encrypts secrets with the export password only', async () => {
    const body = await exportServer({ password: 'export-password-1' })
    const document = JSON.parse(body)

    expect(body).not.toContain('indexer-secret-value')
    expect(document.encryption.kdf).toBe('scrypt')
    expect(document.settings.indexers[0].apiKey).toMatch(/^p1:/)
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

    expect(applied.json()).toMatchObject({ imported: 3 })
    expect(
      getDb()
        .select()
        .from(titleProgress)
        .where(eq(titleProgress.profileId, DAD))
        .all(),
    ).toHaveLength(2)

    const again = (await upload(DAD, body)).json()

    expect(again.preview.progress).toEqual({ new: 0, updated: 0, same: 2 })

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
