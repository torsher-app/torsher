import { expect, it } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
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
        sourcePanelReturn: null,
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
it('keeps Home behind a replaced source-switch chain while the player owns overlay return', async () => {
  const history = createMemoryHistory('/')
  const router = createRouter({
    history,
    routes: [
      { path: '/', component: {} },
      { path: '/title/:id/play', component: {} },
      { path: '/play/:torrentId/:fileIndex', component: {} },
    ],
  })
  const title = 'tmdb:tv:100'
  await router.push('/')
  await router.push(`/play/original/3?title=${title}&season=1&episode=2`)
  const sourceReturn = sourceReturnState(
    router.currentRoute.value,
    123.5,
    true,
  )
  await router.replace({
    path: `/title/${title}/play`,
    query: { season: '1', episode: '2', candidate: 'new-source' },
    state: { sourceReturn },
  })
  await router.replace({
    path: '/play/new-source/0',
    query: { title, season: '1', episode: '2' },
    state: { sourceReturn: null, sourcePanelReturn: true },
  })

  expect(history.state.sourcePanelReturn).toBe(true)
  expect(router.currentRoute.value.path).toBe('/play/new-source/0')

  await router.replace({
    path: router.currentRoute.value.path,
    query: router.currentRoute.value.query,
    state: { sourcePanelReturn: null },
    force: true,
  })
  expect(history.state.sourcePanelReturn).toBeNull()
  router.back()
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(router.currentRoute.value.path).toBe('/')
  history.destroy()
})
