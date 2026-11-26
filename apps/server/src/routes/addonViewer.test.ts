import { eq } from 'drizzle-orm'
import {
  afterAll,
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
  httpAddons,
  metaCache,
  profiles,
  titleExternalIds,
  torrents,
  users,
} from '../db/schema.ts'
import { insertHttpAddon, patchHttpAddon } from '../services/addons/config.ts'
import { getAddonLaunch } from '../services/addons/streams.ts'
import { addonTransportDeps } from '../services/addons/transport.ts'
import { netResolveDeps, setNetTransport } from '../services/net/index.ts'
import { defaultProfile } from '../services/profiles/index.ts'
import { rememberImdbId } from '../services/ratings/externalIds.ts'
import { movie } from '../services/tmdb/fixtures/index.ts'
import * as torrentService from '../services/torrents/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const cookies = { [ACCESS_TOKEN_COOKIE]: signToken('owner', 'user_access') }
const tmdb = vi.fn(
  (_url: string): Response => new Response(null, { status: 404 }),
)
const filmId = 'tmdb:movie:900001'
const imdbFilm = 'tt9000001'
const imdbSeries = 'tt9000002'
const magnetHash = '10'.repeat(20)

function addonReply(body: unknown, status = 200) {
  return { response: Response.json(body, { status }), destroy: async () => {} }
}

const manifest = {
  id: 'example.resources',
  name: 'Example Add-on',
  version: '1.0.0',
  types: ['movie', 'series'],
  resources: ['stream'],
}

function sources(id = filmId, query = '') {
  return app.inject({
    url: `/api/titles/${id}/addon-sources${query}`,
    cookies,
  })
}

function play(candidateId: string, id = filmId, profile?: string) {
  return app.inject({
    method: 'POST',
    url: `/api/titles/${id}/addon-sources/play`,
    cookies: { ...cookies, ...(profile && { [PROFILE_COOKIE]: profile }) },
    payload: { candidateId },
  })
}

beforeAll(async () => {
  await migrateDb()
  getDb()
    .insert(users)
    .values({ id: 'owner', username: 'Owner', passwordHash: 'hash' })
    .run()
  defaultProfile()
  getDb()
    .insert(profiles)
    .values({
      id: 'restricted',
      name: 'Restricted',
      color: 'violet',
      ageLimit: 13,
      position: 1,
    })
    .run()
})

beforeEach(() => {
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  vi.spyOn(netResolveDeps, 'routeAddresses').mockResolvedValue(['8.8.4.4'])
  setNetTransport(async url => tmdb(url))
  rememberImdbId({ type: 'movie', tmdbId: 900001 }, imdbFilm)
})

afterEach(() => {
  setNetTransport(null)
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  tmdb.mockReset()
  getDb().delete(httpAddons).run()
  getDb().delete(titleExternalIds).run()
  getDb().delete(metaCache).run()
  getDb().delete(torrents).run()
})
afterAll(() => app.close())

describe('viewer add-on streams', () => {
  it('skips TMDB and upstream search when no stream is enabled', async () => {
    const network = vi.spyOn(addonTransportDeps, 'send')
    const result = await sources()
    expect(result.statusCode).toBe(200)
    expect(result.json()).toEqual({ items: [], failed: false })
    expect(tmdb).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
  })

  it('uses exact series episodes including specials and isolates an unavailable add-on', async () => {
    const send = vi
      .spyOn(addonTransportDeps, 'send')
      .mockImplementation(async (url) => {
        if (url.pathname.endsWith('/manifest.json'))
          return addonReply(manifest)
        if (url.hostname === 'bad.example')
          return addonReply({}, 502)
        return addonReply({
          streams: [{ title: 'Example 1080p', infoHash: magnetHash }],
        })
      })
    for (const host of ['good.example', 'bad.example']) {
      await insertHttpAddon('owner', {
        url: `https://${host}/config/manifest.json?token=fixture-secret`,
        selections: { stream: true, subtitles: false, catalogs: [] },
      })
    }
    tmdb.mockImplementation((input) => {
      const path = new URL(input).pathname
      if (path.endsWith('/external_ids'))
        return Response.json({ imdb_id: imdbSeries })
      if (path.endsWith('/season/0')) {
        return Response.json({
          season_number: 0,
          episodes: [{ episode_number: 1 }],
        })
      }
      return new Response(null, { status: 404 })
    })
    const tv = 'tmdb:tv:900002'
    expect((await sources(tv)).json()).toEqual({ items: [], failed: false })
    expect(tmdb).not.toHaveBeenCalled()
    expect((await sources(tv, '?season=0&episode=2')).json()).toEqual({
      items: [],
      failed: false,
    })
    const response = await sources(tv, '?season=0&episode=1')
    expect(response.statusCode, response.body).toBe(200)
    expect(response.json()).toEqual({
      items: [
        {
          id: expect.any(String),
          kind: 'torrent',
          addonName: 'Example Add-on',
          name: 'Example 1080p',
          quality: '1080p',
        },
      ],
      failed: true,
    })
    const resources = send.mock.calls
      .map(([url]) => url)
      .filter(url => !url.pathname.endsWith('/manifest.json'))
    expect(resources).toHaveLength(2)
    expect(resources.map(url => decodeURIComponent(url.pathname))).toEqual([
      `/config/stream/series/${imdbSeries}:0:1.json`,
      `/config/stream/series/${imdbSeries}:0:1.json`,
    ])
    expect(
      resources.every(url => url.search === '?token=fixture-secret'),
    ).toBe(true)
    expect(
      tmdb.mock.calls.filter(([url]) => url.includes('external_ids')),
    ).toHaveLength(1)
  })

  it('keeps remote URL and headers behind a scoped launch', async () => {
    const upstream = 'https://media.example/file?token=private-link'
    const stream = {
      url: upstream,
      title: 'echo private-link fixture-secret',
      name: 'Example 720p',
      behaviorHints: {
        proxyHeaders: { request: { Authorization: 'Bearer private-header' } },
      },
    }
    vi.spyOn(addonTransportDeps, 'send').mockImplementation(async url =>
      addonReply(
        url.pathname.endsWith('/manifest.json')
          ? manifest
          : {
              streams: [
                stream,
                { ...stream, infoHash: magnetHash },
                {
                  ...stream,
                  behaviorHints: {
                    proxyHeaders: { response: { 'X-Unsupported': '1' } },
                  },
                },
              ],
            },
      ),
    )
    const addon = await insertHttpAddon('owner', {
      url: 'https://addon.example/manifest.json?token=fixture-secret',
      selections: { stream: true, subtitles: false, catalogs: [] },
    })
    const response = await sources()
    expect(response.statusCode, response.body).toBe(200)
    expect(response.body).not.toMatch(
      /https:|private-link|fixture-secret|private-header/,
    )
    const { items } = response.json()
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'http',
      name: 'Example 720p',
      quality: '720p',
    })
    const id = items[0].id
    expect((await play(id, 'tmdb:movie:900004')).statusCode).toBe(404)
    expect((await play(id, filmId, 'restricted')).statusCode).toBe(404)
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/titles/${filmId}/addon-sources/play`,
          cookies,
          headers: {
            'sec-fetch-site': 'cross-site',
            'origin': 'https://foreign.example',
          },
          payload: { candidateId: id },
        })
      ).statusCode,
    ).toBe(403)

    const first = await play(id)
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json()).toEqual({
      kind: 'http',
      launchId: expect.any(String),
    })
    expect((await play(id)).json()).toEqual(first.json())
    const viewer = { subject: 'owner', profileId: defaultProfile().id }
    const grant = getAddonLaunch(first.json().launchId, viewer)!
    expect(grant).toMatchObject({
      url: upstream,
      target: { titleId: filmId, type: 'movie', videoId: imdbFilm },
    })
    expect(grant.headers.get('authorization')).toBe('Bearer private-header')
    expect(
      getAddonLaunch(grant.id, { ...viewer, subject: 'different' }),
    ).toBeUndefined()

    await patchHttpAddon('owner', addon.id, { enabled: false })
    expect(grant.signal.aborted).toBe(true)
    expect(getAddonLaunch(grant.id, viewer)).toBeUndefined()
    expect((await play(id)).statusCode).toBe(404)
  })

  it('acquires only the hash after selection and preserves file index zero across resolving', async () => {
    vi.spyOn(addonTransportDeps, 'send').mockImplementation(async url =>
      addonReply(
        url.pathname.endsWith('/manifest.json')
          ? manifest
          : {
              streams: [
                {
                  infoHash: magnetHash,
                  fileIdx: 0,
                  sources: ['tracker:https://ignore.example/announce'],
                },
                { infoHash: magnetHash, fileIdx: 1 },
                { infoHash: magnetHash },
              ],
            },
      ),
    )
    await insertHttpAddon('owner', {
      url: 'https://addon.example/manifest.json',
      selections: { stream: true, subtitles: false, catalogs: [] },
    })
    const add = vi
      .spyOn(torrentService, 'addMagnet')
      .mockImplementation(async (magnet) => {
        const torrent = getDb()
          .insert(torrents)
          .values({
            id: 'fixture-torrent',
            infoHash: magnetHash,
            source: 'magnet',
            name: 'Fixture Film',
            status: 'resolving',
            magnet,
          })
          .returning()
          .get()
        return { torrent, created: true }
      })
    const { items } = (await sources()).json()
    expect(add).not.toHaveBeenCalled()
    const id = items[0].id
    expect((await play(id)).json()).toEqual({
      kind: 'torrent',
      status: 'resolving',
      torrentId: 'fixture-torrent',
    })
    const files = [
      { path: 'Fixture Film.mp4', size: 100, padding: false, index: 0 },
      { path: '.pad/100', size: 100, padding: true, index: 1 },
      { path: 'Another Feature.mp4', size: 100, padding: false, index: 2 },
    ]
    getDb()
      .update(torrents)
      .set({ status: 'ready', files })
      .where(eq(torrents.id, 'fixture-torrent'))
      .run()
    expect((await play(id)).json()).toEqual({
      kind: 'torrent',
      status: 'ready',
      torrentId: 'fixture-torrent',
      fileIndex: 0,
    })
    expect((await play(items[1].id)).json()).toMatchObject({
      kind: 'bad_response',
    })
    expect((await play(items[2].id)).json()).toEqual({
      kind: 'torrent',
      status: 'files',
      torrentId: 'fixture-torrent',
    })
    expect(add.mock.calls[0]).toEqual([`magnet:?xt=urn:btih:${magnetHash}`])

    getDb()
      .update(torrents)
      .set({ isPrivate: true })
      .where(eq(torrents.id, 'fixture-torrent'))
      .run()
    expect((await play(id)).statusCode).toBe(409)
    getDb()
      .update(torrents)
      .set({ isPrivate: false, titleId: 'tmdb:movie:900099' })
      .where(eq(torrents.id, 'fixture-torrent'))
      .run()
    expect((await play(id)).statusCode).toBe(409)
    expect(torrentService.getTorrent('fixture-torrent')?.titleId).toBe(
      'tmdb:movie:900099',
    )
  })
})

describe('viewer add-on catalog', () => {
  it('maps a first page by strict media type, dedupes and rechecks age access on cache hits', async () => {
    const send = vi
      .spyOn(addonTransportDeps, 'send')
      .mockImplementation(async (url) => {
        if (url.pathname.endsWith('/manifest.json')) {
          return addonReply({
            ...manifest,
            catalogs: [
              {
                id: 'example',
                name: 'Example films',
                type: 'movie',
                extra: [{ name: 'skip', isRequired: true }],
              },
            ],
          })
        }
        return addonReply({
          metas: [
            { id: imdbFilm, type: 'movie' },
            { id: 'tt9000003', type: 'movie' },
            { id: 'tt9000004', type: 'movie' },
            { id: imdbFilm, type: 'movie' },
            { id: 'https://unknown.example/id', type: 'movie' },
            { id: imdbSeries, type: 'series' },
          ],
        })
      })
    const addon = await insertHttpAddon('owner', {
      url: 'https://addon.example/manifest.json',
    })
    await patchHttpAddon('owner', addon.id, {
      selections: {
        stream: false,
        subtitles: false,
        catalogs: [addon.capabilities.catalogs[0]!.key],
      },
    })
    tmdb.mockImplementation((input) => {
      const path = new URL(input).pathname
      if (path.endsWith(`/find/${imdbFilm}`))
        return Response.json({ movie_results: [{ id: 900001 }] })
      if (path.endsWith('/find/tt9000003'))
        return Response.json({ tv_results: [{ id: 900003 }] })
      if (path.endsWith('/find/tt9000004')) {
        return Response.json({
          movie_results: [{ id: 900004 }, { id: 900005 }],
        })
      }
      if (path.endsWith('/movie/900001')) {
        return Response.json({
          ...movie,
          id: 900001,
          title: 'Fixture Film',
          imdb_id: imdbFilm,
          release_dates: {
            results: [
              { iso_3166_1: 'US', release_dates: [{ certification: 'R' }] },
            ],
          },
        })
      }
      return new Response(null, { status: 404 })
    })
    async function rows(mode = 'movies', profile?: string) {
      return app.inject({
        url: `/api/home/addon-rows?mode=${mode}`,
        cookies: { ...cookies, ...(profile && { [PROFILE_COOKIE]: profile }) },
      })
    }
    const result = await rows()
    expect(result.statusCode, result.body).toBe(200)
    expect(result.json()).toMatchObject({
      failed: false,
      rows: [
        {
          name: 'Example films',
          type: 'movie',
          kind: 'addon',
          items: [{ id: filmId, title: 'Fixture Film' }],
        },
      ],
    })
    expect(result.json().rows[0].items).toHaveLength(1)
    expect((await rows('movies', 'restricted')).json()).toEqual({
      rows: [],
      failed: false,
    })
    expect((await rows('series')).json()).toEqual({ rows: [], failed: false })
    expect((await rows('library')).json()).toEqual({ rows: [], failed: false })
    expect(send.mock.calls.map(([url]) => url.pathname)).toEqual([
      '/manifest.json',
      '/catalog/movie/example/skip=0.json',
    ])
  })
})
