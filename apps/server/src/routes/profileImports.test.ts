import type { ImportUndoEntry } from '../db/schema.ts'
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
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import {
  metaCache,
  profileImports,
  profileTitles,
  titleExternalIds,
  titleProgress,
  torrents,
  users,
} from '../db/schema.ts'
import { movie } from '../services/tmdb/fixtures/index.ts'
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

function upload(files: Array<{ name: string, data: string | Buffer }>) {
  return app.inject({
    method: 'POST',
    url: `/api/profiles/${profileId}/imports`,
    cookies: authed(),
    payload: {
      files: files.map(file => ({
        name: file.name,
        data: Buffer.from(file.data).toString('base64'),
      })),
    },
  })
}

async function readyJob(files: Array<{ name: string, data: string | Buffer }>) {
  const res = await upload(files)

  expect(res.statusCode).toBe(202)

  const { id } = res.json()

  await importJobSettled(id)

  return (
    await app.inject({
      url: `/api/profiles/${profileId}/imports/${id}`,
      cookies: authed(),
    })
  ).json()
}

function apply(id: string, conflicts: string) {
  return app.inject({
    method: 'POST',
    url: `/api/profiles/${profileId}/imports/${id}/apply`,
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

  it('старый undo без нового поля сохраняет current mark при восстановлении остальных полей', async () => {
    const job = await readyJob([watchedFile()])
    const applied = await apply(job.id, 'keep')
    const db = getDb()
    const row = db
      .select()
      .from(profileImports)
      .where(eq(profileImports.id, applied.json().id))
      .get()!
    const undoRows = row.undo!.filter(
      (item): item is ImportUndoEntry => !('table' in item),
    )
    for (const entry of undoRows) {
      if (entry.before)
        delete entry.before.watchedMarkedAt
    }
    db.update(profileImports)
      .set({ undo: undoRows })
      .where(eq(profileImports.id, row.id))
      .run()
    expect((await undo(row.id)).statusCode).toBe(200)
    expect(ratingOf(WATCHED_MOVIE)).toMatchObject({
      rating: 5,
      watchedMarkedAt: expect.any(Date),
    })
    expect(
      db
        .select()
        .from(titleProgress)
        .where(
          and(
            eq(titleProgress.profileId, profileId),
            eq(titleProgress.titleId, WATCHED_MOVIE),
          ),
        )
        .all(),
    ).toEqual([])
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
