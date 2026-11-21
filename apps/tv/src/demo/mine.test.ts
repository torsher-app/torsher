import type {
  MineBootstrap,
  MineCycle,
  MineDiaryCreated,
  MineDiaryPage,
  MineOverview,
  MinePersonalContinue,
  MineRecommendations,
  MineTitlePersonal,
} from '@torsher/api-client'
import { handle } from '@torsher/demo/router'
import { titleNamed } from '@torsher/demo/titles'
import { afterEach, describe, expect, it } from 'vitest'
import { mineRequestId } from '../lib/minePersonal.ts'
import { airedList, device } from './viewer.ts'
import { demoPlaybackSample } from './handlers/mine.ts'
import { continueRow } from './handlers/home.ts'

const alex = 'profile-alex'
const sam = 'profile-sam'
const movie = titleNamed('Velvet Atlas').id
const series = titleNamed('Glasswing').id

function route(path: string, method = 'GET', body?: object) {
  const url = new URL(`https://demo.test/api/mine/v1${path}`)
  if (method === 'GET' || method === 'DELETE')
    url.searchParams.set('expectedProfileId', device.currentId)
  return handle(
    url,
    {
      method,
      body:
        body
        && JSON.stringify({ expectedProfileId: device.currentId, ...body }),
    },
    'Unavailable',
  )
}

async function read<T>(
  path: string,
  method?: string,
  body?: object,
): Promise<T> {
  const response = await route(path, method, body)
  expect(response.status).toBe(200)
  return response.json()
}

afterEach(() => {
  device.currentId = alex
})

describe('personal Mine demo API', () => {
  it('keeps explicit manual rewatch flags when an earlier date is added or edited', async () => {
    device.currentId = sam
    const ids: string[] = []
    const log = async (day: string, rewatch = false) => {
      const result = await read<MineDiaryCreated>('/diary', 'POST', {
        requestId: mineRequestId(),
        target: { titleId: movie, season: 0, episode: 0 },
        date: { precision: 'day', day },
        rewatch,
      })
      ids.push(result.entry!.id)
      return result.entry!.id
    }
    try {
      await log('2024-06-01')
      const second = await log('2024-06-02')
      const marked = await log('2024-06-03', true)
      const old = await log('2020-01-01')
      await read(`/diary/${old}`, 'PATCH', {
        date: { precision: 'day', day: '2019-01-01' },
      })
      const page = await read<MineDiaryPage>('/diary')
      expect(page.entries.find(row => row.id === second)?.rewatch).toBe(
        false,
      )
      expect(page.entries.find(row => row.id === marked)?.rewatch).toBe(true)
      expect(
        (await read<MineDiaryPage>('/diary?rewatch=only')).entries
          .filter(row => ids.includes(row.id))
          .map(row => row.id),
      ).toEqual([marked])
    }
    finally {
      for (const id of ids) await route(`/diary/${id}`, 'DELETE')
    }
  })

  it('keeps an active exhausted cycle from revealing the ordinary Home cursor', async () => {
    device.currentId = alex
    const title = titleNamed('Glasswing')
    const aired = airedList(title)
    const cycle = await read<MineCycle>(`/title/${series}/cycles`, 'POST', {
      ...aired[0],
      requestId: mineRequestId(),
    })
    try {
      expect(continueRow().items.some(row => row.id === series)).toBe(true)
      demoPlaybackSample(
        alex,
        { titleId: series, ...aired[aired.length - 1]! },
        null,
        1000,
        1000,
        true,
        true,
        cycle.id,
      )
      const row = (await read<MinePersonalContinue>('/continue')).items.find(
        row => row.titleId === series,
      )
      expect(row?.cycle).toMatchObject({
        id: cycle.id,
        state: 'active',
        resume: null,
      })
      const home = continueRow(
        'all',
        new URLSearchParams({ personalContinue: '1', expectedProfileId: alex }),
      )
      expect(home.items.some(row => row.id === series)).toBe(false)
    }
    finally {
      await read(`/cycles/${cycle.id}`, 'PATCH', { action: 'end' })
    }
  })
  it('isolates start, existing marks and manual diary mutations while keeping seen independent', async () => {
    device.currentId = sam
    const before = await read<MineOverview>('/overview')
    expect(before.interests.source).toBe('ratingsAndFavorites')
    expect(before.previousMarks.movies).toBe(1)

    await read('/start-section', 'PUT', {
      start: { kind: 'section', section: 'diary' },
    })
    const input = {
      target: { titleId: movie, season: 0, episode: 0 },
      date: { precision: 'day', day: before.today },
      requestId: mineRequestId(),
      note: 'Original note',
    }
    const created = await read<MineDiaryCreated>('/diary', 'POST', input)
    const retry = await read<MineDiaryCreated>('/diary', 'POST', input)
    expect(retry.entry?.id).toBe(created.entry?.id)
    const id = created.entry!.id
    expect((await read<MineDiaryPage>('/diary')).total).toBe(1)
    expect((await read<MineOverview>('/overview')).totals.movies).toBe(1)
    expect((await read<MineTitlePersonal>(`/title/${movie}`)).seen.title).toBe(
      true,
    )
    await read(`/title/${movie}/seen`, 'PUT', {
      season: 0,
      episode: 0,
      watched: false,
    })
    expect((await read<MineDiaryPage>('/diary')).total).toBe(1)
    expect((await read<MineTitlePersonal>(`/title/${movie}`)).seen.title).toBe(
      false,
    )
    await read(`/title/${movie}/seen`, 'PUT', {
      season: 0,
      episode: 0,
      watched: true,
    })
    await read(`/diary/${id}`, 'PATCH', {
      date: { precision: 'unknown' },
      note: 'Edited note',
    })
    expect(
      (await read<MineDiaryPage>('/diary?date=unknown')).entries[0],
    ).toMatchObject({ id, calendarDay: null, note: 'Edited note' })
    expect((await read<MineOverview>('/overview')).interests.source).toBe(
      'ratingsAndFavorites',
    )

    device.currentId = alex
    expect((await read<MineBootstrap>('/bootstrap')).start).toEqual({
      kind: 'section',
      section: 'continue',
    })
    expect((await read<MineDiaryPage>('/diary?search=Edited+note')).total).toBe(
      0,
    )
    expect(
      (
        await handle(
          new URL(
            `https://demo.test/api/mine/v1/diary?expectedProfileId=${sam}`,
          ),
          {},
          'Unavailable',
        )
      ).status,
    ).toBe(409)

    device.currentId = sam
    expect((await read<MineBootstrap>('/bootstrap')).start).toEqual({
      kind: 'section',
      section: 'diary',
    })
    expect((await route(`/diary/${id}`, 'DELETE')).status).toBe(204)
    expect((await read<MineDiaryPage>('/diary')).total).toBe(0)
    expect((await read<MineTitlePersonal>(`/title/${movie}`)).seen.title).toBe(
      true,
    )
  })

  it('anchors a real bidirectional diary window while preserving totals', async () => {
    const first = await read<MineDiaryPage>('/diary')
    const month = first.months.filter(row => row.month).at(-3)!.month
    const page = await read<MineDiaryPage>(
      `/diary?anchorMonth=${month}&limit=2`,
    )
    expect(page).toMatchObject({
      total: first.total,
      distinctTitles: first.distinctTitles,
    })
    expect(page.entries[0]?.calendarDay?.slice(0, 7)).toBe(month)
    const newer = await read<MineDiaryPage>(
      `/diary?direction=newer&limit=2&cursor=${page.newerCursor}`,
    )
    const older = await read<MineDiaryPage>(
      `/diary?direction=older&limit=2&cursor=${page.olderCursor}`,
    )
    expect(
      newer.entries[0]!.calendarDay! >= page.entries[0]!.calendarDay!,
    ).toBe(true)
    expect(
      older.entries[0]!.calendarDay! <= page.entries[1]!.calendarDay!,
    ).toBe(true)
    expect(
      new Set(
        [...newer.entries, ...page.entries, ...older.entries].map(
          row => row.id,
        ),
      ).size,
    ).toBe(6)
  })

  it('updates recommendation exclusions and resumes normal continuation independently of cycles', async () => {
    const rec = await read<MineRecommendations>(
      '/recommendations?refresh=poll',
    )
    const suggestion = rec.items[0]!.card.id
    await read(`/title/${suggestion}`, 'PATCH', { notInterested: true })
    expect(
      (
        await read<MineRecommendations>('/recommendations?refresh=poll')
      ).items.some(row => row.card.id === suggestion),
    ).toBe(false)
    await read(`/title/${suggestion}`, 'PATCH', { notInterested: false })

    const ordinary = (await read<MinePersonalContinue>('/continue')).items.find(
      row => row.titleId === series,
    )!.normalResume
    const input = { season: 2, episode: 1, requestId: mineRequestId() }
    const cycle = await read<MineCycle>(
      `/title/${series}/cycles`,
      'POST',
      input,
    )
    expect(cycle.resume).toMatchObject({ season: 2, episode: 1, position: 0 })
    await read(`/title/${series}`, 'PATCH', { continuation: 'hidden' })
    expect(
      (await read<MinePersonalContinue>('/continue')).items.some(
        row => row.titleId === series,
      ),
    ).toBe(false)
    expect(
      (await read<MinePersonalContinue>('/continue?state=hidden')).items.find(
        row => row.titleId === series,
      )?.cycle?.id,
    ).toBe(cycle.id)
    await read(`/title/${series}`, 'PATCH', { continuation: 'normal' })
    expect(
      await read<MineCycle>(`/cycles/${cycle.id}`, 'PATCH', {
        action: 'pause',
      }),
    ).toMatchObject({ state: 'paused', resume: null })
    expect(
      (await read<MinePersonalContinue>('/continue')).items.find(
        row => row.titleId === series,
      )?.normalResume,
    ).toEqual(ordinary)
    expect(
      await read<MineCycle>(`/cycles/${cycle.id}`, 'PATCH', {
        action: 'resume',
      }),
    ).toMatchObject({ state: 'active', resume: { season: 2, episode: 1 } })
    await read(`/cycles/${cycle.id}`, 'PATCH', { action: 'end' })
    expect(
      (await read<MinePersonalContinue>('/continue')).items.find(
        row => row.titleId === series,
      )?.normalResume,
    ).toEqual(ordinary)
  })
})
