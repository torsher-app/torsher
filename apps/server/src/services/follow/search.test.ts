import type { Follow } from '../../db/schema.ts'
import type { DueSearch } from './search.ts'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { getDb, migrateDb } from '../../db/index.ts'
import { indexers } from '../../db/schema.ts'
import {
  availableForBackground,
  backoffUntil,
  recordBackgroundOutcome,
} from '../indexers/backoff.ts'
import { listSearchableIndexers } from '../indexers/index.ts'
import { asViewerSearch, searchReleases } from '../sources/search.ts'
import { retryAtOf } from '../torznab/client.ts'
import {
  canStartSearch,
  compareDue,
  followSearchStarted,
  isQuietAfterStart,
  requestedSearch,
  requestFollowSearch,
  resetFollowSearch,
  searchPlan,
} from './search.ts'

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
// Полдень, чтобы смещения в часах не уходили за полночь
const NOW = new Date('2026-10-20T12:00:00')

function at(offsetMs: number) {
  return new Date(NOW.getTime() + offsetMs)
}

function dayStart(offsetDays: number) {
  const date = new Date(NOW)

  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offsetDays)
  return date
}

function ymd(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

function follow(overrides: Partial<Follow> = {}): Follow {
  return {
    id: 'f',
    titleId: 'tmdb:tv:1',
    kind: 'series',
    state: 'active',
    startSeason: 1,
    startEpisode: 1,
    voiceStudio: null,
    voiceStrict: false,
    requireRussian: true,
    waitHours: 24,
    qualityPreset: 'best',
    mode: 'download',
    audio: null,
    createdByProfileId: null,
    nextSearchAt: null,
    lastSearchAt: null,
    searchStep: 0,
    scheduleRefreshedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

beforeAll(async () => {
  await migrateDb()
})

describe('лестница целевого поиска', () => {
  it('при включении — сразу, если есть нужные серии', () => {
    expect(searchPlan({ kind: 'series', wanted: [{}], now: NOW }).due).toBe(
      true,
    )
    expect(searchPlan({ kind: 'series', wanted: [], now: NOW }).due).toBe(
      false,
    )
  })

  it('серия вышла сегодня: точки в 0, 3, 6, 12 ч и раз в сутки', () => {
    const airDate = ymd(NOW)
    const today = dayStart(0)
    const plan = (lastSearchAt: Date, now: Date) =>
      searchPlan({ kind: 'series', wanted: [{ airDate }], lastSearchAt, now })

    // Искали в 6 ч утра: следующая точка — 12 ч
    const morning = new Date(today.getTime() + 6 * HOUR_MS)

    expect(plan(morning, new Date(today.getTime() + 11 * HOUR_MS))).toEqual({
      due: false,
      next: new Date(today.getTime() + 12 * HOUR_MS),
    })
    expect(plan(morning, new Date(today.getTime() + 12 * HOUR_MS)).due).toBe(
      true,
    )

    // После 12 ч — через сутки от начала дня выхода
    const noon = new Date(today.getTime() + 12 * HOUR_MS)

    expect(plan(noon, new Date(today.getTime() + 13 * HOUR_MS)).next).toEqual(
      new Date(today.getTime() + DAY_MS),
    )
  })

  it('после 14 дней — раз в неделю, после 60 — не ищем', () => {
    const plan = (days: number, lastSearchAt: Date) =>
      searchPlan({
        kind: 'series',
        wanted: [{ airDate: ymd(dayStart(-days)) }],
        lastSearchAt,
        now: NOW,
      })

    // Вышла 16 дней назад, искали на 14-й день: следующая точка — 21-й день,
    // а до неё слежение смотрится раз в сутки
    expect(plan(16, dayStart(-2))).toEqual({ due: false, next: at(DAY_MS) })
    expect(plan(20, dayStart(-6)).due).toBe(false)
    expect(plan(21, dayStart(-7)).due).toBe(true)
    // 61 день: ступеней больше нет, смотрим раз в сутки только из-за расписания
    expect(plan(61, dayStart(-5))).toEqual({ due: false, next: at(DAY_MS) })
  })

  it('без нужных серий — в день выхода анонсированной', () => {
    expect(
      searchPlan({
        kind: 'series',
        wanted: [],
        upcomingAirDate: ymd(dayStart(3)),
        lastSearchAt: at(-HOUR_MS),
        now: NOW,
      }),
    ).toEqual({ due: false, next: at(DAY_MS) })
    expect(
      searchPlan({
        kind: 'series',
        wanted: [],
        upcomingAirDate: ymd(dayStart(1)),
        now: NOW,
      }).next,
    ).toEqual(dayStart(1))
  })

  it('старая серия без даты ищется только при включении', () => {
    expect(
      searchPlan({
        kind: 'series',
        wanted: [{}],
        lastSearchAt: at(-HOUR_MS),
        now: NOW,
      }).due,
    ).toBe(false)
  })

  it('фильм до цифрового релиза — раз в неделю и в день релиза', () => {
    const plan = (lastSearchAt: Date, availableFrom?: Date) =>
      searchPlan({
        kind: 'movie',
        wanted: [{}],
        availableFrom,
        lastSearchAt,
        now: NOW,
      })

    expect(plan(at(-6 * DAY_MS))).toEqual({ due: false, next: at(DAY_MS) })
    expect(plan(at(-7 * DAY_MS)).due).toBe(true)
    expect(plan(at(-DAY_MS), at(2 * DAY_MS))).toEqual({
      due: false,
      next: at(2 * DAY_MS),
    })
    // Релиз наступил после прошлого поиска — ищем сразу
    expect(plan(at(-DAY_MS), at(-HOUR_MS)).due).toBe(true)
  })

  it('фильм с цифрового релиза — раз в сутки 14 дней, потом раз в неделю', () => {
    const plan = (lastSearchAt: Date, released: number) =>
      searchPlan({
        kind: 'movie',
        wanted: [{}],
        availableFrom: at(-released * DAY_MS),
        lastSearchAt,
        now: NOW,
      })

    expect(plan(at(-20 * HOUR_MS), 5)).toEqual({
      due: false,
      next: at(4 * HOUR_MS),
    })
    expect(plan(at(-DAY_MS), 5).due).toBe(true)
    expect(plan(at(-3 * DAY_MS), 20).due).toBe(false)
    expect(plan(at(-7 * DAY_MS), 20).due).toBe(true)
  })

  it('фильм в библиотеке, который ещё стоит заменить, ищется по той же лестнице', () => {
    expect(
      searchPlan({
        kind: 'movie',
        wanted: [],
        upgrading: true,
        availableFrom: at(-3 * DAY_MS),
        lastSearchAt: at(-DAY_MS),
        now: NOW,
      }).due,
    ).toBe(true)
    expect(
      searchPlan({
        kind: 'movie',
        wanted: [],
        lastSearchAt: at(-30 * DAY_MS),
        now: NOW,
      }).due,
    ).toBe(false)
  })

  it('апгрейд серий в библиотеке — поиск раз в сутки', () => {
    const plan = (lastSearchAt: Date) =>
      searchPlan({
        kind: 'series',
        wanted: [],
        upgrading: true,
        lastSearchAt,
        now: NOW,
      })

    expect(plan(at(-20 * HOUR_MS))).toEqual({
      due: false,
      next: at(4 * HOUR_MS),
    })
    expect(plan(at(-DAY_MS)).due).toBe(true)
  })
})

describe('очередь и бюджет целевых поисков', () => {
  beforeEach(() => resetFollowSearch(0))

  it('порядок: «Искать сейчас» → ещё не искали → вышла сегодня → по сроку', () => {
    const items: DueSearch[] = [
      {
        follow: follow({
          id: 'late',
          lastSearchAt: at(-DAY_MS),
          nextSearchAt: at(-HOUR_MS),
        }),
        airedToday: false,
      },
      {
        follow: follow({
          id: 'early',
          lastSearchAt: at(-DAY_MS),
          nextSearchAt: at(-2 * HOUR_MS),
        }),
        airedToday: false,
      },
      {
        follow: follow({ id: 'today', lastSearchAt: at(-DAY_MS) }),
        airedToday: true,
      },
      { follow: follow({ id: 'new' }), airedToday: false },
      {
        follow: follow({ id: 'retry', lastSearchAt: at(-DAY_MS) }),
        request: 'retry',
        airedToday: false,
      },
      {
        follow: follow({ id: 'manual', lastSearchAt: at(-DAY_MS) }),
        request: 'manual',
        airedToday: false,
      },
    ]

    expect(items.sort(compareDue).map(item => item.follow.id)).toEqual([
      'manual',
      'retry',
      'new',
      'today',
      'early',
      'late',
    ])
  })

  it('не чаще раза в минуту и не больше бюджета в час; «Искать сейчас» — без бюджета', () => {
    let now = NOW.getTime()
    const starts: number[] = []

    for (let tick = 0; tick < 240; tick++, now += 30_000) {
      if (canStartSearch(undefined, new Date(now), 20)) {
        followSearchStarted(new Date(now))
        starts.push(now)
      }
    }

    // За два часа — по 20 в час, между стартами не меньше минуты
    expect(starts).toHaveLength(40)
    expect(
      Math.min(...starts.slice(1).map((time, i) => time - starts[i]!)),
    ).toBeGreaterThanOrEqual(MINUTE_MS)
    expect(
      starts.filter(time => time < NOW.getTime() + HOUR_MS),
    ).toHaveLength(20)
    expect(canStartSearch('manual', new Date(now), 20)).toBe(true)
  })

  it('пять минут тишины после старта и пауза на время поиска зрителя', async () => {
    resetFollowSearch(NOW.getTime())

    expect(isQuietAfterStart(at(4 * MINUTE_MS))).toBe(true)
    expect(canStartSearch(undefined, at(4 * MINUTE_MS))).toBe(false)
    expect(canStartSearch('manual', at(4 * MINUTE_MS))).toBe(true)
    expect(canStartSearch(undefined, at(5 * MINUTE_MS))).toBe(true)

    let during = true

    await asViewerSearch(async () => {
      during = canStartSearch(undefined, at(10 * MINUTE_MS))
    })

    expect(during).toBe(false)
    expect(canStartSearch(undefined, at(10 * MINUTE_MS))).toBe(true)
  })

  it('повтор после зависшей не перебивает «Искать сейчас»', () => {
    requestFollowSearch('f')
    requestFollowSearch('f', 'retry')

    expect(requestedSearch('f')).toBe('manual')
  })
})

describe('бэкофф индексатора', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    getDb().delete(indexers).run()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  function addIndexer(name: string, host: string) {
    getDb()
      .insert(indexers)
      .values({
        name,
        url: `https://${host}/torznab`,
        caps: {
          search: { available: true, params: ['q'] },
          tvSearch: { available: true, params: ['q'] },
          movieSearch: { available: false, params: [] },
          categories: [],
        },
      })
      .run()
  }

  it('`Retry-After` — секунды или дата', () => {
    const now = NOW.getTime()
    const res = (value: string) =>
      new Response(null, { status: 429, headers: { 'Retry-After': value } })

    expect(retryAtOf(res('120'), now)).toEqual(at(2 * MINUTE_MS))
    expect(retryAtOf(res(at(HOUR_MS).toUTCString()), now)).toEqual(at(HOUR_MS))
    expect(retryAtOf(res('garbage'), now)).toBeUndefined()
    expect(retryAtOf(new Response(null, { status: 429 }), now)).toBeUndefined()
  })

  it('лестница Sonarr и потолок `Retry-After`', () => {
    expect(backoffUntil(1, NOW)).toEqual(at(MINUTE_MS))
    expect(backoffUntil(5, NOW)).toEqual(at(HOUR_MS))
    expect(backoffUntil(50, NOW)).toEqual(at(DAY_MS))
    expect(backoffUntil(1, NOW, at(3 * DAY_MS))).toEqual(at(DAY_MS))
  })

  it('429 с `Retry-After`: фон пропускает индексатор до срока, успех сбрасывает', async () => {
    addIndexer('Limited', 'limited.indexer.example')
    addIndexer('Healthy', 'healthy.indexer.example')
    fetchMock.mockImplementation(async (input) => {
      if (String(input).includes('limited.indexer.example')) {
        return new Response('<error code="900" description="Query limit"/>', {
          status: 429,
          headers: { 'Retry-After': '3600' },
        })
      }

      return new Response('<rss><channel></channel></rss>')
    })

    const all = listSearchableIndexers()
    const outcome = await searchReleases(
      {
        identity: { kind: 'series', tmdbId: 1, year: 2024 } as never,
        aliases: [
          {
            titleId: 'tmdb:tv:1',
            kind: 'official',
            lang: 'ru',
            value: 'Тихая гавань',
            normalized: 'тихаягавань',
            updatedAt: NOW,
          },
        ] as never,
      },
      all,
    )
    const limited = outcome.failed.find(item => item.name === 'Limited')

    expect(limited).toMatchObject({ kind: 'remote' })
    expect(limited!.retryAt!.getTime()).toBeGreaterThan(
      Date.now() + 59 * MINUTE_MS,
    )

    // `Retry-After` считается от настоящих часов
    const now = new Date()

    recordBackgroundOutcome(all, outcome.failed, now)

    const skipped = availableForBackground(all, now)

    expect(skipped.available.map(item => item.name)).toEqual(['Healthy'])
    expect(skipped.nextAt).toEqual(limited!.retryAt)
    expect(
      availableForBackground(all, new Date(now.getTime() + 2 * DAY_MS))
        .available,
    ).toHaveLength(2)

    // Ошибка без срока — ступень лестницы, успех — сброс
    const healthy = all.find(item => item.name === 'Healthy')!

    recordBackgroundOutcome(
      [healthy],
      [{ id: healthy.id, name: 'Healthy', kind: 'timeout' }],
      NOW,
    )
    expect(availableForBackground([healthy], at(30_000)).available).toEqual([])
    expect(
      availableForBackground([healthy], at(MINUTE_MS)).available,
    ).toHaveLength(1)

    recordBackgroundOutcome([healthy], [], NOW)
    expect(
      getDb()
        .select()
        .from(indexers)
        .all()
        .find(row => row.name === 'Healthy'),
    ).toMatchObject({
      failureCount: 0,
      backoffUntil: null,
    })
  })
})
