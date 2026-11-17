import type { Profile } from '@torsher/api-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'
import { api } from './api.ts'
import { applyLanguage } from './i18n.ts'
import {
  chooseProfile,
  expireSession,
  guardSession,
  requireProfile,
  resolveSession,
  session,
} from './session.ts'

vi.mock('./i18n.ts', () => ({ applyLanguage: vi.fn() }))

const adult: Profile = {
  id: 'adult',
  name: 'Adult',
  color: 'rose',
  language: 'ru_RU',
  hasPin: false,
  ageLimit: null,
  posterRatings: ['tmdb'],
  player: { autoNext: true, subtitleSize: 'm', subtitleBackground: 'box' },
}
const fallback: Profile = {
  ...adult,
  id: 'default',
  name: 'Default',
  color: 'blue',
  language: 'en_US',
  ageLimit: 12,
  posterRatings: [],
  player: { autoNext: false, subtitleSize: 'l', subtitleBackground: 'none' },
}
const child: Profile = {
  ...adult,
  id: 'child',
  name: 'Child',
  hasPin: true,
  ageLimit: 6,
}

// Run the production gate with memory history, without mounting a browser UI.
function makeRouter() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: ['/', '/mine', '/play', '/profiles', '/connect'].map(path => ({
      path,
      component: {},
    })),
  })
  router.beforeEach(guardSession)
  return router
}

beforeEach(async () => {
  vi.spyOn(api.profiles, 'postProfileSelect').mockResolvedValue(adult)
  await chooseProfile(adult.id)
  vi.mocked(api.profiles.postProfileSelect)
    .mockClear()
    .mockResolvedValue(fallback)
  vi.mocked(applyLanguage).mockClear()
})
afterEach(() => {
  expireSession()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('navigation after deletion of the active viewer', () => {
  it('updates the actor and all profile fields before opening a new player', async () => {
    const list = vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [fallback, child],
      currentId: fallback.id,
      selected: false,
    })
    const router = makeRouter()
    await router.push('/mine')
    await router.push('/play')
    expect(router.currentRoute.value.path).toBe('/play')
    expect(session.profile).toEqual(fallback)
    expect(applyLanguage).toHaveBeenCalledWith(fallback.language)
    expect(list).toHaveBeenCalled()
  })
  it('commits the fallback selection before entering, replacing a stale owner cookie', async () => {
    vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [fallback, child],
      currentId: fallback.id,
      selected: false,
    })
    await makeRouter().push('/play')
    expect(api.profiles.postProfileSelect).toHaveBeenCalledExactlyOnceWith(
      fallback.id,
      {},
    )
  })

  it('does not open the player until fallback selection succeeds', async () => {
    vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [fallback, child],
      currentId: fallback.id,
      selected: false,
    })
    let select!: (profile: Profile) => void
    vi.mocked(api.profiles.postProfileSelect).mockImplementation(
      () =>
        new Promise((resolve) => {
          select = resolve
        }),
    )
    const router = makeRouter()
    const navigation = router.push('/play')
    await vi.waitFor(() => expect(select).toBeTypeOf('function'))
    expect(router.currentRoute.value.path).not.toBe('/play')
    select(fallback)
    await navigation
    expect(session.profile).toEqual(fallback)
  })

  it('requires selection if the fallback gains a PIN before it is committed', async () => {
    vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [fallback, child],
      currentId: fallback.id,
      selected: false,
    })
    vi.mocked(api.profiles.postProfileSelect).mockRejectedValue(
      new Error('PIN required'),
    )
    const router = makeRouter()
    await router.push('/play')
    expect(session.profile).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/profiles')
  })

  it.each(['choose', 'expire', 'require'] as const)(
    'ignores a late fallback selection after %s',
    async (action) => {
      vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
        items: [fallback, child],
        currentId: fallback.id,
        selected: false,
      })
      let select!: (profile: Profile) => void
      vi.mocked(api.profiles.postProfileSelect).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            select = resolve
          }),
      )
      const pending = resolveSession()
      await vi.waitFor(() => expect(select).toBeTypeOf('function'))
      if (action === 'choose') {
        vi.mocked(api.profiles.postProfileSelect).mockResolvedValue(child)
        await chooseProfile(child.id, '1234')
      }
      else if (action === 'expire') {
        expireSession()
      }
      else {
        requireProfile()
      }
      select(fallback)
      await pending
      expect(session.profile?.id).toBe(
        action === 'choose' ? child.id : undefined,
      )
      expect(session.status).toBe(
        action === 'choose'
          ? 'ready'
          : action === 'expire'
            ? 'unpaired'
            : 'choosing',
      )
    },
  )

  it('waits for validation before entering the player', async () => {
    let respond!: (value: {
      items: Profile[]
      currentId: string
      selected: boolean
    }) => void
    vi.spyOn(api.profiles, 'getProfiles').mockImplementation(
      () =>
        new Promise((resolve) => {
          respond = resolve
        }),
    )
    const router = makeRouter()
    const navigation = router.push('/play')
    await vi.waitFor(() => expect(respond).toBeTypeOf('function'))
    expect(router.currentRoute.value.path).not.toBe('/play')
    respond({
      items: [fallback, child],
      currentId: fallback.id,
      selected: false,
    })
    await navigation
    expect(session.profile?.id).toBe(fallback.id)
    expect(router.currentRoute.value.path).toBe('/play')
  })

  it('requires selection when the fallback is protected by a PIN', async () => {
    vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [{ ...fallback, hasPin: true }, child],
      currentId: '',
      selected: false,
    })
    const router = makeRouter()
    await router.push('/play?start=0')
    expect(session.status).toBe('choosing')
    expect(session.profile).toBeUndefined()
    expect(router.currentRoute.value.fullPath).toBe(
      '/profiles?next=/play?start=0',
    )
  })

  it('requires PIN for the only remaining profile', async () => {
    const select = vi.mocked(api.profiles.postProfileSelect)
    select.mockClear()
    vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [{ ...fallback, hasPin: true }],
      currentId: '',
      selected: false,
    })
    await makeRouter().push('/play')
    expect(session.status).toBe('choosing')
    expect(select).not.toHaveBeenCalled()
  })

  it('blocks stale actor use when validation fails', async () => {
    vi.spyOn(api.profiles, 'getProfiles').mockRejectedValue(
      new Error('offline'),
    )
    const router = makeRouter()
    await router.push('/play')
    expect(session.profile).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/profiles')
  })

  it('clears the actor when the device is revoked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    )
    const router = makeRouter()
    await router.push('/play')
    expect(session.status).toBe('unpaired')
    expect(session.profile).toBeUndefined()
    expect(router.currentRoute.value.path).toBe('/connect')
  })

  it('refreshes settings and identity fields for the same profile ID', async () => {
    const changed = { ...fallback, id: adult.id }
    vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [changed, child],
      currentId: adult.id,
      selected: true,
    })
    await makeRouter().push('/play')
    expect(session.profile).toEqual(changed)
  })

  it.each(['choose', 'expire', 'require'] as const)(
    'ignores a late response after %s',
    async (action) => {
      let respond!: (value: {
        items: Profile[]
        currentId: string
        selected: boolean
      }) => void
      vi.spyOn(api.profiles, 'getProfiles').mockImplementation(
        () =>
          new Promise((resolve) => {
            respond = resolve
          }),
      )
      const pending = resolveSession()
      if (action === 'choose') {
        vi.mocked(api.profiles.postProfileSelect).mockResolvedValue(child)
        await chooseProfile(child.id, '1234')
      }
      else if (action === 'expire') {
        expireSession()
      }
      else {
        requireProfile()
      }
      respond({
        items: [fallback, child],
        currentId: fallback.id,
        selected: false,
      })
      await pending
      expect(session.profile?.id).toBe(
        action === 'choose' ? child.id : undefined,
      )
      expect(session.status).toBe(
        action === 'choose'
          ? 'ready'
          : action === 'expire'
            ? 'unpaired'
            : 'choosing',
      )
    },
  )

  it('uses the latest validation when navigation overlaps', async () => {
    const replies: ((value: {
      items: Profile[]
      currentId: string
      selected: boolean
    }) => void)[] = []
    vi.spyOn(api.profiles, 'getProfiles').mockImplementation(
      () =>
        new Promise((resolve) => {
          replies.push(resolve)
        }),
    )
    const first = resolveSession()
    const second = resolveSession()
    replies[0]!({ items: [adult, child], currentId: adult.id, selected: true })
    await first
    replies[1]!({
      items: [fallback, child],
      currentId: fallback.id,
      selected: false,
    })
    await second
    expect(session.profile).toEqual(fallback)
  })

  it('preserves the initial choice when several profiles are available', async () => {
    expireSession()
    vi.spyOn(api.profiles, 'getProfiles').mockResolvedValue({
      items: [fallback, child],
      currentId: fallback.id,
      selected: false,
    })
    await resolveSession()
    expect(session.status).toBe('choosing')
    expect(session.profile).toBeUndefined()
  })
})
