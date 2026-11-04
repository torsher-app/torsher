import { startGrab } from '../follow/grab.ts'
import {
  getTitleProgress,
  markWatched,
  saveTitleProgress,
} from '../sources/progress.ts'
import {
  follows,
  maintenanceFiles,
  maintenanceGroups,
  maintenanceRules,
  maintenanceSuppressions,
  profiles,
  torrents,
} from '../../db/schema.ts'
import {
  copyFile,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../app.ts'
import { ACCESS_TOKEN_COOKIE } from '../../config.ts'
import { getDb, migrateDb } from '../../db/index.ts'
import { createOwner } from '../users/index.ts'
import { signToken } from '../../utils/token.ts'
import {
  groupForTorrent,
  protectTorrent,
  recordDownload,
  recordPlaced,
  recordSeeding,
} from './provenance.ts'
import {
  allowRedownload,
  hasSuppressed,
  suppressedFileIndexes,
} from './suppression.ts'
import { heldFileIndexes } from '../library/files.ts'

const app = createApp()
const db = getDb()
let cookie: string
let profileId: string
let root: string
beforeAll(async () => {
  await migrateDb()
  const owner = await createOwner({
    username: 'maintenance-owner',
    passwordHash: 'unused-test-hash',
  })
  cookie = `${ACCESS_TOKEN_COOKIE}=${signToken(owner.id, 'user_access')}`
  profileId = db.select().from(profiles).get()!.id
  root = await realpath(await mkdtemp(join(tmpdir(), 'torsher-maintenance-')))
  await app.ready()
})
afterAll(async () => {
  await app.close()
  if (root)
    await rm(root, { recursive: true, force: true })
})
const url = '/api/library-maintenance/titles/tmdb:tv:901'
function rule() {
  return {
    enabled: true,
    days: 2,
    keepLast: null,
    profileIds: [profileId],
  }
}
describe('owner-only maintenance API', () => {
  it('checks auth before malformed body validation and rejects cross-site writes', async () => {
    expect(
      (await app.inject({ method: 'POST', url: `${url}/preview`, payload: {} }))
        .statusCode,
    ).toBe(401)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `${url}/preview`,
          headers: {
            cookie,
            'sec-fetch-site': 'cross-site',
            'origin': 'https://example.invalid',
          },
          payload: rule(),
        })
      ).statusCode,
    ).toBe(403)
  })
  it('saves with optimistic revision and requires roster confirmation', async () => {
    const read = await app.inject({ url, headers: { cookie } })
    expect(read.json().rule).toMatchObject({
      enabled: false,
      revision: 0,
      keepLast: null,
    })
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers: { cookie },
          payload: { ...rule(), expectedRevision: 0 },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers: { cookie },
          payload: { ...rule(), expectedRevision: 0 },
        })
      ).statusCode,
    ).toBe(409)
    db.insert(profiles)
      .values({ name: 'Second', color: 'blue', position: 10 })
      .run()
    expect(
      (await app.inject({ url, headers: { cookie } })).json().rule
        .rosterChanged,
    ).toBe(true)
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url,
          headers: { cookie },
          payload: { ...rule(), expectedRevision: 1 },
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (await app.inject({ url, headers: { cookie } })).json().rule
        .rosterChanged,
    ).toBe(false)
  })
  it('previews unsaved rules without a DB mutation or any network access', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('preview network forbidden'))
    const before = db.$client.prepare('SELECT total_changes() AS count').get()
    const stored = db.select().from(maintenanceRules).all()
    const response = await app.inject({
      method: 'POST',
      url: `${url}/preview`,
      headers: { cookie },
      payload: { ...rule(), days: 100 },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      executorAvailable: false,
      estimate: true,
    })
    expect(db.$client.prepare('SELECT total_changes() AS count').get()).toEqual(
      before,
    )
    expect(db.select().from(maintenanceRules).all()).toEqual(stored)
    expect(network).not.toHaveBeenCalled()
    network.mockRestore()
    expect(
      (
        await app.inject({
          url: '/api/library-maintenance/status',
          headers: { cookie },
        })
      ).json(),
    ).toMatchObject({ executorAvailable: false, executorEnabled: false })
  })
})

describe('durable provenance and suppression', () => {
  it('preserves exact copy ownership, manual protection and seed evidence after torrent removal', async () => {
    const sourceRoot = join(root, 'downloads')
    const libraryRoot = join(root, 'library')
    await mkdir(sourceRoot)
    await mkdir(libraryRoot)
    const row = db
      .insert(torrents)
      .values({
        infoHash: 'a'.repeat(40),
        downloadDir: sourceRoot,
        name: 'Synthetic.S01E01',
        source: 'file',
        status: 'ready',
        titleId: 'tmdb:tv:901',
        origin: 'follow',
        selectedFiles: [0],
        files: [{ path: 'Synthetic.S01E01.mkv', size: 4, padding: false }],
        pieceLength: 4,
      })
      .returning()
      .get()
    recordDownload(row, 'follow')
    const source = join(sourceRoot, 'Synthetic.S01E01.mkv')
    const path = join(libraryRoot, 'Synthetic.S01E01.mkv')
    await writeFile(source, 'test')
    await copyFile(source, path)
    await recordPlaced({
      torrent: row,
      source,
      sourceRoot,
      path,
      root: libraryRoot,
      fileIndex: 0,
      mediaFileId: 'synthetic-media',
      episodes: [{ season: 1, episode: 1 }],
      linkMode: 'copy',
    })
    const state = {
      uploaded: 8,
      bytesWanted: 4,
      bytesCompleted: 4,
      wantedCompleted: 4,
    } as Parameters<typeof recordSeeding>[1]
    recordSeeding(
      { ...row, retention: 'keep', seedRule: { mode: 'ratio', ratio: 2 } },
      state,
    )
    const group = groupForTorrent(row.id)!
    expect(group).toMatchObject({
      pieceCount: 1,
      denominator: 4,
      uploaded: 8,
      seedRule: { mode: 'ratio', ratio: 2 },
    })
    protectTorrent(row.id)
    db.delete(torrents).where(eq(torrents.id, row.id)).run()
    expect(
      db
        .select()
        .from(maintenanceGroups)
        .where(eq(maintenanceGroups.id, group.id))
        .get(),
    ).toMatchObject({
      torrentId: null,
      manualProtection: true,
      initialInfoHash: row.infoHash,
      denominator: 4,
    })
    expect(
      db
        .select()
        .from(maintenanceFiles)
        .where(eq(maintenanceFiles.groupId, group.id))
        .all(),
    ).toHaveLength(2)
    const response = await app.inject({
      method: 'PATCH',
      url: `/api/library-maintenance/groups/${group.id}/protection`,
      headers: { cookie },
      payload: { protected: true, expectedRevision: group.revision + 1 },
    })
    expect(response.statusCode).toBe(200)
  })
  it('suppresses an indivisible range, protects an explicit manual download, and refuses pending unsuppression', () => {
    db.insert(maintenanceSuppressions)
      .values({
        titleId: 'tmdb:tv:902',
        season: 1,
        episode: 2,
        status: 'cleaned',
        operationId: 'synthetic-operation',
      })
      .run()
    const row = db
      .insert(torrents)
      .values({
        infoHash: 'b'.repeat(40),
        name: 'Synthetic.S01E01-E02',
        source: 'file',
        status: 'ready',
        titleId: 'tmdb:tv:902',
        files: [{ path: 'Synthetic.S01E01-E02.mkv', size: 4, padding: false }],
      })
      .returning()
      .get()
    expect(hasSuppressed(row.titleId!, [{ season: 1, episode: 2 }])).toBe(true)
    expect(suppressedFileIndexes(row).has(0)).toBe(true)
    expect(heldFileIndexes(row.id).has(0)).toBe(true)
    recordDownload(row, 'manual')
    expect(heldFileIndexes(row.id).has(0)).toBe(false)
    db.update(maintenanceSuppressions)
      .set({ status: 'pending' })
      .where(eq(maintenanceSuppressions.titleId, row.titleId!))
      .run()
    expect(allowRedownload(row.titleId!, [{ season: 1, episode: 2 }])).toBe(
      false,
    )
    db.update(maintenanceSuppressions)
      .set({ status: 'cleaned' })
      .where(eq(maintenanceSuppressions.titleId, row.titleId!))
      .run()
    expect(allowRedownload(row.titleId!, [{ season: 1, episode: 2 }])).toBe(
      true,
    )
    expect(hasSuppressed(row.titleId!, [{ season: 1, episode: 2 }])).toBe(
      false,
    )
  })
})

it('lastPlayedAt is real playback only; manual watched and unwatch preserve its meaning', () => {
  const ref = { profileId, titleId: 'tmdb:tv:903', season: 1, episode: 1 }
  markWatched(ref, true)
  expect(getTitleProgress(ref)?.lastPlayedAt).toBeNull()
  saveTitleProgress(ref, {
    position: 10,
    duration: 100,
    torrentId: null,
    fileIndex: null,
  })
  const played = getTitleProgress(ref)?.lastPlayedAt
  expect(played).toBeInstanceOf(Date)
  markWatched(ref, false)
  expect(getTitleProgress(ref)).toMatchObject({
    watchedAt: null,
    lastPlayedAt: played,
  })
})

it('suppression survives follow deletion/recreation and blocks pending captures before engine access', async () => {
  const values = {
    titleId: 'tmdb:tv:904',
    kind: 'series' as const,
    state: 'active' as const,
    startSeason: 1,
    startEpisode: 1,
    requireRussian: false,
    waitHours: 0,
  }
  const first = db.insert(follows).values(values).returning().get()
  db.insert(maintenanceSuppressions)
    .values({
      titleId: values.titleId,
      season: 1,
      episode: 1,
      status: 'cleaned',
      operationId: 'synthetic-cleaned',
    })
    .run()
  db.delete(follows).where(eq(follows.id, first.id)).run()
  const follow = db.insert(follows).values(values).returning().get()
  const torrent = db
    .insert(torrents)
    .values({
      titleId: values.titleId,
      infoHash: 'c'.repeat(40),
      name: 'Synthetic.S01E01',
      source: 'file',
      status: 'ready',
    })
    .returning()
    .get()
  // No torrent metadata or engine is needed: suppression wins before download.
  expect(
    await startGrab(
      follow,
      torrent,
      { id: 'synthetic', title: torrent.name, seeders: 1 },
      [{ season: 1, episode: 1 }],
    ),
  ).toBe('blocked')
  expect(hasSuppressed(values.titleId, [{ season: 1, episode: 1 }])).toBe(true)
})
