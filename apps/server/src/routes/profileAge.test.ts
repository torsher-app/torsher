import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../app.ts'
import {
  ACCESS_TOKEN_COOKIE,
  DEVICE_TOKEN_COOKIE,
  PROFILE_COOKIE,
} from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  devices,
  libraries,
  libraryFolders,
  mediaFiles,
  profileTitles,
  torrents,
  users,
} from '../db/schema.ts'
import { hashToken } from '../services/devices/index.ts'
import { setEngineDown } from '../services/engine/index.ts'
import {
  createProfile,
  defaultProfile,
  updateProfile,
} from '../services/profiles/index.ts'
import { storeMetaCache } from '../services/tmdb/cache.ts'
import { movie } from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'
import {
  addToCollection,
  collectionItems,
  createCollection,
} from '../services/collections/index.ts'

const app = createApp()
const allowed = 'tmdb:movie:901'
const blocked = 'tmdb:movie:902'
const unknown = 'tmdb:movie:903'
let child: string
let owner: Record<string, string>
let viewer: Record<string, string>
let device: Record<string, string>
let source: string
let unclassifiedSource: string
let blockedFile: string
let homeFile: string
const fetchMock = vi.fn<typeof fetch>()

function cache(id: number, rating?: string) {
  const raw = {
    ...movie,
    id,
    release_dates: {
      results: rating
        ? [{ iso_3166_1: 'RU', release_dates: [{ certification: rating }] }]
        : [],
    },
  }
  storeMetaCache(`tmdb:movie:${id}:ru-RU:v3`, raw)
  storeMetaCache(`tmdb:movie:${id}:en-US:v3`, raw)
}
function insertTorrent(titleId: string | null) {
  return getDb()
    .insert(torrents)
    .values({
      infoHash: randomUUID().replaceAll('-', '').padEnd(40, '0'),
      name: 'Synthetic.mp4',
      source: 'magnet',
      status: 'ready',
      titleId,
      files: [{ path: 'Synthetic.mp4', size: 100, padding: false }],
    })
    .returning()
    .get()
    .id
}
beforeAll(async () => {
  await migrateDb()
  setEngineDown('stopped')
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'hash' })
    .run()
  defaultProfile()
  child = createProfile({
    name: 'Child',
    color: 'violet',
    language: null,
    ageLimit: 12,
  }).id
  owner = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
  viewer = { ...owner, [PROFILE_COOKIE]: child }
  const credential = randomUUID()
  getDb()
    .insert(devices)
    .values({
      name: 'TV',
      type: 'tv',
      profileId: child,
      tokenHash: hashToken(credential),
    })
    .run()
  device = { [DEVICE_TOKEN_COOKIE]: credential }
  cache(901, '6+')
  cache(902, '12+')
  cache(903)
  source = insertTorrent(blocked)
  unclassifiedSource = insertTorrent(null)
  for (const kind of ['video', 'home'] as const) {
    const library = getDb()
      .insert(libraries)
      .values({ name: `Synthetic ${kind}`, kind })
      .returning()
      .get()
    const folder = getDb()
      .insert(libraryFolders)
      .values({ libraryId: library.id, path: `/synthetic/${kind}` })
      .returning()
      .get()
    const file = getDb()
      .insert(mediaFiles)
      .values({
        folderId: folder.id,
        relPath: 'Synthetic.mp4',
        size: 100,
        mtime: new Date(),
        titleId: kind === 'home' ? allowed : blocked,
        matchStatus: 'matched',
      })
      .returning()
      .get()
    if (kind === 'home')
      homeFile = file.id
    else blockedFile = file.id
  }
  getDb()
    .insert(profileTitles)
    .values(
      [allowed, blocked, unknown].map((titleId, i) => ({
        profileId: child,
        titleId,
        watchlistAt: new Date(1000 + i),
        rating: 8,
        ratedAt: new Date(1000 + i),
      })),
    )
    .run()
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(String(input))
    const results = [901, 902, 903].map(id => ({
      ...movie,
      id,
      media_type: 'movie',
    }))
    if (url.pathname.includes('/search/'))
      return Response.json({ results })
    if (url.pathname.includes('/discover/')) {
      return Response.json({
        results,
        page: 1,
        total_pages: 2,
        total_results: 60,
      })
    }
    throw new Error(`Unexpected network request ${url.pathname}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
})
afterAll(async () => {
  await app.close()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('profile age authorization routes', () => {
  it('owner showcase obeys the selected profile independently of language; owner panel uses separate endpoints', async () => {
    for (const language of ['ru-RU', 'en-US']) {
      expect(
        (
          await app.inject({
            url: `/api/catalog/titles/${blocked}?language=${language}`,
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(404)
      expect(
        (
          await app.inject({
            url: `/api/catalog/titles/${allowed}?language=${language}`,
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(200)
    }
    expect(
      (
        await app.inject({
          url: `/api/catalog/admin/titles/${blocked}`,
          cookies: viewer,
        })
      ).statusCode,
    ).toBe(200)
    expect(
      (
        await app.inject({
          url: `/api/catalog/admin/titles/${blocked}`,
          cookies: device,
        })
      ).statusCode,
    ).toBe(401)
    const search = await app.inject({
      url: '/api/catalog/search?query=synthetic',
      cookies: viewer,
    })
    expect(search.json().items.map((item: { id: string }) => item.id)).toEqual([
      allowed,
    ])
    expect(
      (
        await app.inject({
          url: '/api/catalog/admin/search?query=synthetic',
          cookies: viewer,
        })
      ).json().items,
    ).toHaveLength(3)
    expect(
      (
        await app.inject({
          url: '/api/catalog/admin/search?query=synthetic',
          cookies: device,
        })
      ).statusCode,
    ).toBe(401)
  })
  it('direct title paths, follow and voices hide blocked and unknown titles before work', async () => {
    for (const id of [blocked, unknown]) {
      for (const path of [
        `catalog/titles/${id}/extras`,
        `catalog/titles/${id}/seasons/1`,
        `titles/${id}/sources`,
        `titles/${id}/progress`,
        `titles/${id}/library`,
        `titles/${id}/follow`,
        `titles/${id}/follow/voices?season=0`,
      ]) {
        expect(
          (await app.inject({ url: `/api/${path}`, cookies: viewer }))
            .statusCode,
          path,
        ).toBe(404)
      }
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/api/titles/${id}/follow`,
            payload: {},
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(404)
    }
  })
  it('owner panel can remove hidden collection titles while viewer and device restrictions remain', async () => {
    const collection = createCollection({ name: 'Age policy administration' })
    for (const id of [blocked, unknown]) addToCollection(collection.id, id)
    const panel = await app.inject({
      url: `/api/collections/${collection.id}/titles`,
      cookies: viewer,
    })
    expect(panel.statusCode).toBe(200)
    expect(
      panel
        .json()
        .items.map((item: { id: string }) => item.id)
        .sort(),
    ).toEqual([blocked, unknown])
    for (const id of [blocked, unknown]) {
      expect(
        (
          await app.inject({
            url: `/api/catalog/titles/${id}`,
            cookies: device,
          })
        ).statusCode,
      ).toBe(404)
      const viewerPath = `/api/collections/${collection.id}/titles/${id}`
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: viewerPath,
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(404)
      expect(
        collectionItems(collection.id).some(item => item.titleId === id),
      ).toBe(true)
      const panelPath = `/api/collections/admin/${collection.id}/titles/${id}`
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: panelPath,
            cookies: device,
          })
        ).statusCode,
      ).toBe(401)
      expect(
        collectionItems(collection.id).some(item => item.titleId === id),
      ).toBe(true)
      expect(
        (
          await app.inject({
            method: 'DELETE',
            url: panelPath,
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(200)
      expect(
        collectionItems(collection.id).some(item => item.titleId === id),
      ).toBe(false)
    }
  })

  it('filters all ratings and their section count by profile access', async () => {
    const sections = await app.inject({ url: '/api/mine', cookies: viewer })
    expect(sections.json().sections).toContainEqual({
      id: 'ratings',
      count: 1,
    })
    const res = await app.inject({
      url: '/api/mine/items?section=ratings&limit=1',
      cookies: viewer,
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json()).toMatchObject({ total: 1, items: [{ id: allowed }] })
  })

  it('filters mine before pagination and reports allowed totals', async () => {
    const first = await app.inject({
      url: '/api/mine/items?section=watchlist&limit=1&offset=0',
      cookies: viewer,
    })
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json().items.map((item: { id: string }) => item.id)).toEqual([
      allowed,
    ])
    expect(first.json().total).toBe(1)
    const second = await app.inject({
      url: '/api/mine/items?section=watchlist&limit=1&offset=1',
      cookies: viewer,
    })
    expect(second.json()).toMatchObject({ items: [], total: 1 })
    const page = await app.inject({
      url: '/api/catalog/discover',
      cookies: viewer,
    })
    expect(page.json()).toMatchObject({
      total: 60,
      totalPages: 2,
      totalIsApproximate: true,
    })
    expect(page.json().items).toHaveLength(1)
  })
  it('actual blocked or unknown source cannot be authorized by spoofing a permitted title', async () => {
    for (const torrentId of [source, unclassifiedSource]) {
      for (const title of [undefined, { id: allowed }]) {
        const payload = { torrentId, fileIndex: 0, title }
        expect(
          (
            await app.inject({
              method: 'POST',
              url: '/api/playback',
              payload,
              cookies: viewer,
            })
          ).statusCode,
        ).toBe(404)
        expect(
          (
            await app.inject({
              method: 'PUT',
              url: '/api/watch-state',
              payload: { ...payload, position: 10 },
              cookies: viewer,
            })
          ).statusCode,
        ).toBe(404)
      }
      expect(
        (
          await app.inject({
            url: `/api/torrents/${torrentId}`,
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(404)
      expect(
        (
          await app.inject({
            url: `/api/torrents/${torrentId}/stats?fileIndex=0`,
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(404)
      const before = getDb()
        .select()
        .from(torrents)
        .where(eq(torrents.id, torrentId))
        .get()!
        .titleId
      const remap = await app.inject({
        method: 'POST',
        url: `/api/titles/${allowed}/watch`,
        payload: { torrentId },
        cookies: viewer,
      })
      expect(remap.statusCode).toBe(422)
      expect(
        getDb().select().from(torrents).where(eq(torrents.id, torrentId)).get()!
          .titleId,
      ).toBe(before)
    }
  })
  it('hot raw stream, library stream and thumbnail fail closed without network or preparing playback', async () => {
    fetchMock.mockClear()
    const token = signToken('owner', 'stream', 0, child)
    expect(
      (await app.inject({ url: `/api/stream/${source}/0?token=${token}` }))
        .statusCode,
    ).toBe(404)
    for (const file of [blockedFile, homeFile]) {
      expect(
        (
          await app.inject({
            url: `/api/library/files/${file}/stream?token=${token}`,
          })
        ).statusCode,
      ).toBe(404)
      expect(
        (
          await app.inject({
            url: `/api/library/files/${file}/thumb`,
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(404)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/playback',
            payload: { mediaFileId: file, title: { id: allowed } },
            cookies: viewer,
          })
        ).statusCode,
      ).toBe(404)
    }
    expect(
      (await app.inject({ url: '/api/library/home', cookies: viewer })).json()
        .albums,
    ).toEqual([])
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('age changes revoke stream access and owner token cannot follow a profile-cookie switch', async () => {
    const torrentId = insertTorrent(allowed)
    const token = signToken('owner', 'stream', 0, child)
    updateProfile(child, { ageLimit: 6 })
    expect(
      (await app.inject({ url: `/api/stream/${torrentId}/0?token=${token}` }))
        .statusCode,
    ).toBe(404)
    updateProfile(child, { ageLimit: 12 })
    expect(
      (
        await app.inject({
          url: `/api/stream/${torrentId}/0?token=${token}`,
          cookies: { [PROFILE_COOKIE]: defaultProfile().id },
        })
      ).statusCode,
    ).toBe(401)
  })
})
