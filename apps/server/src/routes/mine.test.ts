import type { TmdbTv } from '../services/tmdb/types.ts'
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
import { setImdbEnabled } from '../services/ratings/imdb/state.ts'
import * as imdbStore from '../services/ratings/imdb/store.ts'
import { ACCESS_TOKEN_COOKIE } from '../config.ts'
import { getDb, migrateDb } from '../db/index.ts'
import { profileTitles, titleProgress, users } from '../db/schema.ts'
import {
  emptyList,
  movie,
  season,
  tvOngoing,
} from '../services/tmdb/fixtures/index.ts'
import { signToken } from '../utils/token.ts'

const app = createApp()
const fetchMock = vi.fn<typeof fetch>()

const MOVIE = 'tmdb:movie:603'
const SERIES = 'tmdb:tv:2000'
const DAY_MS = 24 * 60 * 60 * 1000

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10)
}

// Последняя серия идущего сезона вышла позавчера
const ongoing = {
  ...tvOngoing,
  vote_count: 500,
  last_episode_to_air: {
    season_number: 2,
    episode_number: 4,
    air_date: daysAgo(2),
  },
} as TmdbTv

function authed() {
  return { [ACCESS_TOKEN_COOKIE]: signToken('user-1', 'user_access') }
}

function tmdbResponse(url: string) {
  const { pathname } = new URL(url)

  if (pathname === '/3/movie/603')
    return { ...movie, imdb_id: 'tt0000603' }
  if (pathname === '/3/tv/2000')
    return ongoing
  if (pathname === '/3/tv/2000/season/2')
    return season

  return emptyList
}

let profileId: string

function patchMine(id: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/titles/${id}/mine?language=ru-RU`,
    cookies: authed(),
    payload,
  })
}

function items(query: string) {
  return app.inject({
    url: `/api/mine/items?language=ru-RU&${query}`,
    cookies: authed(),
  })
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
  getDb().delete(profileTitles).run()
  getDb().delete(titleProgress).run()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('/api/titles/:id/mine', () => {
  it('ставит списки и оценку; оценённый фильм уходит из «Позже» и становится просмотренным', async () => {
    let res = await patchMine(MOVIE, { watchlist: true, favorite: true })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      watchlist: true,
      favorite: true,
      rating: null,
      status: null,
    })

    res = await patchMine(MOVIE, { rating: 9 })

    expect(res.json()).toMatchObject({
      watchlist: false,
      favorite: true,
      rating: 9,
      status: 'watched',
    })
  })

  it('пустое состояние удаляет строку', async () => {
    await patchMine(MOVIE, { favorite: true })
    await patchMine(MOVIE, { favorite: false })

    expect(getDb().select().from(profileTitles).all()).toEqual([])
  })

  it('отвечает 400 на оценку вне 1–10 и 404 на чужой ID', async () => {
    expect((await patchMine(MOVIE, { rating: 11 })).statusCode).toBe(400)
    expect((await patchMine('local:1', { favorite: true })).statusCode).toBe(
      404,
    )
  })

  it('«Брошено» снимается следующим просмотром', async () => {
    await app.inject({
      method: 'PUT',
      url: `/api/titles/${SERIES}/watched`,
      cookies: authed(),
      payload: { season: 1, episode: 1, watched: true },
    })

    let res = await patchMine(SERIES, { dropped: true })

    expect(res.json().status).toBe('dropped')

    getDb()
      .update(titleProgress)
      .set({ updatedAt: new Date(Date.now() + 60_000) })
      .run()

    res = await app.inject({
      url: `/api/titles/${SERIES}/mine?language=ru-RU`,
      cookies: authed(),
    })

    expect(res.json().status).toBe('watching')
  })
})

describe('put /api/titles/:id/watched без серии', () => {
  it('отмечает все вышедшие серии сериала и снимает отметки', async () => {
    let res = await app.inject({
      method: 'PUT',
      url: `/api/titles/${SERIES}/watched?language=ru-RU`,
      cookies: authed(),
      payload: { watched: true },
    })

    expect(res.statusCode).toBe(200)
    // Первый сезон целиком и четыре серии второго
    expect(getDb().select().from(titleProgress).all()).toHaveLength(12)

    res = await app.inject({
      url: `/api/titles/${SERIES}/mine?language=ru-RU`,
      cookies: authed(),
    })

    expect(res.json().status).toBe('waiting')

    await app.inject({
      method: 'PUT',
      url: `/api/titles/${SERIES}/watched?language=ru-RU`,
      cookies: authed(),
      payload: { watched: false },
    })

    res = await app.inject({
      url: `/api/titles/${SERIES}/mine?language=ru-RU`,
      cookies: authed(),
    })

    expect(res.json().status).toBeNull()
  })
})

describe('/api/mine', () => {
  it('считает разделы и отдаёт страницу с фильтрами и сортировкой', async () => {
    await patchMine(MOVIE, { favorite: true, rating: 6 })
    await patchMine(SERIES, { favorite: true, rating: 9 })

    const sections = await app.inject({
      url: '/api/mine?language=ru-RU',
      cookies: authed(),
    })

    expect(sections.json().sections).toEqual(
      expect.arrayContaining([
        { id: 'favorites', count: 2 },
        { id: 'watched', count: 1 },
        { id: 'watchlist', count: 0 },
      ]),
    )

    let res = await items('section=favorites&sort=rating')

    expect(res.json().items.map((item: { id: string }) => item.id)).toEqual([
      SERIES,
      MOVIE,
    ])
    expect(res.json().items[0].ownRating).toBe(9)

    res = await items('section=favorites&kind=movie')

    expect(res.json()).toMatchObject({ total: 1, items: [{ id: MOVIE }] })

    res = await items('section=favorites&rating=9-10')

    expect(res.json()).toMatchObject({ total: 1, items: [{ id: SERIES }] })
  })

  it('своя оценка видна всегда, сервисы — по настройке профиля', async () => {
    await patchMine(MOVIE, { favorite: true, rating: 6 })

    const setRatings = (posterRatings: string[]) =>
      app.inject({
        method: 'PATCH',
        url: `/api/profiles/${profileId}`,
        cookies: authed(),
        payload: { posterRatings },
      })
    const first = async () =>
      (await items('section=favorites')).json().items[0]

    // По умолчанию — TMDB, и своя оценка не вытесняет её
    expect(await first()).toMatchObject({
      posterRatings: [{ source: 'tmdb', value: 8.2 }],
      ownRating: 6,
    })

    await setRatings([])

    const clean = await first()

    expect(clean.posterRatings).toBeUndefined()
    expect(clean.ownRating).toBe(6)

    // IMDb выключен на сервере — остаётся только TMDB
    const saved = await setRatings(['imdb', 'tmdb', 'imdb'])

    expect(saved.json().posterRatings).toEqual(['tmdb', 'imdb'])
    expect((await first()).posterRatings).toEqual([
      { source: 'tmdb', value: 8.2 },
    ])

    setImdbEnabled(true)
    vi.spyOn(imdbStore, 'lookupImdbRatings').mockReturnValue(
      new Map([['tt0000603', { value: 7.4, votes: 900 }]]),
    )
    expect((await first()).posterRatings).toEqual([
      { source: 'tmdb', value: 8.2 },
      { source: 'imdb', value: 7.4 },
    ])

    setImdbEnabled(false)
    await setRatings(['tmdb'])
  })
})

describe('/api/collections', () => {
  it('создаёт подборку, не даёт повторить имя и кладёт тайтл', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/collections',
      cookies: authed(),
      payload: { name: 'Новогоднее' },
    })

    expect(created.statusCode).toBe(201)

    const { id } = created.json()
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/collections',
      cookies: authed(),
      payload: { name: ' новогоднее ' },
    })

    expect(duplicate.statusCode).toBe(409)
    expect(duplicate.json().kind).toBe('duplicate')

    await app.inject({
      method: 'PUT',
      url: `/api/collections/${id}/titles/${MOVIE}`,
      cookies: authed(),
    })

    let mine = await app.inject({
      url: `/api/titles/${MOVIE}/mine?language=ru-RU`,
      cookies: authed(),
    })

    expect(mine.json().collections).toEqual([
      { id, name: 'Новогоднее', contains: true },
    ])

    const home = await app.inject({
      url: '/api/home?language=ru-RU',
      cookies: authed(),
    })

    expect(home.json().rows[0]).toMatchObject({
      id: 'collection',
      ref: id,
      name: 'Новогоднее',
      items: [{ id: MOVIE }],
    })

    // Скрытая от профиля подборка пропадает из его «Моё» и меню
    await app.inject({
      method: 'PATCH',
      url: `/api/collections/${id}`,
      cookies: authed(),
      payload: { hiddenFrom: [profileId] },
    })

    mine = await app.inject({
      url: `/api/titles/${MOVIE}/mine?language=ru-RU`,
      cookies: authed(),
    })

    expect(mine.json().collections).toEqual([])
    expect(
      (await items(`section=collection&collection=${id}`)).statusCode,
    ).toBe(404)

    const list = await app.inject({
      url: '/api/collections',
      cookies: authed(),
    })

    expect(list.json().items).toEqual([
      {
        id,
        name: 'Новогоднее',
        count: 1,
        showOnHome: true,
        hiddenFrom: [profileId],
      },
    ])

    const removed = await app.inject({
      method: 'DELETE',
      url: `/api/collections/${id}`,
      cookies: authed(),
    })

    expect(removed.statusCode).toBe(200)
  })
})

describe('get /api/home: личные ряды', () => {
  it('ставит «Новые серии» и «Позже» перед рядами TMDB', async () => {
    getDb()
      .insert(titleProgress)
      .values({
        profileId,
        titleId: SERIES,
        season: 2,
        episode: 3,
        position: 0,
        watchedAt: new Date(Date.now() - 5 * DAY_MS),
        updatedAt: new Date(Date.now() - 5 * DAY_MS),
      })
      .run()
    await patchMine(MOVIE, { watchlist: true })

    const res = await app.inject({
      url: '/api/home?language=ru-RU',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)

    const [episodes, watchlist] = res.json().rows

    expect(episodes).toMatchObject({
      id: 'newEpisodes',
      kind: 'episodes',
      items: [],
      episodes: [{ titleId: SERIES, season: 2, episode: 4, newCount: 1 }],
    })
    expect(watchlist).toMatchObject({
      id: 'watchlist',
      items: [{ id: MOVIE }],
      total: 1,
    })
  })

  it('без TMDB-деталей личный ряд пропадает, а не роняет главную', async () => {
    await patchMine(MOVIE, { watchlist: true })
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('/movie/603'))
        return new Response('{}', { status: 500 })

      return new Response(JSON.stringify(emptyList))
    })

    const res = await app.inject({
      url: '/api/home?language=en-GB',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json().rows).toEqual([])
  })
})

describe('удаление профиля с переносом', () => {
  it('объединяет списки и оставляет более свежую оценку', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/profiles',
      cookies: authed(),
      payload: { name: 'Дети', color: 'green' },
    })
    const kids = created.json().id
    const at = (ms: number) => new Date(Date.UTC(2026, 9, 1) + ms)

    getDb()
      .insert(profileTitles)
      .values([
        {
          profileId,
          titleId: MOVIE,
          rating: 5,
          ratedAt: at(0),
          favoriteAt: at(0),
          updatedAt: at(0),
        },
        {
          profileId: kids,
          titleId: MOVIE,
          rating: 8,
          ratedAt: at(1000),
          watchlistAt: at(0),
          updatedAt: at(0),
        },
        {
          profileId: kids,
          titleId: SERIES,
          droppedAt: at(0),
          updatedAt: at(0),
        },
      ])
      .run()

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/profiles/${kids}?moveTo=${profileId}`,
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)

    const rows = getDb().select().from(profileTitles).all()

    expect(rows).toHaveLength(2)
    expect(rows.find(row => row.titleId === MOVIE)).toMatchObject({
      profileId,
      rating: 8,
      ratedAt: at(1000),
      favoriteAt: at(0),
      watchlistAt: at(0),
    })
    expect(rows.find(row => row.titleId === SERIES)?.droppedAt).toEqual(
      at(0),
    )
  })
})

describe('get /api/profiles/:id/history', () => {
  it('отдаёт по тайтлу последнюю серию, свежие сверху', async () => {
    const at = (days: number) => new Date(Date.now() - days * DAY_MS)

    getDb()
      .insert(titleProgress)
      .values([
        {
          profileId,
          titleId: SERIES,
          season: 1,
          episode: 1,
          position: 0,
          watchedAt: at(5),
          updatedAt: at(5),
        },
        {
          profileId,
          titleId: SERIES,
          season: 1,
          episode: 2,
          position: 600,
          duration: 3000,
          updatedAt: at(1),
        },
        {
          profileId,
          titleId: MOVIE,
          season: 0,
          episode: 0,
          position: 0,
          watchedAt: at(3),
          updatedAt: at(3),
        },
        // Выбор раздачи без просмотра в историю не попадает
        {
          profileId,
          titleId: 'tmdb:movie:1',
          season: 0,
          episode: 0,
          position: 0,
          updatedAt: at(0),
        },
      ])
      .run()

    const res = await app.inject({
      url: `/api/profiles/${profileId}/history?language=ru-RU`,
      cookies: authed(),
    })

    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      total: 2,
      items: [
        { title: { id: SERIES }, season: 1, episode: 2, watched: false },
        { title: { id: MOVIE }, season: null, episode: null, watched: true },
      ],
    })
  })

  it('отвечает 404 на неизвестный профиль', async () => {
    const res = await app.inject({
      url: '/api/profiles/missing/history',
      cookies: authed(),
    })

    expect(res.statusCode).toBe(404)
  })
})
