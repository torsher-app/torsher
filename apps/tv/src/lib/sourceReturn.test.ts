import { expect, it } from 'vitest'
import { sourceReturnRoute, sourceReturnState } from './sourceReturn.ts'

it('restores both torrent and library origins with exact position and paused intent', () => {
  for (const path of ['/play/torrent/3', '/play/library/file']) {
    const query = {
      title: 'tmdb:tv:100',
      season: '1',
      episode: '2',
      start: '0',
    }
    const state = sourceReturnState({ path, query }, 123.5, true)
    expect(sourceReturnRoute(state, query.title)).toEqual({
      path,
      query,
      state: {
        sourceReturn: null,
        resumePlayback: { position: 123.5, paused: true },
      },
    })
  }
})
it('rejects external routes, another title and invalid playback state', () => {
  const state = {
    path: '/play/torrent/0',
    query: { title: 'one' },
    position: 10,
    paused: false,
  }
  for (const value of [
    null,
    {},
    { ...state, path: '//example.com' },
    { ...state, position: Infinity },
    { ...state, position: -1 },
    { ...state, query: { title: 'two' } },
  ])
    expect(sourceReturnRoute(value, 'one')).toBeUndefined()
})
