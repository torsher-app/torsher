import { describe, expect, it } from 'vitest'
import type { Continuation } from '@torsher/api-client'
import {
  continuationBaseline,
  lowerContinuationQuality,
} from './continuationQuality.ts'
import {
  automaticEpisodeRoute,
  automaticFromQuery,
  automaticPlayback,
  libraryRoute,
  playerRoute,
  resolveRoute,
  resumeRoute,
} from './continue.ts'

const baseline: NonNullable<Continuation['baseline']> = {
  file: { kind: 'torrent', torrentId: 'pack', fileIndex: 3 },
  video: { width: 1920, height: 800, basis: 'probe' },
}
const candidate = { kind: 'torrent' as const, torrentId: 'pack', fileIndex: 4 }

describe('exact-file continuation quality', () => {
  it('compares cropped source frames, including two files in one pack', () => {
    expect(
      lowerContinuationQuality(
        baseline,
        { width: 720, height: 304 },
        candidate,
      ),
    ).toBe('SD')
    expect(
      lowerContinuationQuality(
        baseline,
        { width: 1280, height: 536 },
        candidate,
      ),
    ).toBe('720p')
    expect(
      lowerContinuationQuality(
        baseline,
        { width: 1920, height: 1080 },
        candidate,
      ),
    ).toBeNull()
  })
  it('does not warn for the same file or unconfirmed dimensions', () => {
    expect(
      lowerContinuationQuality(
        baseline,
        { width: 720, height: 304 },
        baseline.file,
      ),
    ).toBeNull()
    for (const video of [
      null,
      undefined,
      { width: null, height: null },
      { width: 0, height: 0 },
    ])
      expect(lowerContinuationQuality(baseline, video, candidate)).toBeNull()
    expect(
      lowerContinuationQuality(
        { ...baseline, video: null },
        { width: 720, height: 304 },
        candidate,
      ),
    ).toBeNull()
    expect(
      lowerContinuationQuality(
        undefined,
        { width: 720, height: 304 },
        candidate,
      ),
    ).toBeNull()
  })
  it('handles pure library baselines without torrent identifiers', () => {
    const library = {
      ...baseline,
      file: { kind: 'library' as const, mediaFileId: 'hd' },
    }
    expect(
      lowerContinuationQuality(
        library,
        { width: 720, height: 304 },
        { kind: 'library', mediaFileId: 'sd' },
      ),
    ).toBe('SD')
  })
  it('carries automatic intent through all routes while leaving explicit and resumed files alone', () => {
    const title = { id: 'title', season: 2, episode: 5 }
    const file = { torrentId: 'pack', fileIndex: 4 }
    expect(
      playerRoute(file, title, undefined, automaticPlayback).query?.automatic,
    ).toBe('1')
    expect(
      libraryRoute('local', title, automaticPlayback).query?.automatic,
    ).toBe('1')
    expect(
      resolveRoute('title', 2, 5, undefined, automaticPlayback).query?.automatic,
    ).toBe('1')
    expect(playerRoute(file, title).query?.automatic).toBeUndefined()
    const item = {
      season: 2,
      episode: 5,
      next: false,
      position: 4,
      duration: 1000,
      file,
    }
    expect(resumeRoute('title', item).query?.automatic).toBeUndefined()
    expect(
      resumeRoute('title', { ...item, next: true, position: 0 }).query?.automatic,
    ).toBe('1')
  })
})

it('carries the exact current source through all automatic routes after cache eviction', () => {
  const continuation = {
    target: { season: 1, episode: 5 },
    preferredTorrent: null,
    baseline: { ...baseline, video: null },
  }
  const automatic = { kind: 'continuation' as const, current: baseline }
  for (const route of [
    playerRoute(
      { torrentId: 'pack', fileIndex: 4 },
      { id: 'title' },
      undefined,
      automatic,
    ),
    libraryRoute('local', { id: 'title' }, automatic),
    resolveRoute('title', 1, 5, undefined, automatic),
  ]) {
    const parsed = automaticFromQuery(
      route.query?.automatic,
      route.query?.reference,
    )
    expect(parsed).toEqual(automatic)
    const effective = continuationBaseline(continuation, parsed?.current)
    expect(
      lowerContinuationQuality(
        effective,
        { width: 720, height: 304 },
        candidate,
      ),
    ).toBe('SD')
  }
  const unrelated = { ...baseline, file: { ...candidate } }
  expect(continuationBaseline(continuation, unrelated)?.video).toBeNull()
  expect(continuationBaseline(undefined, baseline)).toBeUndefined()
  expect(
    continuationBaseline({ ...continuation, baseline: null }, baseline),
  ).toBeNull()
  expect(automaticFromQuery('1', '{invalid')).toEqual(automaticPlayback)
  expect(
    automaticFromQuery(
      '1',
      JSON.stringify({
        ...baseline,
        video: { width: -1, height: 1080, basis: 'probe' },
      }),
    ),
  ).toEqual(automaticPlayback)
  expect(
    automaticFromQuery(undefined, JSON.stringify(baseline)),
  ).toBeUndefined()
})

it('does not revive stale library dimensions from an earlier session under the same ID', () => {
  const file = { kind: 'library' as const, mediaFileId: 'same-id' }
  const current = { file, video: baseline.video }
  const continuation = {
    target: { season: 1, episode: 5 },
    preferredTorrent: null,
    baseline: { file, video: null },
  }
  expect(continuationBaseline(continuation, current)?.video).toBeNull()
})

it('player episode switching preserves consent context when it falls back to the resolver', () => {
  const automatic = { kind: 'continuation' as const, current: baseline }
  const fallback = automaticEpisodeRoute(
    { id: 'show', season: 2, episode: 5 },
    null,
    'old-source',
    automatic,
  )
  expect(fallback.path).toBe('/title/show/play')
  expect(fallback.query).toMatchObject({
    season: '2',
    episode: '5',
    torrent: 'old-source',
    automatic: '1',
  })
  expect(
    automaticFromQuery(fallback.query?.automatic, fallback.query?.reference),
  ).toEqual(automatic)
})

it('keeps the current pack and heard studio when returning to a watched episode', () => {
  const route = automaticEpisodeRoute(
    { id: 'show', season: 1, episode: 1, fileIndex: 0 },
    { torrentId: 'old-pack', fileIndex: 8 },
    'new-pack',
    automaticPlayback,
    'New Studio',
  )
  expect(route.path).toBe('/play/new-pack/0')
  expect(route.query).toMatchObject({ voice: 'New Studio', automatic: '1' })
})

it('checks the current pack before history when its episode file is not loaded yet', () => {
  const route = automaticEpisodeRoute(
    { id: 'show', season: 1, episode: 1 },
    { torrentId: 'old-pack', fileIndex: 8 },
    'new-pack',
    automaticPlayback,
    'New Studio',
  )
  expect(route.path).toBe('/title/show/play')
  expect(route.query).toMatchObject({
    torrent: 'new-pack',
    voice: 'New Studio',
  })
})

it('keeps the current next-episode file and voice without consulting history', () => {
  const route = automaticEpisodeRoute(
    { id: 'show', season: 1, episode: 3 },
    { torrentId: 'new-pack', fileIndex: 2 },
    'new-pack',
    automaticPlayback,
    'New Studio',
  )
  expect(route.path).toBe('/play/new-pack/2')
  expect(route.query?.voice).toBe('New Studio')
  expect(
    libraryRoute(
      'library-episode',
      { id: 'show' },
      automaticPlayback,
      'New Studio',
    ).query,
  ).toMatchObject({ voice: 'New Studio', automatic: '1' })
})
