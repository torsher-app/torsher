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
