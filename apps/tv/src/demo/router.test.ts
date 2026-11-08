import { titleNamed } from '@torsher/demo/titles'
import { handle } from '@torsher/demo/router'
import { join } from 'node:path'
import { unroutedMethods, usedApiMethods } from '@torsher/demo/coverage'
import { describe, expect, it } from 'vitest'
import './handlers/index.ts'

describe('showcase demo', () => {
  it('answers every request the showcase makes', async () => {
    const used = usedApiMethods(join(import.meta.dirname, '..'))

    expect(await unroutedMethods(used)).toEqual([])
  })
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
