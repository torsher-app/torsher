import type {
  FollowTitleInput,
  TitleFollowResponse,
} from '@torsher/api-client'
import { effectScope, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setTitleViewer } from '../titleActions.ts'
import { useTitleFollow } from './useTitleFollow.ts'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  save: vi.fn(),
  stop: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: {
    titles: {
      getTitleFollow: mocks.get,
      followTitle: mocks.save,
      unfollowTitle: mocks.stop,
    },
  },
  loadErrorOf: () => 'unavailable',
}))
vi.mock('./useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
  scope = effectScope()
})
afterEach(() => scope.stop())

it.each(['save', 'stop'] as const)(
  'keeps confirmed %s state when an older quiet GET arrives later',
  async (action) => {
    const original = {
      follow: { subscribed: true, state: 'searching' },
    } as unknown as TitleFollowResponse
    const fresh = {
      follow: {
        subscribed: action === 'save',
        state: action === 'save' ? 'active' : 'stopped',
      },
    } as unknown as TitleFollowResponse
    mocks.get.mockResolvedValueOnce(original)
    const follow = scope.run(() => useTitleFollow(ref('title')))!
    await vi.waitFor(() => expect(follow.followStatus.value).toBe('ready'))
    let finish!: (value: TitleFollowResponse) => void
    mocks.get.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const refresh = follow.refreshFollow()
    mocks[action].mockResolvedValueOnce(fresh)
    expect(
      await (action === 'save'
        ? follow.save({} as FollowTitleInput)
        : follow.stop()),
    ).toBe(true)
    expect(mocks.get.mock.calls[1]![2].signal.aborted).toBe(true)
    finish(original)
    await refresh
    expect(follow.followView.value).toEqual(fresh)
    expect(follow.followStatus.value).toBe('ready')
  },
)
