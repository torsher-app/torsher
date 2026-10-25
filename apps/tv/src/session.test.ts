import { afterEach, describe, expect, it, vi } from 'vitest'
import { gateTarget } from './lib/session.ts'
import { chooseProfile, requireProfile, session } from './session.ts'

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
    expect(requireProfile()).toBe(true)
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
})
