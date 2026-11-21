import { Buffer } from 'node:buffer'
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
  cyclePlaybackFacts,
  diaryEntries,
  diarySeen,
  followProfiles,
  follows,
  metaCache,
  profileImports,
  profiles,
  profileTitles,
  titleExternalIds,
  titleProgress,
  torrents,
  users,
  watchStates,
} from '../db/schema.ts'
import { storeMetaCache } from '../services/tmdb/cache.ts'
import { movie } from '../services/tmdb/fixtures/index.ts'
import { recommendationList } from '../services/tmdb/recommendations.ts'
import { recommendationSignals } from '../services/mine/recommendationSignals.ts'
import { parseExportDocument } from '../services/transfer/document.ts'
import { buildZip } from '../services/transfer/fixtures/zip.ts'
import {
  importJobSettled,
  purgeImports,
  resetImportJobs,
  UNDO_WINDOW_MS,
} from '../services/transfer/imports.ts'
import { signToken } from '../utils/token.ts'
import {
  getTitleMine,
  markTitleWatched,
  updateMine,
} from '../services/mine/index.ts'
import { lastWatchedAt } from '../services/mine/status.ts'
import {
  getTitleProgress,
  markWatched,
  rememberChoice,
  rememberVoice,
  saveTitleProgress,
  watchedTitles,
} from '../services/sources/progress.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()

let profileId: string

function authed() {
  return { [ACCESS_TOKEN_COOKIE]: signToken('user-1', 'user_access') }
}

// Синтетический каталог: выдуманные названия, ID `tt9…` и TMDB 9xxx
const FOUND: Record<
  string,
  { movie_results: { id: number }[], tv_results: { id: number }[] }
> = {
  tt9000001: { movie_results: [{ id: 9001 }], tv_results: [] },
  tt9000002: { movie_results: [], tv_results: [{ id: 9002 }] },
}

const SEARCH: Record<string, unknown[]> = {
  // Однофамилец без даты выхода не мешает точному совпадению с годом
  'paper lanterns': [
    {
      id: 9003,
      title: 'Paper Lanterns',
      original_title: 'Paper Lanterns',
      release_date: '2018-05-01',
    },
    {
      id: 9013,
      title: 'Paper Lanterns',
      original_title: 'Paper Lanterns',
      release_date: '',
    },
  ],
  'moon harbor': [
    {
      id: 9004,
      title: 'Moon Harbour Story',
      original_title: 'Moon Harbour Story',
      release_date: '2011-02-01',
    },
  ],
}

function tmdbResponse(url: string) {
  const { pathname, searchParams } = new URL(url)
  const find = /^\/3\/find\/(tt\d+)$/.exec(pathname)

  if (find)
    return FOUND[find[1]!] ?? { movie_results: [], tv_results: [] }

  if (pathname === '/3/search/movie')
    return { results: SEARCH[searchParams.get('query') ?? ''] ?? [] }

  const details = /^\/3\/movie\/(\d+)$/.exec(pathname)

  if (details) {
    const id = Number(details[1])

    return {
      ...movie,
      id,
      title: id === 9004 ? 'Moon Harbour Story' : movie.title,
      original_title: id === 9004 ? 'Moon Harbour Story' : movie.original_title,
      release_date: '2011-02-01',
    }
  }

  return { results: [] }
}

const IMDB_CSV = `Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt9000001,8,2024-05-04,Moon Over Harbor,Moon Over Harbor,https://example.test/,Movie,7.1,101,2011,Drama,1200,2011-03-01,
tt9000002,6,2021-01-02,Quiet Ward,Quiet Ward,https://example.test/,TV Mini Series,7.4,50,2020,Drama,800,2020-02-02,
`

const LETTERBOXD = buildZip({
  'ratings.csv':
    'Date,Name,Year,Letterboxd URI,Rating\n2020-01-01,Paper Lanterns,2018,https://boxd.it/a,3.5\n2020-01-02,Unknown Thing,1990,https://boxd.it/b,2\n2020-01-03,Moon Harbor,2011,https://boxd.it/c,4\n',
})

function upload(
  files: Array<{ name: string, data: string | Buffer }>,
  target = profileId,
) {
  return app.inject({
    method: 'POST',
    url: `/api/profiles/${target}/imports`,
    cookies: authed(),
    payload: {
      files: files.map(file => ({
        name: file.name,
        data: Buffer.from(file.data).toString('base64'),
      })),
    },
  })
}

async function readyJob(
  files: Array<{ name: string, data: string | Buffer }>,
  target = profileId,
) {
  const res = await upload(files, target)

  expect(res.statusCode).toBe(202)

  const { id } = res.json()

  await importJobSettled(id)

  return (
    await app.inject({
      url: `/api/profiles/${target}/imports/${id}`,
      cookies: authed(),
    })
  ).json()
}

function apply(id: string, conflicts: string, target = profileId) {
  return app.inject({
    method: 'POST',
    url: `/api/profiles/${target}/imports/${id}/apply`,
    cookies: authed(),
    payload: { conflicts },
  })
}

function ratingOf(titleId: string) {
  return getDb()
    .select()
    .from(profileTitles)
    .all()
    .find(row => row.titleId === titleId)
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

  const res = await app.inject({ url: '/api/profiles', cookies: authed() })

  profileId = res.json().currentId
})

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(
    async input => new Response(JSON.stringify(tmdbResponse(String(input)))),
  )
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('TMDB_ACCESS_TOKEN', 'test-token')
  resetImportJobs()

  const db = getDb()

  db.delete(cyclePlaybackFacts).run()
  db.delete(diaryEntries).run()
  db.delete(diarySeen).run()
  db.delete(follows).run()
  db.delete(titleProgress).run()
  db.delete(profileTitles).run()
  db.delete(profileImports).run()
  db.delete(metaCache).run()
  db.delete(titleExternalIds).run()
  db.insert(profileTitles)
    .values({
      profileId,
      titleId: 'tmdb:movie:9001',
      rating: 5,
      ratedAt: new Date('2020-01-01'),
      updatedAt: new Date('2020-01-01'),
    })
    .run()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('/api/profiles/:id/imports', () => {
  it('только владельцу', async () => {
    const res = await app.inject({ url: `/api/profiles/${profileId}/imports` })

    expect(res.statusCode).toBe(401)
  })

  it('незнакомый файл — 400 с видом ошибки', async () => {
    const res = await upload([{ name: 'notes.csv', data: 'foo,bar\n1,2\n' }])

    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({
      kind: 'unsupported',
      file: 'notes.csv',
    })
  })

  it('загрузка → предпросмотр → применение → несопоставленное → отмена', async () => {
    const job = await readyJob([
      { name: 'ratings.csv', data: IMDB_CSV },
      { name: 'letterboxd.zip', data: LETTERBOXD },
    ])

    expect(job.state).toBe('ready')
    expect(job.progress).toEqual({ done: 5, total: 5 })
    expect(job.preview).toMatchObject({
      sources: ['imdb', 'letterboxd'],
      ratings: { new: 2, same: 0, conflicts: 1 },
      unsure: 1,
      notFound: 1,
      conflictsDated: true,
      conflictSamples: [
        {
          titleId: 'tmdb:movie:9001',
          title: 'Moon Over Harbor',
          current: 5,
          incoming: 8,
        },
      ],
    })

    let res = await apply(job.id, 'keep')

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      imported: 2,
      unchanged: 1,
      unmatched: 2,
    })
    expect(ratingOf('tmdb:movie:9001')?.rating).toBe(5)
    expect(ratingOf('tmdb:tv:9002')).toMatchObject({
      rating: 6,
      ratedAt: new Date('2021-01-02'),
    })
    expect(ratingOf('tmdb:movie:9003')?.rating).toBe(7)

    // Задача применена и забыта
    res = await apply(job.id, 'keep')
    expect(res.statusCode).toBe(404)

    res = await app.inject({
      url: `/api/profiles/${profileId}/imports/unmatched?language=en-US`,
      cookies: authed(),
    })

    const unmatched = res.json()

    expect(unmatched.total).toBe(2)
    expect(unmatched.items).toEqual([
      expect.objectContaining({
        title: 'Unknown Thing',
        status: 'notFound',
        rating: 4,
        suggestion: null,
      }),
      expect.objectContaining({
        title: 'Moon Harbor',
        status: 'unsure',
        rating: 8,
        suggestion: expect.objectContaining({ id: 'tmdb:movie:9004' }),
      }),
    ])

    res = await app.inject({
      method: 'POST',
      url: `/api/profiles/${profileId}/imports/unmatched/${unmatched.items[0].id}`,
      cookies: authed(),
      payload: { titleId: 'tmdb:movie:9005' },
    })
    expect(res.statusCode).toBe(204)
    expect(ratingOf('tmdb:movie:9005')?.rating).toBe(4)

    res = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${profileId}/imports/unmatched/${unmatched.items[1].id}`,
      cookies: authed(),
    })
    expect(res.statusCode).toBe(204)

    res = await app.inject({
      url: `/api/profiles/${profileId}/imports`,
      cookies: authed(),
    })
    expect(res.json()).toMatchObject({
      job: null,
      unmatched: 0,
      last: { summary: { imported: 2 }, canUndo: true },
    })

    const importId = res.json().last.id

    res = await app.inject({
      method: 'POST',
      url: `/api/profiles/${profileId}/imports/${importId}/undo`,
      cookies: authed(),
    })
    expect(res.json()).toEqual({ restored: 2, kept: 0 })
    expect(ratingOf('tmdb:tv:9002')).toBeUndefined()
    expect(ratingOf('tmdb:movie:9003')).toBeUndefined()
    // Ручное сопоставление — отдельное действие, отмена импорта его не трогает
    expect(ratingOf('tmdb:movie:9005')?.rating).toBe(4)

    res = await app.inject({
      method: 'POST',
      url: `/api/profiles/${profileId}/imports/${importId}/undo`,
      cookies: authed(),
    })
    expect(res.statusCode).toBe(409)
  })

  it('replace и newer заменяют оценку; повтор ничего не меняет; правка после импорта переживает отмену', async () => {
    let job = await readyJob([{ name: 'ratings.csv', data: IMDB_CSV }])
    let res = await apply(job.id, 'newer')

    expect(res.json()).toMatchObject({ imported: 2, unchanged: 0 })
    expect(ratingOf('tmdb:movie:9001')?.rating).toBe(8)

    job = await readyJob([{ name: 'ratings.csv', data: IMDB_CSV }])
    expect(job.preview.ratings).toEqual({ new: 0, same: 2, conflicts: 0 })
    res = await apply(job.id, 'replace')
    expect(res.json()).toMatchObject({ imported: 0, unchanged: 2 })

    const first = getDb()
      .select()
      .from(profileImports)
      .all()
      .find(row => row.summary.imported === 2)!

    await app.inject({
      method: 'PATCH',
      url: '/api/titles/tmdb:movie:9001/mine?language=en-US',
      cookies: authed(),
      payload: { rating: 3 },
    })

    res = await app.inject({
      method: 'POST',
      url: `/api/profiles/${profileId}/imports/${first.id}/undo`,
      cookies: authed(),
    })
    expect(res.json()).toEqual({ restored: 1, kept: 1 })
    expect(ratingOf('tmdb:movie:9001')?.rating).toBe(3)
  })

  it('отмена — неделю, история — 90 дней', async () => {
    const job = await readyJob([{ name: 'ratings.csv', data: IMDB_CSV }])

    await apply(job.id, 'keep')
    purgeImports(Date.now() + UNDO_WINDOW_MS + 1000)

    let res = await app.inject({
      url: `/api/profiles/${profileId}/imports`,
      cookies: authed(),
    })

    expect(res.json().last.canUndo).toBe(false)

    purgeImports(Date.now() + 91 * 24 * 60 * 60 * 1000)
    res = await app.inject({
      url: `/api/profiles/${profileId}/imports`,
      cookies: authed(),
    })
    expect(res.json().last).toBeNull()
  })
})

const WATCHED_MOVIE = 'tmdb:movie:9001'
const WATCHED_SERIES = 'tmdb:tv:9002'
function watchedFile(
  entries: unknown[] = [
    { list: 'watched', title: 'Synthetic Harbor', kind: 'movie', tmdbId: 9001 },
    { list: 'watched', title: 'Synthetic Ward', kind: 'series', tmdbId: 9002 },
  ],
) {
  return {
    name: 'watched.json',
    data: JSON.stringify({ format: 'torsher-import', version: 1, entries }),
  }
}
function undo(id: string) {
  return app.inject({
    method: 'POST',
    url: `/api/profiles/${profileId}/imports/${id}/undo`,
    cookies: authed(),
  })
}

describe('импорт title-level watched', () => {
  it('смешивает списки по тайтлу, не создаёт эпизоды, повтор сохраняет stamp, ручное сопоставление вне undo', async () => {
    updateMine(profileId, WATCHED_MOVIE, { watchlist: true })
    const files = [
      watchedFile([
        {
          list: 'watched',
          title: 'Synthetic Harbor',
          kind: 'movie',
          tmdbId: 9001,
        },
        {
          list: 'watched',
          title: 'Synthetic Harbor',
          kind: 'movie',
          tmdbId: 9001,
        },
        {
          list: 'watched',
          title: 'Synthetic Ward',
          kind: 'series',
          tmdbId: 9002,
        },
        { list: 'watched', title: 'Unknown Synthetic Mark', kind: 'series' },
      ]),
      { name: 'ratings.csv', data: IMDB_CSV },
      {
        name: 'watchlist.json',
        data: JSON.stringify([
          {
            type: 'movie',
            movie: { title: 'Synthetic Harbor', ids: { tmdb: 9001 } },
          },
          {
            type: 'show',
            show: { title: 'Synthetic Ward', ids: { tmdb: 9002 } },
          },
        ]),
      },
    ]
    let job = await readyJob(files)
    expect(job.preview).toMatchObject({
      watched: { new: 2, same: 0 },
      watchlist: { new: 1, same: 1 },
      ratings: { new: 1, conflicts: 1 },
      notFound: 1,
    })
    const applied = await apply(job.id, 'keep')
    expect(applied.json()).toMatchObject({ imported: 2, unmatched: 1 })
    const stamp = ratingOf(WATCHED_SERIES)!.watchedMarkedAt
    expect(stamp).toBeInstanceOf(Date)
    expect(ratingOf(WATCHED_MOVIE)).toMatchObject({
      watchlistAt: null,
      rating: 5,
      watchedMarkedAt: expect.any(Date),
    })
    expect(ratingOf(WATCHED_SERIES)).toMatchObject({
      watchlistAt: expect.any(Date),
      rating: 6,
    })
    expect(
      (await getTitleMine(profileId, WATCHED_SERIES, 'en-US')).status,
    ).toBe('watched')
    expect(getDb().select().from(titleProgress).all()).toEqual([])
    expect(lastWatchedAt([])).toBeUndefined()
    expect(
      watchedTitles(profileId, [WATCHED_MOVIE, WATCHED_SERIES, 'tmdb:tv:9999']),
    ).toEqual(new Set([WATCHED_MOVIE, WATCHED_SERIES]))
    job = await readyJob(files)
    expect(job.preview.watched).toEqual({ new: 0, same: 2 })
    expect((await apply(job.id, 'keep')).json()).toMatchObject({
      imported: 0,
      unchanged: 2,
    })
    expect(ratingOf(WATCHED_SERIES)!.watchedMarkedAt).toEqual(stamp)
    const unmatched = (
      await app.inject({
        url: `/api/profiles/${profileId}/imports/unmatched`,
        cookies: authed(),
      })
    ).json()
    expect(unmatched.items[0]).toMatchObject({ list: 'watched', rating: null })
    const manualId = 'tmdb:tv:9998'
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/profiles/${profileId}/imports/unmatched/${unmatched.items[0].id}`,
          cookies: authed(),
          payload: { titleId: manualId },
        })
      ).statusCode,
    ).toBe(204)
    expect(ratingOf(manualId)!.watchedMarkedAt).toBeInstanceOf(Date)
    expect((await undo(applied.json().id)).json()).toEqual({
      restored: 2,
      kept: 0,
    })
    expect(ratingOf(WATCHED_MOVIE)).toMatchObject({
      watchlistAt: expect.any(Date),
      watchedMarkedAt: null,
    })
    expect(ratingOf(WATCHED_SERIES)).toBeUndefined()
    expect(ratingOf(manualId)!.watchedMarkedAt).toBeInstanceOf(Date)
  })

  it('просмотр и unwatch в ту же миллисекунду не воскресают через undo; выбор источника сохраняет mark', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T12:00:00Z'))
    try {
      updateMine(profileId, WATCHED_SERIES, { favorite: true })
      const job = await readyJob([watchedFile()])
      const applied = await apply(job.id, 'keep')
      const ref = { profileId, titleId: WATCHED_SERIES, season: 1, episode: 1 }
      getDb()
        .insert(torrents)
        .values({
          id: 'synthetic-choice',
          infoHash: '9'.repeat(40),
          name: 'Synthetic',
          source: 'file',
          status: 'ready',
        })
        .onConflictDoNothing()
        .run()
      rememberChoice(ref, { torrentId: 'synthetic-choice', fileIndex: 0 })
      rememberVoice(ref, { studio: 'Synthetic Voice' })
      saveTitleProgress(ref, {
        position: 0,
        duration: 2000,
        torrentId: null,
        fileIndex: null,
      })
      expect(ratingOf(WATCHED_SERIES)!.watchedMarkedAt).not.toBeNull()
      saveTitleProgress(ref, {
        position: 20,
        duration: 2000,
        torrentId: null,
        fileIndex: null,
      })
      expect(ratingOf(WATCHED_SERIES)!.watchedMarkedAt).toBeNull()
      expect(ratingOf(WATCHED_SERIES)!.updatedAt.getTime()).toBeGreaterThan(
        new Date(applied.json().appliedAt ?? Date.now()).getTime(),
      )
      markWatched({ profileId, titleId: WATCHED_MOVIE }, false)
      expect((await undo(applied.json().id)).json()).toEqual({
        restored: 0,
        kept: 2,
      })
      expect(ratingOf(WATCHED_MOVIE)!.watchedMarkedAt).toBeNull()
      expect(ratingOf(WATCHED_SERIES)!.watchedMarkedAt).toBeNull()
      expect(getTitleProgress(ref)?.position).toBe(20)
      // Новое явное применение после просмотра снова создаёт отметку, не стирая progress.
      const again = await readyJob([watchedFile()])
      expect(again.preview.watched).toEqual({ new: 2, same: 0 })
      await apply(again.id, 'keep')
      expect(getTitleProgress(ref)?.position).toBe(20)
      // Серия без строк прогресса: снятие с карточки удаляет marker-only row.
      const empty = 'tmdb:tv:9997'
      getDb()
        .insert(profileTitles)
        .values({ profileId, titleId: empty, watchedMarkedAt: new Date() })
        .run()
      await markTitleWatched(profileId, empty, false, 'en-US')
      expect(ratingOf(empty)).toBeUndefined()
      expect(
        getTitleProgress({ profileId, titleId: empty, season: 1, episode: 1 }),
      ).toBeUndefined()
    }
    finally {
      vi.useRealTimers()
    }
  })
})

it('обычные правки списков и снятие оценки сохраняют marker-only строку и приоритет dropped', async () => {
  getDb()
    .insert(profileTitles)
    .values({ profileId, titleId: WATCHED_SERIES, watchedMarkedAt: new Date() })
    .run()
  updateMine(profileId, WATCHED_SERIES, { rating: 8, watchlist: true })
  updateMine(profileId, WATCHED_SERIES, { rating: null, watchlist: false })
  expect(ratingOf(WATCHED_SERIES)).toMatchObject({
    watchedMarkedAt: expect.any(Date),
    rating: null,
    watchlistAt: null,
  })
  updateMine(profileId, WATCHED_SERIES, { dropped: true })
  expect((await getTitleMine(profileId, WATCHED_SERIES, 'en-US')).status).toBe(
    'dropped',
  )
  updateMine(profileId, WATCHED_SERIES, { dropped: false })
  expect((await getTitleMine(profileId, WATCHED_SERIES, 'en-US')).status).toBe(
    'watched',
  )
})

describe('external viewing history', () => {
  const annotated
    = 'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Note,Context,Watched Date'
  const lanterns = 'tmdb:movie:9003'
  const watchedAt = '2026-03-21T13:00:00.000Z'

  function traktMovie(id: number, titleId = 9001) {
    return {
      id,
      type: 'movie',
      watched_at: watchedAt,
      movie: { title: 'Synthetic movie', ids: { tmdb: titleId } },
    }
  }

  function historyFile(items: unknown[]) {
    return { name: 'history.json', data: JSON.stringify(items) }
  }

  async function imported(
    files: Array<{ name: string, data: string | Buffer }>,
    policy = 'keep',
  ) {
    const job = await readyJob(files)
    const result = await apply(job.id, policy)
    expect(result.statusCode).toBe(200)
    return { job, result: result.json() }
  }

  function entries() {
    return getDb()
      .select()
      .from(diaryEntries)
      .where(eq(diaryEntries.profileId, profileId))
      .all()
  }

  function seen() {
    return getDb()
      .select()
      .from(diarySeen)
      .where(eq(diarySeen.profileId, profileId))
      .all()
  }

  async function pending(target = profileId) {
    const response = await app.inject({
      url: `/api/profiles/${target}/imports/unmatched?language=en-US`,
      cookies: authed(),
    })
    expect(response.statusCode).toBe(200)
    return response.json()
  }

  function manualMatch(rowId: string, titleId: string, target = profileId) {
    return app.inject({
      method: 'POST',
      url: `/api/profiles/${target}/imports/unmatched/${rowId}`,
      cookies: authed(),
      payload: { titleId },
    })
  }

  it('uses a Letterboxd watched-only import as a weak seed without inventing a date', async () => {
    const target = getDb()
      .insert(profiles)
      .values({ name: 'Separate viewer', color: 'blue' })
      .returning()
      .get()
    const job = await readyJob(
      [
        {
          name: 'watched.csv',
          data: 'Date,Name,Year,Letterboxd URI\n2024-03-04,Paper Lanterns,2018,https://letterboxd.com/film/paper-lanterns/\n',
        },
      ],
      target.id,
    )
    expect((await apply(job.id, 'keep', target.id)).statusCode).toBe(200)
    expect(
      getDb()
        .select()
        .from(diaryEntries)
        .where(eq(diaryEntries.profileId, target.id))
        .all(),
    ).toEqual([])
    expect(
      getDb()
        .select()
        .from(diarySeen)
        .where(eq(diarySeen.profileId, target.id))
        .all(),
    ).toMatchObject([{ titleId: lanterns, season: 0, episode: 0 }])
    expect(
      recommendationSignals(target, 'en-US', 'UTC', Date.now()).seeds,
    ).toEqual([
      {
        id: lanterns,
        strength: 24,
        at: 0,
        rating: null,
        favorite: false,
        watched: true,
      },
    ])
    storeMetaCache('tmdb:movie:9003:en-US:v3', {
      ...movie,
      id: 9003,
      title: 'Paper Lanterns',
    })
    storeMetaCache(
      recommendationList({ type: 'movie', tmdbId: 9003 }, 'en-US').key,
      {
        results: [
          { id: 9195, title: 'Evening Signal', release_date: '2024-01-02' },
        ],
      },
    )
    const network = fetchMock.mock.calls.length
    const result = await app.inject({
      url: '/api/mine/v1/recommendations',
      query: { expectedProfileId: target.id, refresh: 'poll' },
      cookies: { ...authed(), [PROFILE_COOKIE]: target.id },
    })
    expect(result.statusCode, result.body).toBe(200)
    expect(result.json()).toMatchObject({
      hasPersonalSignals: true,
      items: [
        {
          card: { id: 'tmdb:movie:9195' },
          reason: {
            kind: 'watchedSeed',
            titleId: lanterns,
            title: 'Paper Lanterns',
          },
        },
      ],
    })
    expect(fetchMock).toHaveBeenCalledTimes(network)
  })

  it('keeps Letterboxd diary viewings separate from watched flags and explicit rating/watchlist edits', async () => {
    const row
      = '2024-03-04,Paper Lanterns,2018,https://letterboxd.com/film/paper-lanterns/,,Yes,Own note,Balcony,2024-03-03'
    const diary = `${annotated}\n${row}\n${row}\n`
    const archive = buildZip({
      'diary.csv': diary,
      'watched.csv':
        'Date,Name,Year,Letterboxd URI\n2024-03-04,Paper Lanterns,2018,https://letterboxd.com/film/paper-lanterns/\n',
    })
    const db = getDb()
    updateMine(profileId, lanterns, { watchlist: true })
    const follow = db
      .insert(follows)
      .values({
        titleId: lanterns,
        kind: 'movie',
        state: 'active',
        startSeason: 0,
        startEpisode: 0,
        requireRussian: false,
        waitHours: 1,
      })
      .returning()
      .get()
    db.insert(followProfiles).values({ followId: follow.id, profileId }).run()
    const ref = { profileId, titleId: lanterns, season: 0, episode: 0 }
    db.insert(titleProgress)
      .values({
        ...ref,
        position: 10,
        duration: 200,
        voiceStudio: 'Existing choice',
        mediaFileId: 'fixture-cursor',
      })
      .run()
    const progress = getTitleProgress(ref)
    const priorMine = ratingOf(lanterns)

    const { job, result } = await imported([
      { name: 'letterboxd.zip', data: archive },
      {
        name: 'ratings-movies.json',
        data: JSON.stringify([
          { ...traktMovie(2), watched_at: undefined, rating: 8 },
        ]),
      },
      {
        name: 'watchlist.json',
        data: JSON.stringify([
          {
            ...traktMovie(2, 9004),
            watched_at: undefined,
            listed_at: watchedAt,
          },
        ]),
      },
    ])

    expect(job.preview.ratings.conflicts).toBe(1)
    expect(job.preview.history).toEqual({
      new: 2,
      same: 0,
      seen: { new: 1, same: 0 },
      skipped: 0,
    })
    expect(result.history).toEqual(job.preview.history)
    expect(entries()).toHaveLength(2)
    expect(entries()[0]).toMatchObject({
      titleId: lanterns,
      precision: 'day',
      day: '2024-03-03',
      instant: null,
      note: 'Own note',
      viewingContext: 'Balcony',
      rewatch: true,
    })
    expect(new Set(entries().map(row => row.originKey)).size).toBe(2)
    expect(seen()).toEqual([
      expect.objectContaining({ titleId: lanterns, season: 0, episode: 0 }),
    ])
    expect(getTitleProgress(ref)).toEqual(progress)
    expect(ratingOf(lanterns)).toEqual(priorMine)
    expect(ratingOf(WATCHED_MOVIE)?.rating).toBe(5)
    expect(ratingOf('tmdb:movie:9004')?.watchlistAt).toBeInstanceOf(Date)
    expect(
      db.select().from(follows).where(eq(follows.id, follow.id)).get(),
    ).toEqual(follow)
    expect(
      db
        .select()
        .from(watchStates)
        .where(eq(watchStates.profileId, profileId))
        .all(),
    ).toEqual([])
    expect(
      db
        .select()
        .from(cyclePlaybackFacts)
        .where(eq(cyclePlaybackFacts.profileId, profileId))
        .all(),
    ).toEqual([])

    expect((await apply(job.id, 'keep')).statusCode).toBe(404)
    const local = entries()[0]!
    db.update(diaryEntries)
      .set({ note: 'Local edit', day: '2024-03-02' })
      .where(
        and(
          eq(diaryEntries.profileId, profileId),
          eq(diaryEntries.id, local.id),
        ),
      )
      .run()
    const afterEdit = entries()
    const seenAfterEdit = seen()
    const replay = await imported([
      {
        name: 'renamed-diary.csv',
        data: diary
          .replaceAll('Own note', 'Edited in export')
          .replaceAll(',,Yes', ',3,Yes'),
      },
    ])
    expect(replay.result.history).toMatchObject({
      new: 0,
      same: 2,
      skipped: 0,
    })
    expect(entries()).toEqual(afterEdit)
    expect(seen()).toEqual(seenAfterEdit)
  })

  it('imports Trakt events and whole-show seen separately, then round-trips exact facts through native v2', async () => {
    const movie = JSON.stringify({ ...traktMovie(1), notes: 'Own Trakt note' })
    const data = `[${movie.replace('"id":1', '"id":9007199254740992')},
      ${movie.replace('"id":1', '"id":9007199254740993')},
      {"id":9223372036854775807,"type":"episode","episode":{"season":0,"number":2,"ids":{"tmdb":9942}},"show":{"title":"Synthetic Ward","ids":{"tmdb":9002}}},
      {"type":"show","show":{"title":"Synthetic Ward","ids":{"tmdb":9002}},"plays":15,"last_watched_at":"2026-03-22T13:00:00Z"}]`
    const file = { name: 'history-2.json', data }
    const { result } = await imported([
      file,
      { ...file, name: 'history-copy.json' },
    ])
    expect(result.history).toEqual({
      new: 3,
      same: 0,
      seen: { new: 3, same: 0 },
      skipped: 0,
    })
    expect(
      entries()
        .map(row => [
          row.originKey,
          row.titleId,
          row.season,
          row.episode,
          row.precision,
          row.instant?.toISOString(),
        ])
        .sort(),
    ).toEqual([
      ['id:9007199254740992', WATCHED_MOVIE, 0, 0, 'instant', watchedAt],
      ['id:9007199254740993', WATCHED_MOVIE, 0, 0, 'instant', watchedAt],
      ['id:9223372036854775807', WATCHED_SERIES, 0, 2, 'unknown', undefined],
    ])
    expect(
      seen()
        .map(row => [row.titleId, row.season, row.episode])
        .sort(),
    ).toEqual([
      [WATCHED_MOVIE, 0, 0],
      [WATCHED_SERIES, 0, 0],
      [WATCHED_SERIES, 0, 2],
    ])
    expect(entries().every(row => !row.rewatch)).toBe(true)

    const exported = await app.inject({
      method: 'POST',
      url: '/api/transfer/export',
      cookies: authed(),
      payload: { scope: 'profile', profileId },
    })
    expect(exported.statusCode).toBe(200)
    const document = parseExportDocument(exported.body)
    if (document.version !== 2)
      throw new Error('Expected v2 export')

    expect(
      document.personalSpace.diary.map(row => row.sourceMatchKey),
    ).toEqual([
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.stringMatching(/^[0-9a-f]{64}$/),
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ])

    const db = getDb()
    const target = db
      .insert(profiles)
      .values({ name: 'Restore target', color: 'blue' })
      .returning()
      .get()
      .id
    try {
      const job = await app.inject({
        method: 'POST',
        url: `/api/profiles/${target}/imports`,
        cookies: authed(),
        payload: {
          files: [
            {
              name: 'native.json',
              data: Buffer.from(exported.body).toString('base64'),
            },
          ],
        },
      })
      expect(job.statusCode).toBe(202)
      const restored = await app.inject({
        method: 'POST',
        url: `/api/profiles/${target}/imports/${job.json().id}/apply`,
        cookies: authed(),
        payload: { conflicts: 'newer' },
      })
      expect(restored.statusCode).toBe(200)
      const again = await app.inject({
        method: 'POST',
        url: '/api/transfer/export',
        cookies: authed(),
        payload: { scope: 'profile', profileId: target },
      })
      expect(parseExportDocument(again.body)).toMatchObject({
        personalSpace: document.personalSpace,
      })
    }
    finally {
      db.delete(profiles).where(eq(profiles.id, target)).run()
    }
  })

  it('queues a group of unresolved viewings once and applies all related batches on manual match', async () => {
    const row
      = '2024-03-04,Unresolved Movie,2018,https://letterboxd.com/film/unresolved/,,,,,2024-03-03'
    const diary = { name: 'diary.csv', data: `${annotated}\n${row}\n${row}\n` }
    const first = await imported([diary])
    expect(first.result.unmatched).toBe(1)
    expect(
      (await imported([{ ...diary, name: 'copy.csv' }])).result.unmatched,
    ).toBe(0)
    const later = await imported([
      {
        name: 'diary.csv',
        data: `${annotated}\n${row.replace('2024-03-03', '2024-03-02')}\n`,
      },
    ])

    const unresolved = await pending()
    expect(unresolved.total).toBe(2)
    expect(
      unresolved.items
        .map((row: { historyCount: number }) => row.historyCount)
        .sort(),
    ).toEqual([1, 2])
    expect(
      await manualMatch(unresolved.items[0].id, WATCHED_SERIES).then(res =>
        res.json(),
      ),
    ).toEqual({ kind: 'historyMatchConflict', reason: 'titleKind' })
    expect(
      (await manualMatch(unresolved.items[0].id, WATCHED_MOVIE)).statusCode,
    ).toBe(204)
    expect(entries()).toHaveLength(3)
    expect((await pending()).total).toBe(0)
    expect((await imported([diary])).result).toMatchObject({
      unmatched: 0,
      history: { same: 2 },
    })

    expect((await undo(first.result.id)).statusCode).toBe(200)
    expect((await undo(later.result.id)).statusCode).toBe(200)
    expect(entries()).toHaveLength(3)
    expect(seen()).toHaveLength(1)
  })

  it('reports a manual mapping conflict without deleting the unresolved group or overwriting the event', async () => {
    const event = traktMovie(199)
    const first = await imported([
      historyFile([{ ...event, movie: { title: 'Still Unknown' } }]),
    ])
    expect(first.result.unmatched).toBe(1)
    const second = await imported([historyFile([event])])
    const firstSeen = seen()[0]!
    const [unresolved] = (await pending()).items
    const original = entries()

    const conflict = await manualMatch(unresolved.id, lanterns)
    expect(conflict.statusCode).toBe(409)
    expect(conflict.json()).toEqual({
      kind: 'historyMatchConflict',
      reason: 'sourceIdentity',
    })
    expect((await pending()).total).toBe(1)
    expect(entries()).toEqual(original)
    expect((await manualMatch(unresolved.id, WATCHED_MOVIE)).statusCode).toBe(
      204,
    )
    const [confirmed] = entries()
    expect(entries()).toHaveLength(1)
    expect(confirmed).toEqual({
      ...original[0],
      mutationToken: expect.any(String),
      sourceMatchKey: expect.stringMatching(/^[0-9a-f]{64}$/),
    })
    expect(confirmed!.mutationToken).not.toBe(original[0]!.mutationToken)
    expect(seen()[0]?.mutationToken).not.toBe(firstSeen.mutationToken)
    expect((await pending()).total).toBe(0)
    expect((await undo(second.result.id)).json()).toEqual({
      kept: 2,
      restored: 0,
    })
    expect(entries()).toEqual([confirmed])
    expect(seen()).toHaveLength(1)

    const replay = await imported([
      historyFile([{ ...event, movie: { title: 'Still Unknown' } }]),
    ])
    expect(replay.result).toMatchObject({
      unmatched: 0,
      history: { same: 1, skipped: 0 },
    })
    expect(entries()).toEqual([confirmed])
  })

  function unknownEpisode(
    id: number,
    episode: number,
    title = 'Unresolved series',
  ) {
    return {
      id,
      type: 'episode',
      watched_at: watchedAt,
      show: { title },
      episode: { season: 1, number: episode },
    }
  }

  it('moves a distinct origin with its own match proof when another entry has the same UUID', async () => {
    await imported([
      historyFile([
        {
          ...unknownEpisode(101, 1),
          show: { title: 'Known series', ids: { tmdb: 9002 } },
          note: 'Local event note',
        },
      ]),
    ])
    const [local] = entries()
    const db = getDb()
    const source = db
      .insert(profiles)
      .values({ name: 'Move source', color: 'blue' })
      .returning()
      .get()
      .id
    try {
      const file = historyFile([
        {
          ...unknownEpisode(202, 1, 'Imported series'),
          note: 'Source event note',
        },
      ])
      const ready = await readyJob([file], source)
      expect((await apply(ready.id, 'keep', source)).statusCode).toBe(200)
      const [item] = (await pending(source)).items
      expect(
        (await manualMatch(item.id, WATCHED_SERIES, source)).statusCode,
      ).toBe(204)

      // Two independent profiles can legally use the same local UUID.
      const sourceEntry = eq(diaryEntries.profileId, source)
      db.update(diaryEntries).set({ id: local!.id }).where(sourceEntry).run()
      const existing = db.select().from(diaryEntries).where(sourceEntry).get()!
      expect(existing.sourceMatchKey).toEqual(expect.any(String))
      expect(existing.sourceMatchKey).not.toBe(local!.sourceMatchKey)

      const moved = await app.inject({
        method: 'DELETE',
        url: `/api/profiles/${source}?moveTo=${profileId}`,
        cookies: authed(),
      })
      expect(moved.statusCode).toBe(200)
      const matches = entries()
      expect(matches).toHaveLength(2)
      expect(matches.find(row => row.originKey === 'id:101')).toEqual(local)
      const copied = matches.find(row => row.originKey === 'id:202')!
      expect(copied).toEqual({
        ...existing,
        id: expect.any(String),
        profileId,
        mutationToken: expect.any(String),
      })
      expect(copied.id).not.toBe(local!.id)

      const replay = await imported([file])
      expect(replay.result).toMatchObject({
        unmatched: 0,
        history: { new: 0, same: 1, skipped: 0 },
      })
      expect(entries()).toEqual(matches)
      const response = await app.inject({
        method: 'POST',
        url: '/api/transfer/export',
        cookies: authed(),
        payload: { scope: 'profile', profileId },
      })
      expect(response.statusCode).toBe(200)
      expect(parseExportDocument(response.body)).toMatchObject({
        personalSpace: {
          diary: expect.arrayContaining([
            expect.objectContaining({
              id: local!.id,
              originKey: 'id:101',
              sourceMatchKey: local!.sourceMatchKey,
              note: 'Local event note',
            }),
            expect.objectContaining({
              id: copied.id,
              originKey: 'id:202',
              sourceMatchKey: existing.sourceMatchKey,
              note: 'Source event note',
            }),
          ]),
        },
      })
    }
    finally {
      db.delete(profiles).where(eq(profiles.id, source)).run()
    }
  })

  it('uses both the recorded matching proof and episode coordinates for unresolved replays', async () => {
    const original = unknownEpisode(77, 1)
    await imported([historyFile([original])])
    const row = (await pending()).items[0]
    expect((await manualMatch(row.id, WATCHED_SERIES)).statusCode).toBe(204)
    const previous = entries()
    expect(previous[0]?.sourceMatchKey).toMatch(/^[0-9a-f]{64}$/)

    const exact = await imported([historyFile([original])])
    expect(exact.result).toMatchObject({
      unmatched: 0,
      history: { new: 0, same: 1, skipped: 0 },
    })

    for (const conflicting of [
      unknownEpisode(77, 2),
      unknownEpisode(77, 1, 'Another unresolved series'),
    ]) {
      const clash = await imported([historyFile([conflicting])])
      expect(clash.job.preview.skipped).toBe(1)
      expect(clash.result).toMatchObject({
        unmatched: 0,
        history: { new: 0, same: 0, skipped: 1 },
      })
    }
    expect(entries()).toEqual(previous)
    expect(seen()).toEqual([
      expect.objectContaining({
        titleId: WATCHED_SERIES,
        season: 1,
        episode: 1,
      }),
    ])
    expect((await pending()).total).toBe(0)
  })

  it('does not merge a conflicting unresolved duplicate into a pending group', async () => {
    const original = unknownEpisode(78, 1)
    expect((await imported([historyFile([original])])).result.unmatched).toBe(
      1,
    )
    const [row] = (await pending()).items

    const exact = await imported([historyFile([original])])
    expect(exact.result).toMatchObject({
      unmatched: 0,
      history: { new: 0, same: 0, skipped: 0 },
    })
    const anotherKind = {
      id: 78,
      type: 'movie',
      movie: { title: 'Unresolved movie' },
      watched_at: watchedAt,
    }
    for (const conflicting of [
      unknownEpisode(78, 2),
      unknownEpisode(78, 1, 'Another series'),
      anotherKind,
    ]) {
      const clash = await imported([historyFile([conflicting])])
      expect(clash.job.preview.skipped).toBe(1)
      expect(clash.result).toMatchObject({
        unmatched: 0,
        history: { new: 0, same: 0, skipped: 1 },
      })
    }

    expect((await pending()).items).toEqual([row])
    expect((await manualMatch(row.id, WATCHED_SERIES)).statusCode).toBe(204)
    expect(entries()).toEqual([
      expect.objectContaining({
        season: 1,
        episode: 1,
        titleId: WATCHED_SERIES,
        originKey: 'id:78',
      }),
    ])
  })

  it('keeps the multiplicity across pages of one archive and makes replay a no-op', async () => {
    const data = JSON.stringify([{ ...traktMovie(1), id: undefined }])
    const archive = buildZip({
      'Export/history-2.json': data,
      'Export/history-1.json': data,
    })
    const first = await imported([{ name: 'first.zip', data: archive }])
    expect(first.result.history).toMatchObject({ new: 2, same: 0 })
    const previous = entries()
    expect(previous).toHaveLength(2)
    expect(seen()).toHaveLength(1)

    const repacked = buildZip({
      'Another/history-1.json': data,
      'Another/history-2.json': data,
    })
    const replay = await imported([{ name: 'renamed.zip', data: repacked }])
    expect(replay.result.history).toMatchObject({ new: 0, same: 2 })
    expect(entries()).toEqual(previous)
  })

  it('does not add indistinguishable rows across independent history archives', async () => {
    const data = JSON.stringify([{ ...traktMovie(1), id: undefined }])
    const first = buildZip({ 'history-1.json': data })
    const second = buildZip({ 'history-2.json': data })
    const batch = await imported([
      { name: 'first.zip', data: first },
      { name: 'second.zip', data: second },
    ])
    expect(batch.result.history).toMatchObject({ new: 1, same: 0 })
    expect(entries()).toHaveLength(1)
    expect(seen()).toHaveLength(1)
  })

  it('keeps a mark in use by a later batch', async () => {
    const first = await imported([historyFile([traktMovie(10)])])
    const firstMark = seen()[0]!.mutationToken
    await imported([historyFile([traktMovie(11)])])
    const laterMark = seen()[0]!.mutationToken

    expect(laterMark).not.toBe(firstMark)
    expect((await undo(first.result.id)).json()).toEqual({
      kept: 2,
      restored: 0,
    })
    expect(entries()).toHaveLength(2)
    expect(seen()[0]?.mutationToken).toBe(laterMark)
  })

  it.each(['note', 'unwatch', 'recreate'] as const)(
    'preserves a group edited after import (%s) and rolls back an independent event',
    async (change) => {
      const db = getDb()
      const applied = await imported([
        historyFile([traktMovie(12), traktMovie(13, 9003)]),
      ])
      const current = entries().find(row => row.titleId === WATCHED_MOVIE)!
      const ref = and(
        eq(diaryEntries.profileId, profileId),
        eq(diaryEntries.id, current.id),
      )
      if (change === 'unwatch') {
        await markTitleWatched(profileId, WATCHED_MOVIE, false, 'en-US')
      }
      else if (change === 'note') {
        db.update(diaryEntries).set({ note: 'Later note' }).where(ref).run()
      }
      else {
        db.delete(diaryEntries).where(ref).run()
        db.insert(diaryEntries).values(current).run()
      }
      const expected = db.select().from(diaryEntries).where(ref).get()
      const undone = await undo(applied.result.id)

      expect(undone.json()).toEqual({ kept: 2, restored: 2 })
      expect(entries()).toEqual([expected])
      expect(seen().map(row => row.titleId)).toEqual(
        change === 'unwatch' ? [] : [WATCHED_MOVIE],
      )
      expect((await undo(applied.result.id)).statusCode).toBe(409)
    },
  )

  it('does not apply cancelled history and ages out unresolved groups', async () => {
    const file = historyFile([
      { ...traktMovie(77), movie: { title: 'Unknown Film' } },
    ])
    const job = await readyJob([file])
    const cancelled = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${profileId}/imports/${job.id}`,
      cookies: authed(),
    })
    expect(cancelled.statusCode).toBe(204)
    expect((await apply(job.id, 'keep')).statusCode).toBe(404)
    expect(entries()).toEqual([])
    await imported([file])
    expect((await pending()).total).toBe(1)
    purgeImports(Date.now() + 91 * 24 * 60 * 60 * 1000)
    expect((await pending()).total).toBe(0)
  })
})
