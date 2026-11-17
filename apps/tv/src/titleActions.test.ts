import type { TitleMine } from '@torsher/api-client'
import { beforeEach, expect, it } from 'vitest'
import { computed } from 'vue'
import {
  captureTitleViewer,
  knownTitleMine,
  noteTitleFollow,
  noteTitleMine,
  noteTitleProgress,
  openTitleActions,
  rememberTitleMine,
  setTitleViewer,
  titleActions,
  titleMineProgressVersion,
  titleMineRevision,
  titleProgressVersion,
} from './titleActions.ts'

const mine = {
  rating: 7,
  watchlist: true,
  collections: [],
} as unknown as TitleMine
beforeEach(() => {
  setTitleViewer(undefined)
  setTitleViewer('A')
})

it('isolates A/B/A and rejects late writes even after returning to the same ID', () => {
  const a = captureTitleViewer()
  noteTitleMine('title', mine, a)
  noteTitleFollow('title', true, a)
  openTitleActions({ id: 'title', title: 'Title', kind: 'movie' })
  setTitleViewer('B')
  expect(knownTitleMine('title')).toBeUndefined()
  expect(titleActions.follows.size).toBe(0)
  expect(titleActions.target).toBeUndefined()
  setTitleViewer('A')
  const version = titleActions.version
  rememberTitleMine('title', mine, a)
  noteTitleMine('title', mine, a)
  noteTitleProgress(a, 'title')
  noteTitleFollow('title', true, a)
  expect(knownTitleMine('title')).toBeUndefined()
  expect(titleActions.version).toBe(version)
})

it('retains caches and the generation when the same viewer is revalidated', () => {
  const viewer = captureTitleViewer()
  rememberTitleMine('title', mine, viewer)
  setTitleViewer('A')
  expect(captureTitleViewer()).toBe(viewer)
  expect(knownTitleMine('title')).toEqual(mine)
  setTitleViewer(undefined)
  expect(knownTitleMine('title')).toBeUndefined()
})

it('does not invalidate on reads, optimistic changes or rollback; confirmed writes invalidate once', () => {
  const viewer = captureTitleViewer()
  const version = titleActions.version
  rememberTitleMine('title', mine, viewer)
  rememberTitleMine('title', { ...mine, rating: 9 }, viewer)
  rememberTitleMine('title', mine, viewer)
  expect(titleActions.version).toBe(version)
  noteTitleMine('title', mine, viewer)
  expect(titleActions.version).toBe(version + 1)
})

it('rejects a same-viewer mine read begun before a mutation', () => {
  const viewer = captureTitleViewer()
  const revision = titleMineRevision('title')
  noteTitleMine('title', { ...mine, watchlist: false }, viewer)
  rememberTitleMine('title', mine, viewer, revision)
  expect(knownTitleMine('title')?.watchlist).toBe(false)
})

it('shares the accepted mine response when page and menu reads started at the same revision', () => {
  const viewer = captureTitleViewer()
  const revision = titleMineRevision('title')
  const menu = computed(() => knownTitleMine('title'))
  rememberTitleMine('title', mine, viewer, revision)
  rememberTitleMine('title', { ...mine, rating: 9 }, viewer, revision)
  expect(menu.value).toEqual(mine)
  expect(menu.value?.watchlist).toBe(true)
})

it('invalidates only the relevant title, with a wildcard for server-matched library files', () => {
  const viewer = captureTitleViewer()
  const titleBefore = titleProgressVersion('title')
  const otherBefore = titleProgressVersion('other')
  const mineBefore = titleMineProgressVersion('title')
  noteTitleProgress(viewer, 'title', false)
  expect(titleProgressVersion('title')).not.toBe(titleBefore)
  expect(titleProgressVersion('other')).toBe(otherBefore)
  expect(titleMineProgressVersion('title')).toBe(mineBefore)
  noteTitleProgress(viewer, undefined)
  expect(titleProgressVersion('other')).not.toBe(otherBefore)
  expect(titleMineProgressVersion('title')).not.toBe(mineBefore)
})
