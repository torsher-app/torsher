import type { Card, TitleMine } from '@torsher/api-client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { computed } from 'vue'
import { gateTarget } from './lib/session.ts'
import { chooseProfile, requireProfile, session } from './session.ts'
import {
  captureTitleViewer,
  followOf,
  knownTitleMine,
  noteTitleFollow,
  ownRatingOf,
  rememberTitleMine,
} from './titleActions.ts'

// Язык витрины зависит от браузера: здесь он не важен
vi.mock('./i18n.ts', () => ({ applyLanguage: () => {} }))

const profile = {
  id: 'kids',
  name: 'Kids',
  color: 'blue',
  language: null,
  hasPin: true,
  ageLimit: null,
  posterRatings: ['tmdb'],
  player: { autoNext: true, subtitleSize: 'm', subtitleBackground: 'box' },
}

describe('requireProfile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('does nothing before the showcase is ready', () => {
    expect(session.status).toBe('unknown')
    expect(requireProfile()).toBe(false)
    expect(session.status).toBe('unknown')
  })

  it('sends a ready showcase to the profile choice and back', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify(profile), {
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    )
    await chooseProfile('kids', '1234')

    expect(session.status).toBe('ready')
    const viewer = captureTitleViewer()
    await chooseProfile('kids', '1234')
    expect(captureTitleViewer()).toBe(viewer)
    expect(requireProfile()).toBe(true)
    expect(captureTitleViewer()).not.toBe(viewer)
    expect(session.status).toBe('choosing')
    expect(session.profile).toBeUndefined()
    expect(
      gateTarget(session.status, {
        path: '/title/movie:603',
        fullPath: '/title/movie:603',
        query: {},
      }),
    ).toEqual({ path: '/profiles', query: { next: '/title/movie:603' } })
    expect(requireProfile()).toBe(false)
  })

  it('shows the selected profile rating immediately despite the previous profile cache and late response', async () => {
    const select = vi.fn()
    vi.stubGlobal('fetch', select)
    const respond = (id: string) =>
      select.mockResolvedValueOnce(
        new Response(JSON.stringify({ ...profile, id }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    const card: Card = {
      id: 'movie:1',
      kind: 'movie',
      title: 'Example',
      originalTitle: 'Example',
      ownRating: 7,
      posterRatings: [{ source: 'tmdb', value: 7.3 }],
      followed: true,
    }
    const previousMine: TitleMine = {
      rating: null,
      watchlist: false,
      favorite: false,
      status: null,
      collections: [],
    }
    const badge = computed(() => ownRatingOf(card))

    respond('previous')
    await chooseProfile('previous')
    const previousViewer = captureTitleViewer()
    rememberTitleMine(card.id, previousMine, previousViewer)
    noteTitleFollow(card.id, false, previousViewer)
    expect(badge.value).toBeUndefined()
    expect(followOf(card)).toBeUndefined()

    respond('rated')
    await chooseProfile('rated')
    expect(session.profile?.id).toBe('rated')
    expect(badge.value).toBe(7)
    expect(followOf(card)).toEqual({ newCount: 0 })
    expect(knownTitleMine(card.id)).toBeUndefined()

    rememberTitleMine(card.id, previousMine, previousViewer)
    noteTitleFollow(card.id, false, previousViewer)
    expect(badge.value).toBe(7)
    expect(followOf(card)).toEqual({ newCount: 0 })
    expect(card.posterRatings).toEqual([{ source: 'tmdb', value: 7.3 }])

    requireProfile()
  })
})
