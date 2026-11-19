import { titleNamed } from '@torsher/demo/titles'
import { handle } from '@torsher/demo/router'
import { join } from 'node:path'
import { unroutedMethods, usedApiMethods } from '@torsher/demo/coverage'
import { describe, expect, it } from 'vitest'
import { episodeFile, knownTorrent } from './library.ts'
import { device, mineEntry, progressAt, progressOf } from './viewer.ts'
import './handlers/index.ts'

describe('showcase demo', () => {
  it('answers every request the showcase makes', async () => {
    const used = usedApiMethods(join(import.meta.dirname, '..'))

    expect(await unroutedMethods(used)).toEqual([])
  })
})

it('validates demo playback generations, binding and rewind order without changing the normal cursor in a cycle', async () => {
  const request = (path: string, method = 'GET', body?: object) =>
    handle(
      new URL(`http://demo/api${path}`),
      { method, body: body && JSON.stringify(body) },
      'Unavailable',
    )
  const catalog = titleNamed('Kites over Mareth')!
  const title = { id: catalog.id, season: 1, episode: 1 }
  knownTorrent(catalog, title.season)
  const source = episodeFile(title.id, title.season, title.episode)!
  const profileId = device.currentId
  const clientId = 'demo-viewing-client'
  const playerId = 'demo-viewing-player'
  const start = {
    requestId: 'demo-viewing-start',
    intent: 'join',
    clientId,
    playerId,
  }
  const first = await (
    await request('/playback', 'POST', {
      ...source,
      title,
      profileId,
      viewing: start,
    })
  ).json()
  expect(first.viewing).toMatchObject({
    generation: 1,
    current: true,
    attemptId: expect.stringMatching(
      /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i,
    ),
  })
  const save = async (
    sessionId: string,
    sequence: number,
    position: number,
    more = {},
    line = 0,
  ) =>
    (
      await request('/watch-state', 'PUT', {
        ...source,
        title,
        sessionId,
        position,
        duration: 1000,
        event: { clientId, sequence },
        viewing: { playerId, line, kind: 'playback' },
        ...more,
      })
    ).json()
  expect(await save(first.sessionId, 1, 350)).toMatchObject({ accepted: true })
  expect(await save(first.sessionId, 3, 600, {}, 1)).toMatchObject({
    accepted: true,
  })
  expect(await save(first.sessionId, 2, 380)).toMatchObject({
    accepted: false,
    rejection: 'stale',
  })
  expect(
    await save(first.sessionId, 4, 990, { fileIndex: source.fileIndex + 1 }, 1),
  ).toMatchObject({ accepted: false, rejection: 'viewingConflict' })

  const second = await (
    await request('/playback', 'POST', {
      ...source,
      title,
      profileId,
      viewing: {
        ...start,
        requestId: 'demo-viewing-restart',
        intent: 'restart',
        expectedGeneration: 1,
      },
    })
  ).json()
  expect(second.viewing).toMatchObject({ generation: 2, current: true })
  expect(await save(first.sessionId, 400, 995)).toMatchObject({
    accepted: false,
    rejection: 'viewingConflict',
  })
  const retry = await (
    await request('/playback', 'POST', {
      ...source,
      title,
      profileId,
      viewing: start,
    })
  ).json()
  expect(retry.viewing).toMatchObject({
    ...first.viewing,
    current: false,
    state: 'abandoned',
  })
  expect(await save(second.sessionId, 5, 390)).toMatchObject({
    accepted: true,
  })

  const before = progressAt(title.id, title.season, title.episode)
  const cycleId = '095955ce-a8e0-45fa-98a0-b072b799ab19'
  const cycle = await (
    await request('/playback', 'POST', {
      ...source,
      title,
      profileId,
      viewing: { ...start, requestId: 'demo-viewing-cycle', cycleId },
    })
  ).json()
  expect(await save(cycle.sessionId, 6, 920)).toMatchObject({ accepted: true })
  expect(progressAt(title.id, title.season, title.episode)).toEqual(before)
  const query = `titleId=${title.id}&season=${title.season}&episode=${title.episode}&cycleId=${cycleId}`
  expect(
    await (await request(`/playback/viewing-attempt?${query}`)).json(),
  ).toMatchObject({ source })
  try {
    device.currentId = 'profile-sam'
    expect(await save(cycle.sessionId, 7, 930)).toMatchObject({
      accepted: false,
      rejection: 'viewingConflict',
    })
    expect(
      await (await request(`/playback/viewing-attempt?${query}`)).json(),
    ).toEqual({ attempt: null })
  }
  finally {
    device.currentId = profileId
  }
})

it('retains cached studio choices after an explicit demo search', async () => {
  const read = async (suffix = '') =>
    (
      await handle(
        new URL(
          `http://demo/api/titles/demo-title/follow/voices?season=2${suffix}`,
        ),
        { method: 'GET' },
        'Unavailable',
      )
    ).json()
  expect(await read()).toMatchObject({
    cache: 'miss',
    updatedAt: null,
    items: [],
  })
  const refreshed = await read('&refresh=1')
  expect(refreshed.cache).toBe('hit')
  expect(refreshed.items).toHaveLength(2)
  expect(await read()).toEqual(refreshed)
})

it('reports unavailable explicit ready selection in demo without a fallback', async () => {
  const response = await handle(
    new URL('http://demo/api/titles/demo-title/follow/open'),
    {
      method: 'POST',
      body: JSON.stringify({ season: 2, episode: 1, intent: 'follow-ready' }),
    },
    'Unavailable',
  )
  expect(response.status).toBe(409)
  expect(await response.json()).toMatchObject({
    kind: 'follow_pick_unavailable',
  })
})

it('validates only demo studios and does not turn saved into found after refresh', async () => {
  const request = (path: string, method = 'GET', body?: object) =>
    handle(
      new URL(`http://demo/api${path}`),
      { method, ...(body ? { body: JSON.stringify(body) } : {}) },
      'Unavailable',
    )
  const title = titleNamed('Kites over Mareth')!
  const follow = `/titles/${title.id}/follow`
  const voices = `${follow}/voices?season=2`
  const response = await request(follow, 'PUT', {
    voicePolicy: { mode: 'only', studio: 'Demo Gamma' },
  })
  expect(response.status).toBe(200)
  expect((await response.json()).follow.voicePolicy).toEqual({
    mode: 'only',
    studio: 'Demo Studio C',
  })
  const before = await (await request(voices)).json()
  expect(before.items).toContainEqual(
    expect.objectContaining({
      studio: 'Demo Studio C',
      found: false,
      saved: true,
      count: 0,
    }),
  )
  const refreshed = await (await request(`${voices}&refresh=1`)).json()
  expect(
    refreshed.items
      .filter((item: { found: boolean }) => item.found)
      .map((item: { studio: string }) => item.studio),
  ).toEqual(['Demo Studio A', 'Demo Studio B'])
  expect(refreshed.items).toContainEqual(
    expect.objectContaining({
      studio: 'Demo Studio C',
      found: false,
      saved: true,
      count: 0,
    }),
  )
  expect(
    (
      await request(follow, 'PUT', {
        voicePolicy: { mode: 'only', studio: 'LostFilm' },
      })
    ).status,
  ).toBe(400)
  expect((await (await request(follow)).json()).follow.voicePolicy).toEqual({
    mode: 'only',
    studio: 'Demo Studio C',
  })
})

it('shows a rated series without progress in My ratings and removes a cleared rating', async () => {
  const title = titleNamed('The Vantmoor Files')!
  const entry = mineEntry(title.id)
  const before = { ...entry }
  const read = async (path: string) =>
    (
      await handle(
        new URL(`http://demo/api${path}`),
        { method: 'GET' },
        'Unavailable',
      )
    ).json()
  try {
    expect(progressOf(title.id)).toEqual([])
    entry.rating = 9
    entry.ratedAt = Date.now()
    const items = await read(
      '/mine/items?section=ratings&sort=added&kind=series',
    )
    expect(items.items[0]).toMatchObject({ id: title.id, ownRating: 9 })
    const sections = await read('/mine')
    expect(sections.sections).toContainEqual({
      id: 'ratings',
      count: (await read('/mine/items?section=ratings')).total,
    })
    entry.rating = undefined
    entry.ratedAt = undefined
    expect(
      (await read('/mine/items?section=ratings&kind=series')).items.some(
        (item: { id: string }) => item.id === title.id,
      ),
    ).toBe(false)
  }
  finally {
    entry.rating = before.rating
    entry.ratedAt = before.ratedAt
  }
})
