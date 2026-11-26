import type {
  EngineMaintenanceOperation,
  EngineTorrentState,
} from '../engine/client.ts'
import { Buffer } from 'node:buffer'
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { eq } from 'drizzle-orm'
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { createApp } from '../../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import {
  followEpisodes,
  follows,
  libraries,
  libraryFolders,
  maintenanceFiles,
  maintenanceGroups,
  maintenanceOperations,
  maintenanceSuppressions,
  mediaFiles,
  torrents,
} from '../../db/schema.ts'
import { signToken } from '../../utils/token.ts'
import * as engine from '../engine/client.ts'
import { createLibrary } from '../library/folders.ts'
import {
  acquireMaintenanceExclusive,
  acquireMaintenanceLease,
  MaintenanceBusyError,
} from '../libraryMaintenance/admission.ts'
import {
  maintenanceEngine,
  recoverMaintenance,
  retryMaintenanceOperation,
} from '../libraryMaintenance/executor.ts'
import { ownedIdentity } from '../libraryMaintenance/identity.ts'
import * as storage from '../storage/index.ts'
import { createOwner } from '../users/index.ts'
import {
  cleanupTitles,
  executeTitleCleanup,
  previewTitleCleanup,
} from './index.ts'

const db = getDb()
const example = 'tmdb:movie:991'
const orphan = 'tmdb:tv:992'
const other = 'tmdb:movie:993'
const hash = 'a'.repeat(40)
let root: string
let downloadRoot: string
let libraryRoot: string
let externalRoot: string
let managed: string
let external: string
let serial = 0
const operations = new Map<string, EngineMaintenanceOperation>()

function liveTorrent(): EngineTorrentState {
  return {
    infoHash: hash,
    dir: downloadRoot,
    paused: false,
    selected: [],
    high: [],
    bytesCompleted: 8192,
    bytesWanted: 8192,
    wantedCompleted: 8192,
    queued: false,
    seeding: false,
    uploaded: 0,
    peers: { connected: 0, found: 0, seeders: 0 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    fileProgress: [8192],
    badPieces: 0,
  }
}

beforeAll(async () => {
  await migrateDb()
  root = await realpath(
    await mkdtemp(join(tmpdir(), 'torsher-title-cleanup-')),
  )
})

beforeEach(async () => {
  vi.restoreAllMocks()
  operations.clear()
  for (const table of [
    maintenanceSuppressions,
    maintenanceOperations,
    maintenanceFiles,
    maintenanceGroups,
    followEpisodes,
    follows,
    mediaFiles,
    torrents,
    libraryFolders,
    libraries,
  ])
    db.delete(table).run()
  const fixtureRoot = join(root, String(++serial))
  downloadRoot = join(fixtureRoot, 'downloads')
  libraryRoot = join(fixtureRoot, 'library')
  externalRoot = join(fixtureRoot, 'external')
  for (const path of [downloadRoot, libraryRoot, externalRoot])
    await mkdir(path, { recursive: true })
  const local = db
    .insert(libraries)
    .values({ name: 'Managed', kind: 'video', managed: true })
    .returning()
    .get()
  const readOnly = db
    .insert(libraries)
    .values({ name: 'Read only', kind: 'video', managed: false })
    .returning()
    .get()
  managed = db
    .insert(libraryFolders)
    .values({ libraryId: local.id, path: libraryRoot })
    .returning()
    .get()
    .id
  external = db
    .insert(libraryFolders)
    .values({ libraryId: readOnly.id, path: externalRoot })
    .returning()
    .get()
    .id
  vi.spyOn(engine, 'isEngineReady').mockReturnValue(true)
  vi.spyOn(engine, 'listEngineTorrents').mockResolvedValue([liveTorrent()])
  vi.spyOn(maintenanceEngine, 'torrents').mockResolvedValue([liveTorrent()])
  vi.spyOn(maintenanceEngine, 'list').mockImplementation(async () => [
    ...operations.values(),
  ])
  vi.spyOn(maintenanceEngine, 'status').mockImplementation(async (id) => {
    const operation = operations.get(id)
    if (!operation) {
      throw new engine.EngineError('not_found', 'Operation not found', {
        engineCode: 'operation_not_found',
        status: 404,
      })
    }
    return structuredClone(operation)
  })
  vi.spyOn(maintenanceEngine, 'prepare').mockImplementation(
    async (id, manifest) => {
      const previous = operations.get(id)
      if (previous)
        return structuredClone(previous)
      const operation: EngineMaintenanceOperation = {
        id,
        manifest,
        state: 'detached',
        results: {},
      }
      operations.set(id, operation)
      return structuredClone(operation)
    },
  )
  vi.spyOn(maintenanceEngine, 'unlink').mockImplementation(
    async (id, index) => {
      const operation = operations.get(id)!
      await unlink(operation.manifest.paths[index]!.path)
      operation.results[index] = 'removed'
      operation.state = 'deleting'
      return structuredClone(operation)
    },
  )
  vi.spyOn(maintenanceEngine, 'finalize').mockImplementation(async (id) => {
    const operation = operations.get(id)!
    operation.state = 'finalized'
    return structuredClone(operation)
  })
})

afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

function insertTorrent(isPrivate = false) {
  const name = 'Synthetic title.mkv'
  const row = db
    .insert(torrents)
    .values({
      titleId: example,
      name,
      infoHash: hash,
      source: 'file',
      retention: 'keep',
      status: 'ready',
      inEngine: true,
      downloadDir: downloadRoot,
      isPrivate,
      files: [{ path: name, size: 8192, padding: false }],
    })
    .returning()
    .get()
  const path = join(downloadRoot, name)
  vi.spyOn(engine, 'getMaintenanceTorrentFiles').mockResolvedValue({
    root: downloadRoot,
    paths: [path, `${path}.part`],
    pieceCount: 4,
    private: isPrivate,
  })
  return { row, path }
}

async function insertLibrary(
  titleId: string,
  options: {
    from?: string
    torrentId?: string
    writable?: boolean
    relPath?: string
  } = {},
) {
  const relPath
    = options.relPath
      ?? `shows/Synthetic ${titleId.split(':').at(-1)}/Demo episode.mkv`
  const path = join(
    options.writable === false ? externalRoot : libraryRoot,
    relPath,
  )
  await mkdir(dirname(path), { recursive: true })
  if (options.from)
    await link(options.from, path)
  else await writeFile(path, new Uint8Array(8192))
  const info = await stat(path)
  const row = db
    .insert(mediaFiles)
    .values({
      folderId: options.writable === false ? external : managed,
      relPath,
      titleId,
      torrentId: options.torrentId,
      inode: info.ino,
      size: info.size,
      mtime: info.mtime,
      season: 1,
      episode: 3,
    })
    .returning()
    .get()
  return { path, row }
}

const content = new Uint8Array(8192).fill(1)
function pathExists(path: string) {
  return stat(path).then(
    () => true,
    () => false,
  )
}

describe('ручная очистка тайтлов', () => {
  it('группирует кэш, сохранённую копию и тайтл без раздачи, учитывает блоки хардлинка один раз', async () => {
    const { row, path } = insertTorrent()
    await writeFile(path, content)
    const managedCopy = await insertLibrary(example, {
      from: path,
      torrentId: row.id,
    })
    const orphaned = await insertLibrary(orphan)
    const readOnly = await insertLibrary(other, { writable: false })
    expect((await cleanupTitles()).items.map(item => item.id).sort()).toEqual(
      [example, orphan],
    )
    const preview = await previewTitleCleanup([example, orphan])
    expect(preview.reclaimableBytes).toBe(
      (await stat(path)).blocks * 512
      + (await stat(orphaned.path)).blocks * 512,
    )
    const [first, second] = preview.items
    expect(first?.files.map(file => file.kind)).toEqual([
      'download',
      'library',
    ])
    expect(second?.files.map(file => file.kind)).toEqual(['library'])
    const result = await executeTitleCleanup(
      preview.items.map(item => ({
        id: item.id,
        fingerprint: item.fingerprint!,
      })),
    )
    expect(result.items.map(item => item.status)).toEqual([
      'deleted',
      'deleted',
    ])
    expect(
      await Promise.all(
        [path, managedCopy.path, orphaned.path, readOnly.path].map(pathExists),
      ),
    ).toEqual([false, false, false, true])
    expect(db.select().from(torrents).all()).toHaveLength(0)
    expect(
      db
        .select()
        .from(maintenanceSuppressions)
        .all()
        .map(item => [item.titleId, item.episode, item.status]),
    ).toEqual([
      [example, 0, 'cleaned'],
      [orphan, 3, 'cleaned'],
    ])
  })

  it('показывает .part, сохраняет чужую ссылку и отклоняет устаревший снимок', async () => {
    const { path } = insertTorrent()
    await writeFile(`${path}.part`, content)
    const readOnly = await insertLibrary(other, {
      writable: false,
      from: `${path}.part`,
    })
    const preview = await previewTitleCleanup([example])
    expect(preview.items[0]?.files[0]?.path).toMatch(/\.part$/)
    expect(preview.reclaimableBytes).toBe(0)
    await writeFile(path, content)
    const result = await executeTitleCleanup([
      { id: example, fingerprint: preview.items[0]!.fingerprint! },
    ])
    expect(result.items[0]?.status).toBe('stale')
    expect(await readFile(path)).toHaveLength(8192)
    expect(await readFile(readOnly.path)).toHaveLength(8192)
    expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
  })

  it('не захватывает смешанную раздачу и приватную с действующим обязательством', async () => {
    const { row } = insertTorrent()
    await insertLibrary(other, { torrentId: row.id })
    expect((await previewTitleCleanup([example])).items[0]).toMatchObject({
      reason: 'conflict',
      fingerprint: null,
    })
    db.delete(mediaFiles).run()
    db.delete(torrents).run()
    insertTorrent(true)
    expect((await previewTitleCleanup([example])).items[0]).toMatchObject({
      reason: 'private',
      fingerprint: null,
    })
    expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
  })

  it('захватывает эксклюзивную аренду и оставляет открытый файл', async () => {
    const { path } = await insertLibrary(orphan)
    const preview = await previewTitleCleanup([orphan])
    const release = acquireMaintenanceLease({ titleId: orphan })
    try {
      const result = await executeTitleCleanup([
        { id: orphan, fingerprint: preview.items[0]!.fingerprint! },
      ])
      expect(result.items[0]?.status).toBe('blocked')
      expect(await pathExists(path)).toBe(true)
    }
    finally {
      release()
    }
  })

  it('сохраняет библиотечный файл, доступный через подключённую папку с другим путём', async () => {
    const { path } = await insertLibrary(orphan)
    await rm(externalRoot, { recursive: true })
    await symlink(libraryRoot, externalRoot)
    const preview = await previewTitleCleanup([orphan])
    expect(preview.items[0]).toMatchObject({
      fingerprint: null,
      reason: 'conflict',
    })
    expect(await pathExists(path)).toBe(true)
  })

  it('сохраняет индексированную внешнюю запись, даже когда общий каталог находится ниже подключённого корня', async () => {
    const { row, path } = await insertLibrary(orphan)
    await symlink(libraryRoot, join(externalRoot, 'nested-alias'))
    db.insert(mediaFiles)
      .values({
        folderId: external,
        relPath: `nested-alias/${row.relPath}`,
        titleId: other,
        size: row.size,
        mtime: row.mtime,
      })
      .run()
    expect((await previewTitleCleanup([orphan])).items[0]).toMatchObject({
      fingerprint: null,
      reason: 'conflict',
    })
    expect(await pathExists(path)).toBe(true)
  })

  it('не присваивает новый файл по метаданным неактивной раздачи и очищает библиотеку, если загрузка уже пуста', async () => {
    const { row, path } = insertTorrent()
    await writeFile(path, content)
    const ownership = (await ownedIdentity(downloadRoot, path))!
    const original = await insertLibrary(example, {
      from: path,
      torrentId: row.id,
    })
    const group = db
      .insert(maintenanceGroups)
      .values({
        titleId: example,
        initialInfoHash: row.infoHash,
        torrentFiles: row.files!,
        pieceCount: 4,
        sourceRoot: downloadRoot,
        sourceRootDevice: ownership.rootDevice,
        sourceRootInode: ownership.rootInode,
        torrentId: row.id,
        origin: 'manual',
        selectedFiles: [],
      })
      .returning()
      .get()
    db.insert(maintenanceFiles)
      .values({
        ...ownership,
        groupId: group.id,
        kind: 'source',
        fileIndex: 0,
        episodes: [],
      })
      .run()
    db.update(torrents)
      .set({ inEngine: false, torrentFile: Buffer.from('synthetic-metadata') })
      .where(eq(torrents.id, row.id))
      .run()
    vi.mocked(engine.listEngineTorrents).mockResolvedValue([])
    vi.spyOn(engine, 'getStoredMaintenanceTorrentFiles').mockResolvedValue({
      root: downloadRoot,
      paths: [path, `${path}.part`],
      pieceCount: 4,
      private: false,
    })
    expect(
      (await previewTitleCleanup([example])).items[0]?.files.map(
        file => file.kind,
      ),
    ).toEqual(['download', 'library'])
    await rename(path, `${path}.original`)
    await writeFile(path, content)
    expect((await previewTitleCleanup([example])).items[0]).toMatchObject({
      fingerprint: null,
      reason: 'conflict',
    })
    expect(await pathExists(path)).toBe(true)
    expect(await pathExists(original.path)).toBe(true)
    expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
    await unlink(path)
    const release = vi.spyOn(storage, 'releaseTorrentSpace')
    const pending = vi
      .spyOn(storage, 'hasPendingTorrentSpace')
      .mockReturnValueOnce(true)
    expect((await previewTitleCleanup([example])).items[0]?.reason).toBe(
      'busy',
    )
    pending.mockRestore()
    const preview = (await previewTitleCleanup([example])).items[0]!
    expect(preview.files.map(file => file.kind)).toEqual(['library'])
    expect(
      (
        await executeTitleCleanup([
          { id: example, fingerprint: preview.fingerprint! },
        ])
      ).items[0]?.status,
    ).toBe('deleted')
    expect(release).toHaveBeenCalledWith(row.id)
    expect(await pathExists(`${path}.original`)).toBe(true)
    expect(await pathExists(original.path)).toBe(false)
  })

  it('сохраняет запрет только для серии, которую слежение уже привязало к удаляемой раздаче', async () => {
    const { row, path } = insertTorrent()
    db.update(torrents)
      .set({ titleId: orphan })
      .where(eq(torrents.id, row.id))
      .run()
    await writeFile(`${path}.part`, content)
    const rule = db
      .insert(follows)
      .values({
        titleId: orphan,
        kind: 'series',
        state: 'active',
        startSeason: 1,
        startEpisode: 1,
        requireRussian: false,
        waitHours: 0,
      })
      .returning()
      .get()
    db.insert(followEpisodes)
      .values([
        {
          followId: rule.id,
          season: 1,
          episode: 3,
          firstSeenAt: new Date(),
          torrentId: row.id,
        },
        { followId: rule.id, season: 1, episode: 4, firstSeenAt: new Date() },
      ])
      .run()
    const preview = (await previewTitleCleanup([orphan])).items[0]!
    expect(
      (
        await executeTitleCleanup([
          { id: orphan, fingerprint: preview.fingerprint! },
        ])
      ).items[0]?.status,
    ).toBe('deleted')
    expect(
      db
        .select()
        .from(maintenanceSuppressions)
        .all()
        .map(row => row.episode),
    ).toEqual([3])
    expect(
      db.select().from(follows).where(eq(follows.id, rule.id)).get()?.state,
    ).toBe('active')
  })

  it('повтором завершает удаление старой строки после сбоя записи в SQLite', async () => {
    const { path, row } = await insertLibrary(orphan)
    const first = (await previewTitleCleanup([orphan])).items[0]!
    db.$client.exec(
      'CREATE TEMP TRIGGER fail_cleanup BEFORE DELETE ON media_files BEGIN SELECT RAISE(ABORT, \'synthetic disk failure\'); END',
    )
    let id: string
    try {
      const outcome = (
        await executeTitleCleanup([
          { id: orphan, fingerprint: first.fingerprint! },
        ])
      ).items[0]!
      expect(outcome.status).toBe('partial')
      id = outcome.operationIds[0]!
      expect(id).toBeTruthy()
    }
    finally {
      db.$client.exec('DROP TRIGGER fail_cleanup')
    }
    expect(await pathExists(path)).toBe(false)
    expect(
      db.select().from(mediaFiles).where(eq(mediaFiles.id, row.id)).get(),
    ).toBeTruthy()
    const pending = db
      .select()
      .from(maintenanceOperations)
      .where(eq(maintenanceOperations.id, id))
      .get()!
    expect(pending.groupId).toBe(`manual-library:${id}`)
    expect(pending.manifest.libraryOnly).toBe(true)
    expect(await retryMaintenanceOperation(id)).toBe(true)
    expect(maintenanceEngine.unlink).toHaveBeenCalledTimes(1)
    expect(
      db.select().from(mediaFiles).where(eq(mediaFiles.id, row.id)).get(),
    ).toBeUndefined()
  })

  it('сохраняет подтверждённый partial, пассивно восстанавливает журнал и повторяет только остаток', async () => {
    const { row, path } = insertTorrent()
    await writeFile(path, content)
    const copy = await insertLibrary(example, {
      from: path,
      torrentId: row.id,
    })
    const preview = await previewTitleCleanup([example])
    const realUnlink = maintenanceEngine.unlink
    vi.mocked(maintenanceEngine.unlink).mockImplementation(
      async (id, index) => {
        if (index === 1)
          throw new Error('temporary filesystem error')
        const op = operations.get(id)!
        await unlink(op.manifest.paths[index]!.path)
        op.results[index] = 'removed'
        return structuredClone(op)
      },
    )
    const result = await executeTitleCleanup([
      { id: example, fingerprint: preview.items[0]!.fingerprint! },
    ])
    expect(result.items[0]?.status).toBe('partial')
    const id = result.items[0]!.operationIds[0]!
    expect(id).toBeTruthy()
    expect(await pathExists(path)).toBe(false)
    expect(await pathExists(copy.path)).toBe(true)
    expect(
      db.select().from(torrents).where(eq(torrents.id, row.id)).get(),
    ).toBeTruthy()
    await recoverMaintenance()
    expect(
      db
        .select()
        .from(maintenanceOperations)
        .where(eq(maintenanceOperations.id, id))
        .get()
        ?.state,
    ).toBe('partial')
    await rm(externalRoot, { recursive: true })
    await symlink(dirname(copy.path), externalRoot)
    expect(await retryMaintenanceOperation(id)).toBe(false)
    expect(await pathExists(copy.path)).toBe(true)
    await unlink(externalRoot)
    vi.mocked(realUnlink).mockImplementation(async (opId, index) => {
      expect(index).toBe(1)
      const op = operations.get(opId)!
      await unlink(op.manifest.paths[index]!.path)
      op.results[index] = 'removed'
      return structuredClone(op)
    })
    expect(await retryMaintenanceOperation(id)).toBe(true)
    expect(await pathExists(copy.path)).toBe(false)
    expect(
      db.select().from(torrents).where(eq(torrents.id, row.id)).get(),
    ).toBeUndefined()
  })

  it('при повторе библиотечного удаления исключает removed и защищает staged через появившийся внешний индекс', async () => {
    const first = await insertLibrary(orphan, { relPath: 'First/First.mkv' })
    const second = await insertLibrary(orphan, {
      relPath: 'Second/Second.mkv',
    })
    const preview = (await previewTitleCleanup([orphan])).items[0]!
    const mock = vi.mocked(maintenanceEngine.unlink)
    mock.mockImplementation(async (id, index) => {
      const op = operations.get(id)!
      op.state = 'deleting'
      if (index === 1) {
        op.results[index] = 'staged'
        throw new Error('temporary filesystem error')
      }
      await unlink(op.manifest.paths[index]!.path)
      op.results[index] = 'removed'
      return structuredClone(op)
    })
    const result = (
      await executeTitleCleanup([
        { id: orphan, fingerprint: preview.fingerprint! },
      ])
    ).items[0]!
    const id = result.operationIds[0]!
    expect(result.status).toBe('partial')
    const remaining = [first, second].find(
      item => item.path === operations.get(id)?.manifest.paths[1]?.path,
    )!
    const removed = remaining === first ? second : first
    await symlink(libraryRoot, join(externalRoot, 'mounted'))
    for (const item of [removed, remaining]) {
      db.insert(mediaFiles)
        .values({
          folderId: external,
          relPath: `mounted/${item.row.relPath}`,
          titleId: other,
          size: item.row.size,
          mtime: item.row.mtime,
        })
        .run()
    }
    expect(await retryMaintenanceOperation(id)).toBe(false)
    expect(mock).toHaveBeenCalledTimes(2)
    expect(await pathExists(remaining.path)).toBe(true)
    db.delete(mediaFiles)
      .where(eq(mediaFiles.relPath, `mounted/${remaining.row.relPath}`))
      .run()
    mock.mockImplementation(async (opId, index) => {
      expect(index).toBe(1)
      const op = operations.get(opId)!
      await unlink(op.manifest.paths[index]!.path)
      op.results[index] = 'removed'
      return structuredClone(op)
    })
    expect(await retryMaintenanceOperation(id)).toBe(true)
  })

  it('не публикует новую внешнюю папку, пока выполняется ручная очистка', async () => {
    const newRoot = join(externalRoot, 'new')
    await mkdir(newRoot)
    const release = acquireMaintenanceExclusive({
      titleId: orphan,
      libraryTopology: true,
    })
    try {
      await expect(
        createLibrary({ kind: 'video', name: 'New', path: newRoot }),
      ).rejects.toBeInstanceOf(MaintenanceBusyError)
      expect(
        db
          .select()
          .from(libraryFolders)
          .where(eq(libraryFolders.path, newRoot))
          .get(),
      ).toBeUndefined()
    }
    finally {
      release()
    }
  })

  it('освобождает локальный intent, если конфликт движка произошёл до записи fence', async () => {
    const { path } = await insertLibrary(orphan)
    const preview = (await previewTitleCleanup([orphan])).items[0]!
    vi.mocked(maintenanceEngine.prepare).mockRejectedValueOnce(
      new engine.EngineError('failed', 'Conflict', {
        engineCode: 'path_conflict',
        status: 409,
      }),
    )
    const result = (
      await executeTitleCleanup([
        { id: orphan, fingerprint: preview.fingerprint! },
      ])
    ).items[0]!
    expect(result.operationIds).toEqual([])
    expect(await pathExists(path)).toBe(true)
    expect(db.select().from(maintenanceOperations).get()?.state).toBe(
      'cancelled',
    )
    expect((await previewTitleCleanup([orphan])).items[0]?.reason).toBeNull()
  })

  it('открывает API только владельцу', async () => {
    const app = createApp()
    const owner = await createOwner({
      username: 'test-cleanup',
      passwordHash: 'synthetic-test-hash',
    })
    try {
      const url = '/api/torrents/cleanup/titles'
      expect((await app.inject({ url })).statusCode).toBe(401)
      expect(
        (
          await app.inject({
            url,
            cookies: {
              [ACCESS_TOKEN_COOKIE]: signToken(owner.id, 'user_access'),
            },
          })
        ).statusCode,
      ).toBe(200)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/torrents/cleanup/execute',
            payload: { items: [{ id: example, path: '/etc' }] },
            cookies: {
              [ACCESS_TOKEN_COOKIE]: signToken(owner.id, 'user_access'),
            },
          })
        ).statusCode,
      ).toBe(400)
    }
    finally {
      await app.close()
    }
  })
})
