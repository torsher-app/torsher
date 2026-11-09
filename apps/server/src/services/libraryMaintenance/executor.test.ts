import { maintenanceOperationList } from './status.ts'
import { libraryStartupWithoutEngine } from './startup.ts'
import { createApp } from '../../app.ts'
import { ACCESS_TOKEN_COOKIE, config } from '../../config.ts'
import { createOwner } from '../users/index.ts'
import { signToken } from '../../utils/token.ts'
import {
  initializeMaintenanceRestoreHold,
  writeMaintenanceRestoreHold,
} from './restore.ts'
import {
  groupForTorrent,
  reconcileSourceEviction,
  recordDownload,
  recordPlaced,
  recordSourceInventory,
} from './provenance.ts'
import type { EngineMaintenanceOperation } from '../engine/client.ts'
import {
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { getDb, migrateDb } from '../../db/index.ts'
import {
  follows,
  libraries,
  libraryFolders,
  maintenanceFiles,
  maintenanceGroups,
  maintenanceOperations,
  maintenanceRules,
  maintenanceSuppressions,
  mediaFiles,
  profiles,
  profileTitles,
  titleProgress,
  torrents,
} from '../../db/schema.ts'
import { setEngineDown, setEngineReady } from '../engine/client.ts'
import { deleteSetting, setSetting } from '../settings/index.ts'
import {
  acquireMaintenanceExclusive,
  acquireMaintenanceLease,
  MaintenanceBusyError,
} from './admission.ts'
import { DAY } from './evaluate.ts'
import {
  acknowledgeMaintenanceRestore,
  maintenanceEngine,
  recoverMaintenance,
  retryMaintenanceOperation,
  runMaintenance,
  setMaintenanceExecution,
  stopMaintenanceScheduler,
} from './executor.ts'
import {
  inheritMaintenanceConfig,
  maintenanceConfig,
  previewDefaultMaintenance,
  previewMaintenance,
  protectGroup,
  saveMaintenanceConfig,
} from './index.ts'
import { hasSuppressed } from './suppression.ts'

const db = getDb()
const app = createApp()
let cookie: string
let root: string
let profileId: string
let serial = 0
const now = Date.now()
const engineOps = new Map<string, EngineMaintenanceOperation>()
beforeAll(async () => {
  await migrateDb()
  root = await realpath(
    await mkdtemp(join(tmpdir(), 'torsher-maintenance-executor-')),
  )
  const owner = await createOwner({
    username: 'maintenance-executor',
    passwordHash: 'synthetic-test-hash',
  })
  profileId = db.select().from(profiles).get()!.id
  cookie = `${ACCESS_TOKEN_COOKIE}=${signToken(owner.id, 'user_access')}`
  await app.ready()
})

beforeEach(async () => {
  stopMaintenanceScheduler()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.spyOn(config, 'dataDir', 'get').mockReturnValue(root)
  for (const table of [
    maintenanceSuppressions,
    maintenanceOperations,
    maintenanceFiles,
    maintenanceGroups,
    maintenanceRules,
    titleProgress,
    profileTitles,
    mediaFiles,
    follows,
    torrents,
    libraryFolders,
    libraries,
  ])
    db.delete(table).run()
  deleteSetting('maintenanceDefaultRule')
  setSetting('maintenanceRestoreHold', false)
  setSetting('maintenanceExecutionEnabled', false)
  setSetting('maintenanceExternalFences', [])
  setEngineReady('http://127.0.0.1:1')
  engineOps.clear()
  vi.spyOn(maintenanceEngine, 'list').mockImplementation(async () => [
    ...engineOps.values(),
  ])
  vi.spyOn(maintenanceEngine, 'prepare').mockImplementation(
    async (id, manifest) => {
      const current = engineOps.get(id)
      if (current)
        return structuredClone(current)
      const op: EngineMaintenanceOperation = {
        id,
        manifest,
        state: 'detached',
        results: {},
      }
      engineOps.set(id, op)
      const pending = db
        .select()
        .from(maintenanceSuppressions)
        .where(eq(maintenanceSuppressions.operationId, id))
        .all()
      expect(pending.length).toBeGreaterThan(0)
      expect(pending.every(row => row.status === 'pending')).toBe(true)
      return structuredClone(op)
    },
  )
  vi.spyOn(maintenanceEngine, 'unlink').mockImplementation(
    async (id, index) => {
      const op = engineOps.get(id)!
      const file = op.manifest.paths[index]!
      op.results[String(index)] = 'staged'
      op.state = 'deleting'
      try {
        await unlink(file.path)
      }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw error
      }
      op.results[String(index)] = 'removed'
      return structuredClone(op)
    },
  )
  vi.spyOn(maintenanceEngine, 'finalize').mockImplementation(async (id) => {
    expect(
      db
        .select()
        .from(maintenanceOperations)
        .where(eq(maintenanceOperations.id, id))
        .get()
        ?.state,
    ).toBe('cleaned')
    const op = engineOps.get(id)!
    op.state = 'finalized'
    return structuredClone(op)
  })
  vi.spyOn(maintenanceEngine, 'cancel').mockImplementation(async (id) => {
    const op = engineOps.get(id)!
    if (Object.keys(op.results).length)
      throw new Error('operation_partial')
    op.state = 'cancelled'
    return structuredClone(op)
  })
  await recoverMaintenance()
})
afterAll(async () => {
  stopMaintenanceScheduler()
  vi.useRealTimers()
  await app.close()
  setEngineDown('stopped')
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

async function fixture(
  options: {
    copy?: boolean
    orphan?: boolean
    movie?: boolean
    inherited?: boolean
  } = {},
) {
  const titleId = `tmdb:${options.movie ? 'movie' : 'tv'}:${++serial + 9000}`
  const base = join(root, String(serial))
  await mkdir(base)
  const sourceRoot = join(base, 'downloads')
  const libraryRoot = join(base, 'library')
  await mkdir(sourceRoot)
  await mkdir(libraryRoot)
  const name = options.movie ? 'Synthetic.Movie.mkv' : 'Synthetic.S01E01.mkv'
  const source = join(sourceRoot, name)
  const path = join(libraryRoot, name)
  await writeFile(source, 'test')
  if (options.copy)
    await copyFile(source, path)
  else await link(source, path)
  const alias = join(base, 'external-alias')
  await link(source, alias)
  const neighbor = join(libraryRoot, 'unowned.srt')
  await writeFile(neighbor, 'neighbor')
  const torrent = db
    .insert(torrents)
    .values({
      infoHash: serial.toString(16).padStart(40, '0'),
      name: 'Synthetic',
      source: 'file',
      status: 'ready',
      origin: 'follow',
      titleId,
      downloadDir: sourceRoot,
      selectedFiles: [0],
      files: [{ path: name, size: 4, padding: false }],
      pieceLength: 4,
    })
    .returning()
    .get()
  const library = db
    .insert(libraries)
    .values({ kind: 'video', name: 'Synthetic', managed: true })
    .returning()
    .get()
  const folder = db
    .insert(libraryFolders)
    .values({ libraryId: library.id, path: libraryRoot, status: 'ok' })
    .returning()
    .get()
  const stat = await lstat(path)
  const episode = {
    season: options.movie ? 0 : 1,
    episode: options.movie ? 0 : 1,
  }
  const media = db
    .insert(mediaFiles)
    .values({
      folderId: folder.id,
      relPath: name,
      size: 4,
      mtime: new Date(stat.mtimeMs),
      inode: stat.ino,
      torrentId: torrent.id,
      fileIndex: 0,
      titleId,
      ...episode,
      matchSource: 'torrent',
    })
    .returning()
    .get()
  recordDownload(torrent, 'follow')
  await recordPlaced({
    torrent,
    source,
    sourceRoot,
    path,
    root: libraryRoot,
    fileIndex: 0,
    mediaFileId: media.id,
    episodes: [episode],
    linkMode: options.copy ? 'copy' : 'hardlink',
  })
  const group = groupForTorrent(torrent.id)!
  db.update(maintenanceGroups)
    .set({
      seedRule: { mode: 'never' },
      completedAt: new Date(now - 3 * DAY),
      denominator: 4,
      uploaded: 0,
    })
    .where(eq(maintenanceGroups.id, group.id))
    .run()
  db.insert(follows)
    .values({
      titleId,
      kind: options.movie ? 'movie' : 'series',
      state: 'done',
      startSeason: episode.season,
      startEpisode: episode.episode,
      requireRussian: false,
      waitHours: 0,
    })
    .run()
  db.insert(titleProgress)
    .values({
      profileId,
      titleId,
      ...episode,
      position: 0,
      watchedAt: new Date(now - 3 * DAY),
      lastPlayedAt: new Date(0),
      mediaFileId: media.id,
      torrentId: torrent.id,
      fileIndex: 0,
    })
    .run()
  if (!options.inherited) {
    saveMaintenanceConfig(
      titleId,
      { enabled: true, days: 1, keepLast: null, profileIds: [profileId] },
      0,
    )
  }
  if (options.orphan) {
    await unlink(source)
    await reconcileSourceEviction(torrent.id)
    db.delete(torrents).where(eq(torrents.id, torrent.id)).run()
  }
  return {
    groupId: group.id,
    titleId,
    torrent,
    media,
    folder,
    path,
    source,
    sourceRoot,
    libraryRoot,
    alias,
    neighbor,
    episode,
  }
}
async function mature() {
  expect(setMaintenanceExecution(true)).toBe(true)
  await runMaintenance(now)
  await runMaintenance(now + DAY)
}

describe('maintenance executor', () => {
  it('does not treat an imported title mark as watched files', async () => {
    const f = await fixture()
    db.delete(titleProgress).run()
    db.insert(profileTitles)
      .values({
        profileId,
        titleId: f.titleId,
        watchedMarkedAt: new Date(now - 3 * DAY),
      })
      .run()
    const preview = await previewMaintenance(
      f.titleId,
      maintenanceConfig(f.titleId).rule,
      now,
    )
    expect(preview.groups[0]?.reasons).toContain('not_watched')
  })

  it('previews the common rule without saving, lists only exceptions and guards return by both revisions', async () => {
    const request = (
      method: 'GET' | 'POST' | 'PATCH',
      path: string,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method,
        url: `/api/library-maintenance/${path}`,
        headers: { cookie },
        payload,
      })
    const f = await fixture({ inherited: true })
    const base = {
      enabled: true,
      days: 2,
      keepLast: null,
      profileIds: [profileId],
    }
    expect(
      (await app.inject({ url: '/api/library-maintenance/default' }))
        .statusCode,
    ).toBe(401)
    expect(
      (await request('POST', 'default/preview', base)).json(),
    ).toMatchObject({ titleCount: 1 })
    expect((await request('GET', 'default')).json().rule).toMatchObject({
      enabled: false,
      revision: 0,
    })
    expect(
      (await request('PATCH', 'default', { ...base, expectedRevision: 0 }))
        .statusCode,
    ).toBe(200)
    expect(
      (await request('PATCH', 'default', { ...base, expectedRevision: 0 }))
        .statusCode,
    ).toBe(409)
    const title = `titles/${f.titleId}`
    expect((await request('GET', title)).json()).toMatchObject({
      inherited: true,
      rule: { days: 2 },
    })
    await request('PATCH', title, {
      ...base,
      enabled: false,
      expectedRevision: 0,
    })
    expect((await request('GET', 'status')).json().rules).toMatchObject([
      { titleId: f.titleId, enabled: false },
    ])
    expect(
      (await request('POST', 'default/preview', base)).json(),
    ).toMatchObject({ titleCount: 0, items: [] })
    expect(
      (await request('POST', `${title}/inherit/preview`)).json().groups[0]
        .candidate,
    ).toBe(true)
    expect(
      (
        await request('POST', `${title}/inherit`, {
          expectedRevision: 1,
          defaultRevision: 0,
        })
      ).statusCode,
    ).toBe(409)
    expect(
      (
        await request('POST', `${title}/inherit`, {
          expectedRevision: 1,
          defaultRevision: 1,
        })
      ).json(),
    ).toMatchObject({ inherited: true })
    expect((await request('GET', 'status')).json().rules).toEqual([])
  })
  it('inherits on new follows, skips exceptions and restarts grace after restoring the default', async () => {
    const local = await fixture()
    const rule = {
      enabled: true,
      days: 2,
      keepLast: 1,
      profileIds: [profileId],
    }
    saveMaintenanceConfig('default', rule, 0)
    const movie = await fixture({ movie: true, inherited: true })
    const series = await fixture({ inherited: true })
    expect(maintenanceConfig(movie.titleId)).toMatchObject({
      inherited: true,
      rule: { days: 2, keepLast: null },
    })
    expect(maintenanceConfig(local.titleId)).toMatchObject({
      inherited: false,
      rule: { days: 1 },
    })
    const before = db.$client.prepare('select total_changes() AS n').get()
    const preview = await previewDefaultMaintenance(rule)
    expect(preview.titleCount).toBe(2)
    expect(
      preview.items.find(item => item.titleId === movie.titleId)?.preview.groups[0]?.candidate,
    ).toBe(true)
    expect(
      preview.items.find(item => item.titleId === series.titleId)?.preview.groups[0]?.reasons,
    ).toContain('latest_episodes')
    expect(db.$client.prepare('select total_changes() AS n').get()).toEqual(
      before,
    )
    saveMaintenanceConfig(local.titleId, { ...rule, enabled: false }, 1)
    setMaintenanceExecution(true)
    await runMaintenance(now)
    await runMaintenance(now + DAY)
    await expect(lstat(movie.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(local.path, 'utf8')).toBe('test')
    expect(await readFile(series.path, 'utf8')).toBe('test')
    saveMaintenanceConfig('default', { ...rule, keepLast: null }, 1)
    expect(inheritMaintenanceConfig(local.titleId, 2, 1)).toBeUndefined()
    expect(inheritMaintenanceConfig(local.titleId, 2, 2)).toMatchObject({
      inherited: true,
      rule: { revision: 3 },
    })
    expect(saveMaintenanceConfig(local.titleId, rule, 2)).toBeUndefined()
    await runMaintenance(now + DAY)
    expect(await readFile(local.path, 'utf8')).toBe('test')
    vi.spyOn(Date, 'now').mockReturnValue(now + 2 * DAY)
    await runMaintenance(now + 2 * DAY)
    await expect(lstat(local.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each([
    { copy: false, orphan: false, movie: false },
    { copy: true, orphan: true, movie: true },
  ])(
    'cleans whole proven groups, preserves aliases/neighbors/history: %j',
    async (options) => {
      const f = await fixture(options)
      await mature()
      expect(db.select().from(maintenanceOperations).get()).toMatchObject({
        state: 'cleaned',
        engineStage: 'finalized',
      })
      expect(await readFile(f.alias, 'utf8')).toBe('test')
      expect(await readFile(f.neighbor, 'utf8')).toBe('neighbor')
      await expect(lstat(f.path)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(db.select().from(mediaFiles).all()).toHaveLength(0)
      expect(db.select().from(titleProgress).get()).toMatchObject({
        watchedAt: new Date(now - 3 * DAY),
        lastPlayedAt: new Date(0),
        mediaFileId: null,
        torrentId: null,
      })
      expect(hasSuppressed(f.titleId, [f.episode])).toBe(true)
    },
  )
  it('preview cannot start grace; live playback defers a mature group', async () => {
    const f = await fixture()
    await previewMaintenance(f.titleId, maintenanceConfig(f.titleId).rule, now)
    expect(db.select().from(maintenanceGroups).get()?.eligibleSince).toBeNull()
    setMaintenanceExecution(true)
    await runMaintenance(now)
    const release = acquireMaintenanceLease({ mediaFileId: f.media.id })
    await runMaintenance(now + DAY)
    expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
    release()
    await runMaintenance(now + DAY)
    expect(maintenanceEngine.prepare).toHaveBeenCalledOnce()
  })
  it('replay/profile policy and manual protection reset grace', async () => {
    const f = await fixture()
    setMaintenanceExecution(true)
    await runMaintenance(now)
    db.update(titleProgress)
      .set({ lastPlayedAt: new Date(now) })
      .run()
    await runMaintenance(now + DAY)
    expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
    expect(db.select().from(maintenanceGroups).get()?.eligibleSince).toEqual(
      new Date(now + DAY),
    )
    const group = db.select().from(maintenanceGroups).get()!
    protectGroup(group.id, true, group.revision)
    await runMaintenance(now + 2 * DAY)
    expect(db.select().from(maintenanceGroups).get()?.eligibleSince).toBeNull()
    expect(await readFile(f.path, 'utf8')).toBe('test')
  })
  it('a lost unlink response recovers results without deleting a second time', async () => {
    const f = await fixture()
    const original = maintenanceEngine.unlink
    vi.spyOn(maintenanceEngine, 'unlink').mockImplementationOnce(
      async (id, index) => {
        await original(id, index)
        throw new Error('response_lost')
      },
    )
    await mature()
    const op = db.select().from(maintenanceOperations).get()!
    expect(op.state).toBe('partial')
    expect(
      maintenanceOperationList().find(row => row.id === op.id)?.action,
    ).toBe('retry')
    expect(() => acquireMaintenanceLease({ mediaFileId: f.media.id })).toThrow(
      MaintenanceBusyError,
    )
    const response = await app.inject({
      method: 'POST',
      url: `/api/library-maintenance/operations/${op.id}/retry`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    expect(
      response.json().operations.find((row: { id: string }) => row.id === op.id)?.state,
    ).toBe('cleaned')
    expect(db.select().from(maintenanceOperations).get()?.state).toBe(
      'cleaned',
    )
  })
  it('global off cancels untouched pending work and does not continue partial deletion', async () => {
    await fixture()
    vi.spyOn(maintenanceEngine, 'unlink').mockRejectedValueOnce(
      new Error('disk_offline'),
    )
    await mature()
    setMaintenanceExecution(false)
    const count = vi.mocked(maintenanceEngine.unlink).mock.calls.length
    await recoverMaintenance()
    expect(vi.mocked(maintenanceEngine.unlink).mock.calls.length).toBe(count)
    expect(db.select().from(maintenanceOperations).get()?.state).toBe(
      'cancelled',
    )
  })
  it('exclusive admission rejects new opens and policy edits but leaves unrelated playback available', async () => {
    const f = await fixture()
    const release = acquireMaintenanceExclusive(f.groupId)
    expect(setMaintenanceExecution(false)).toBe(true)
    expect(() => acquireMaintenanceLease({ torrentId: f.torrent.id })).toThrow(
      MaintenanceBusyError,
    )
    expect(() =>
      saveMaintenanceConfig(f.titleId, maintenanceConfig(f.titleId).rule, 1),
    ).toThrow(MaintenanceBusyError)
    acquireMaintenanceLease({ titleId: 'tmdb:tv:999999' })()
    release()
  })
  it('restore review keeps cleanup off, retains point fences and releases unrelated producers', async () => {
    const f = await fixture()
    vi.spyOn(maintenanceEngine, 'unlink').mockImplementationOnce(
      async (id, index) => {
        const op = engineOps.get(id)!
        op.results[String(index)] = 'staged'
        op.state = 'deleting'
        throw new Error('captured_crash')
      },
    )
    await mature()
    setSetting('maintenanceRestoreHold', true)
    setSetting('maintenanceExecutionEnabled', false)
    expect(await acknowledgeMaintenanceRestore()).toBe(true)
    expect(() => acquireMaintenanceLease({ torrentId: f.torrent.id })).toThrow(
      MaintenanceBusyError,
    )
    acquireMaintenanceLease({ titleId: 'tmdb:tv:999999', producer: true })()
    expect(setMaintenanceExecution(false)).toBe(true)
  })
  it('missing newer and external episodes cannot displace an available managed tail', async () => {
    const f = await fixture()
    db.insert(mediaFiles)
      .values({
        folderId: f.folder.id,
        relPath: 'Missing.S02E01.mkv',
        size: 4,
        mtime: new Date(),
        inode: 123,
        titleId: f.titleId,
        season: 2,
        episode: 1,
      })
      .run()
    const preview = await previewMaintenance(
      f.titleId,
      { ...maintenanceConfig(f.titleId).rule, keepLast: 1 },
      now,
    )
    expect(
      preview.groups.find(group => group.id === f.groupId)?.reasons,
    ).toContain('latest_episodes')
    await rename(f.libraryRoot, `${f.libraryRoot}.gone`)
    const offline = await previewMaintenance(
      f.titleId,
      maintenanceConfig(f.titleId).rule,
      now,
    )
    expect(
      offline.groups.find(group => group.id === f.groupId)?.reasons,
    ).toContain('file_unavailable')
  })
  it('root replacement is never treated as an evicted source', async () => {
    const f = await fixture({ copy: true, orphan: true })
    await rename(f.sourceRoot, `${f.sourceRoot}.old`)
    await mkdir(f.sourceRoot)
    const preview = await previewMaintenance(
      f.titleId,
      maintenanceConfig(f.titleId).rule,
      now,
    )
    expect(
      preview.groups.find(group => group.id === f.groupId)?.reasons,
    ).toContain('file_unavailable')
    await mature()
    expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
  })
})

it('raw library/torrent requests cannot race past an exclusive lease', async () => {
  const f = await fixture()
  const release = acquireMaintenanceExclusive(f.groupId)
  try {
    for (const url of [
      `/api/library/files/${f.media.id}/stream`,
      `/api/stream/${f.torrent.id}/0`,
    ]) {
      const response = await app.inject({ url, headers: { cookie } })
      expect(response.statusCode).toBe(409)
      expect(response.json().message).toBe('maintenance_resource_held')
    }
  }
  finally {
    release()
  }
})
it('owner forget preserves files and adds durable manual protection', async () => {
  const f = await fixture()
  const response = await app.inject({
    method: 'DELETE',
    url: `/api/torrents/${f.torrent.id}?files=keep`,
    headers: { cookie },
  })
  expect(response.statusCode).toBe(200)
  expect(await readFile(f.path, 'utf8')).toBe('test')
  const preview = await previewMaintenance(
    f.titleId,
    maintenanceConfig(f.titleId).rule,
    now,
  )
  expect(
    preview.groups.find(group => group.id === f.groupId)?.reasons,
  ).toContain('manual_protection')
  await mature()
  expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
})
it('a restore marker from an old backup blocks producers before initialization and owner ack leaves cleanup off', async () => {
  writeMaintenanceRestoreHold(root)
  expect(() =>
    acquireMaintenanceLease({ titleId: 'tmdb:tv:999999', producer: true }),
  ).toThrow(MaintenanceBusyError)
  acquireMaintenanceLease({ titleId: 'tmdb:tv:999999' })()
  initializeMaintenanceRestoreHold(false)
  const toggle = await app.inject({
    method: 'PATCH',
    url: '/api/library-maintenance/execution',
    headers: { cookie },
    payload: { enabled: true },
  })
  expect(toggle.statusCode).toBe(409)
  const ack = await app.inject({
    method: 'POST',
    url: '/api/library-maintenance/restore/acknowledge',
    headers: { cookie },
  })
  expect(ack.statusCode).toBe(200)
  expect(ack.json()).toMatchObject({
    restoreHold: false,
    executorEnabled: false,
  })
  acquireMaintenanceLease({ titleId: 'tmdb:tv:999999', producer: true })()
})
it('old backup discovers newer fences; owner can cancel only those without filesystem intent', async () => {
  const f = await fixture()
  vi.spyOn(maintenanceEngine, 'unlink').mockImplementationOnce(
    async (id, index) => {
      const op = engineOps.get(id)!
      op.results[String(index)] = 'staged'
      op.state = 'deleting'
      throw new Error('captured_crash')
    },
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  db.delete(maintenanceOperations).run()
  db.delete(maintenanceSuppressions).run()
  await recoverMaintenance()
  const status = await app.inject({
    url: '/api/library-maintenance/status',
    headers: { cookie },
  })
  expect(status.json()).toMatchObject({
    restoreHold: true,
    executorEnabled: false,
    externalFences: [{ id: op.id, action: 'inspect_files' }],
  })
  const cancel = await app.inject({
    method: 'POST',
    url: `/api/library-maintenance/external-fences/${op.id}/cancel`,
    headers: { cookie },
  })
  expect(cancel.statusCode).toBe(409)
  const ack = await app.inject({
    method: 'POST',
    url: '/api/library-maintenance/restore/acknowledge',
    headers: { cookie },
  })
  expect(ack.statusCode).toBe(200)
  expect(() => acquireMaintenanceLease({ mediaFileId: f.media.id })).toThrow(
    MaintenanceBusyError,
  )
  expect(() => acquireMaintenanceLease({ titleId: f.titleId })).toThrow(
    MaintenanceBusyError,
  )
  acquireMaintenanceLease({ titleId: 'tmdb:tv:999999', producer: true })()
})
it('captures only metadata-owned extras while an unknown video blocks the entire group', async () => {
  const f = await fixture()
  const files = [
    ...f.torrent.files!,
    { path: 'README.txt', size: 4, padding: false },
    { path: 'Unknown.mkv', size: 4, padding: false },
  ]
  await writeFile(join(f.sourceRoot, 'README.txt'), 'text')
  await writeFile(join(f.sourceRoot, 'Unknown.mkv'), 'test')
  db.update(maintenanceGroups)
    .set({ torrentFiles: files })
    .where(eq(maintenanceGroups.id, f.groupId))
    .run()
  await recordSourceInventory({ ...f.torrent, files }, {
    fileProgress: [4, 4, 4],
  } as Parameters<typeof recordSourceInventory>[1])
  const owned = db.select().from(maintenanceFiles).all()
  expect(owned.some(file => file.path.endsWith('README.txt'))).toBe(true)
  expect(owned.some(file => file.path.endsWith('Unknown.mkv'))).toBe(false)
  const preview = await previewMaintenance(
    f.titleId,
    maintenanceConfig(f.titleId).rule,
    now,
  )
  expect(
    preview.groups.find(group => group.id === f.groupId)?.reasons,
  ).toContain('group_incomplete')
})

it.each([
  { index: 0, after: false },
  { index: 0, after: true },
  { index: 1, after: false },
  { index: 1, after: true },
])(
  'recovers the durable per-path checkpoint %j without harming aliases',
  async (failure) => {
    const f = await fixture()
    const original = vi
      .mocked(maintenanceEngine.unlink)
      .getMockImplementation()!
    let failed = false
    vi.spyOn(maintenanceEngine, 'unlink').mockImplementation(
      async (id, index) => {
        if (index === failure.index && !failed) {
          failed = true
          if (failure.after)
            await original(id, index)
          throw new Error('synthetic_checkpoint')
        }
        return original(id, index)
      },
    )
    await mature()
    const op = db.select().from(maintenanceOperations).get()!
    expect(op.state).toBe('partial')
    expect(await retryMaintenanceOperation(op.id)).toBe(true)
    expect(await readFile(f.alias, 'utf8')).toBe('test')
    expect(await readFile(f.neighbor, 'utf8')).toBe('neighbor')
  },
)
it('policy change after one confirmed unlink stops the remaining manifest', async () => {
  const f = await fixture()
  const original = maintenanceEngine.unlink
  vi.spyOn(maintenanceEngine, 'unlink').mockImplementationOnce(
    async (id, index) => {
      const result = await original(id, index)
      db.update(maintenanceRules).set({ enabled: false, revision: 2 }).run()
      return result
    },
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  expect(op).toMatchObject({ state: 'partial', error: 'policy_changed' })
  expect(Object.values(op.results)).toEqual(['removed'])
  expect(await retryMaintenanceOperation(op.id)).toBe(false)
  expect(await readFile(f.path, 'utf8')).toBe('test')
  expect(hasSuppressed(f.titleId, [f.episode])).toBe(true)
})
it('finalize failure keeps the fence after durable cleaned suppression and can be retried', async () => {
  const f = await fixture()
  vi.spyOn(maintenanceEngine, 'finalize').mockRejectedValueOnce(
    new Error('engine_offline'),
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  expect(op).toMatchObject({ state: 'cleaned', error: 'engine_offline' })
  expect(hasSuppressed(f.titleId, [f.episode])).toBe(true)
  expect(() =>
    acquireMaintenanceLease({ infoHash: f.torrent.infoHash }),
  ).toThrow(MaintenanceBusyError)
  expect(await retryMaintenanceOperation(op.id)).toBe(true)
  acquireMaintenanceLease({ infoHash: f.torrent.infoHash })()
})
it('loss of the live torrent FK alone is not proof of a safely evicted source', async () => {
  const f = await fixture({ copy: true })
  await unlink(f.source)
  db.delete(torrents).where(eq(torrents.id, f.torrent.id)).run()
  const preview = await previewMaintenance(
    f.titleId,
    maintenanceConfig(f.titleId).rule,
    now,
  )
  expect(
    preview.groups.find(group => group.id === f.groupId)?.reasons,
  ).toContain('file_unavailable')
})
it('an unsafe persisted JS inode cannot enter a deletion manifest', async () => {
  await fixture()
  db.update(maintenanceFiles)
    .set({ inode: Number.MAX_SAFE_INTEGER + 1 })
    .run()
  await mature()
  expect(maintenanceEngine.prepare).not.toHaveBeenCalled()
})

it('lost cleanup history requires review but finalized fences do not become permanent resource holds', async () => {
  const f = await fixture()
  await mature()
  db.delete(maintenanceOperations).run()
  db.delete(maintenanceSuppressions).run()
  await recoverMaintenance()
  const status = await app.inject({
    url: '/api/library-maintenance/status',
    headers: { cookie },
  })
  expect(status.json()).toMatchObject({
    restoreHold: true,
    lostCleanupHistory: true,
    executorEnabled: false,
    externalFences: [{ state: 'finalized', action: 'review_history' }],
  })
  const ack = await app.inject({
    method: 'POST',
    url: '/api/library-maintenance/restore/acknowledge',
    headers: { cookie },
  })
  expect(ack.statusCode).toBe(200)
  expect(ack.json()).toMatchObject({
    restoreHold: false,
    lostCleanupHistory: true,
    executorEnabled: false,
  })
  acquireMaintenanceLease({ infoHash: f.torrent.infoHash, producer: true })()
})
it('owner cancellation of an unknown fence without filesystem intent preserves files', async () => {
  const f = await fixture()
  vi.spyOn(maintenanceEngine, 'unlink').mockRejectedValueOnce(
    new Error('engine_offline'),
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  db.delete(maintenanceOperations).run()
  db.delete(maintenanceSuppressions).run()
  await recoverMaintenance()
  const response = await app.inject({
    method: 'POST',
    url: `/api/library-maintenance/external-fences/${op.id}/cancel`,
    headers: { cookie },
  })
  expect(response.statusCode).toBe(200)
  expect(response.json().externalFences).toEqual([])
  expect(await readFile(f.path, 'utf8')).toBe('test')
  expect(await readFile(f.source, 'utf8')).toBe('test')
})
it('reconciles a cancelled Go fence when the Node cancellation commit was lost', async () => {
  await fixture()
  vi.spyOn(maintenanceEngine, 'unlink').mockRejectedValueOnce(
    new Error('engine_offline'),
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  await maintenanceEngine.cancel(op.id)
  expect(await retryMaintenanceOperation(op.id)).toBe(false)
  expect(db.select().from(maintenanceOperations).get()?.state).toBe(
    'cancelled',
  )
  expect(db.select().from(maintenanceSuppressions).all()).toEqual([])
})

it('independent library startup inspects the actual local journal without requiring Go', async () => {
  setMaintenanceExecution(false)
  expect(await libraryStartupWithoutEngine()).toBe(true)
  const sessions = join(root, 'engine', 'state', 'torrents')
  await mkdir(sessions, { recursive: true })
  await writeFile(join(sessions, 'fixture.torrent'), 'synthetic')
  expect(await libraryStartupWithoutEngine()).toBe(false)
  await rm(join(sessions, 'fixture.torrent'))
  expect(await libraryStartupWithoutEngine()).toBe(true)
  const directory = join(root, 'engine', 'state', 'maintenance')
  await mkdir(directory, { recursive: true })
  await writeFile(
    join(directory, 'unknown.json'),
    JSON.stringify({ id: 'unknown', manifest: { paths: [] } }),
  )
  expect(await libraryStartupWithoutEngine()).toBe(false)
  await rm(join(directory, 'unknown.json'))
  await writeFile(join(directory, 'corrupt.json'), '{')
  expect(await libraryStartupWithoutEngine()).toBe(false)
})

it('async cancellation retains suppression until polling confirms guarded reattach', async () => {
  await fixture()
  vi.spyOn(maintenanceEngine, 'unlink').mockRejectedValueOnce(
    new Error('disk_offline'),
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  setMaintenanceExecution(false)
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  vi.spyOn(maintenanceEngine, 'cancel').mockImplementation(async (id) => {
    const reply = engineOps.get(id)!
    reply.state = 'reattaching'
    return structuredClone(reply)
  })
  vi.spyOn(maintenanceEngine, 'status').mockImplementation(async id =>
    structuredClone(engineOps.get(id)!),
  )
  await retryMaintenanceOperation(op.id)
  expect(db.select().from(maintenanceOperations).get()).toMatchObject({
    state: 'pending',
    engineStage: 'reattaching',
  })
  expect(db.select().from(maintenanceSuppressions).all()).not.toHaveLength(0)
  await vi.advanceTimersByTimeAsync(1000)
  expect(db.select().from(maintenanceSuppressions).all()).not.toHaveLength(0)
  engineOps.get(op.id)!.state = 'cancelled'
  await vi.advanceTimersByTimeAsync(1000)
  expect(db.select().from(maintenanceOperations).get()?.state).toBe(
    'cancelled',
  )
  expect(db.select().from(maintenanceSuppressions).all()).toHaveLength(0)
  expect(maintenanceEngine.cancel).toHaveBeenCalledTimes(1)
})
it('reattach error survives restart and requires explicit retry instead of automatic writes', async () => {
  await fixture()
  vi.spyOn(maintenanceEngine, 'unlink').mockRejectedValueOnce(
    new Error('disk_offline'),
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  const reply = engineOps.get(op.id)!
  reply.state = 'reattaching'
  reply.error = 'file_identity_changed'
  setMaintenanceExecution(false)
  await recoverMaintenance()
  expect(db.select().from(maintenanceOperations).get()).toMatchObject({
    state: 'blocked',
    engineStage: 'reattaching',
    error: 'file_identity_changed',
  })
  expect(maintenanceEngine.cancel).not.toHaveBeenCalled()
  expect(db.select().from(maintenanceSuppressions).all()).not.toHaveLength(0)
  await retryMaintenanceOperation(op.id)
  expect(maintenanceEngine.cancel).toHaveBeenCalledTimes(1)
  expect(db.select().from(maintenanceOperations).get()?.state).toBe(
    'cancelled',
  )
})

it('restart reconciles cancellation completed in Go before the last Node poll', async () => {
  await fixture()
  vi.spyOn(maintenanceEngine, 'unlink').mockRejectedValueOnce(
    new Error('disk_offline'),
  )
  await mature()
  const op = db.select().from(maintenanceOperations).get()!
  db.update(maintenanceOperations)
    .set({ engineStage: 'reattaching' })
    .where(eq(maintenanceOperations.id, op.id))
    .run()
  engineOps.get(op.id)!.state = 'cancelled'
  await recoverMaintenance()
  expect(db.select().from(maintenanceOperations).get()?.state).toBe(
    'cancelled',
  )
  expect(db.select().from(maintenanceSuppressions).all()).toHaveLength(0)
  expect(maintenanceEngine.cancel).not.toHaveBeenCalled()
})
