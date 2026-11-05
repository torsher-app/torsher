import type { LibraryFile } from '@torsher/api-client'
import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { libraryRoute } from '../lib/continue.ts'
import { libraryChoices } from '../lib/library.ts'
import { useLibraryPicker } from './useLibraryPicker.ts'

const mocks = vi.hoisted(() => ({
  opener: { isConnected: true },
  focusOn: vi.fn(),
  deactivate: undefined as (() => void) | undefined,
}))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ current: () => mocks.opener, focusOn: mocks.focusOn }),
}))
vi.mock('vue', async original => ({
  ...(await original<typeof import('vue')>()),
  onDeactivated: (callback: () => void) => {
    mocks.deactivate = callback
  },
}))

function file(id: string, episode: number, episodeTo = episode): LibraryFile {
  return {
    id,
    season: 1,
    episode,
    episodeTo,
    quality: '1080p',
    size: 1000,
    duration: null,
  }
}

beforeEach(() => {
  mocks.focusOn.mockClear()
})

describe('library version selection', () => {
  it('plays a single file directly and preserves the episode inside its range', () => {
    const navigate = vi.fn()
    const picker = useLibraryPicker((id, target) =>
      navigate(libraryRoute(id, { id: 'show', ...target })),
    )

    picker.open(
      libraryChoices([file('combined', 1, 3)], true, { season: 1, episode: 2 }),
    )
    expect(picker.selection.value).toBeUndefined()
    expect(navigate).toHaveBeenCalledWith({
      path: '/play/library/combined',
      query: { title: 'show', season: '1', episode: '2' },
    })
  })

  it('waits for an explicit version, retaining the current ID and exact episode', () => {
    const play = vi.fn()
    const picker = useLibraryPicker(play)
    const choice = libraryChoices(
      [file('new', 2), file('previous', 1, 3)],
      true,
      { season: 1, episode: 2 },
    )

    picker.open({ ...choice, currentId: 'previous' })
    expect(play).not.toHaveBeenCalled()
    expect(picker.selection.value?.currentId).toBe('previous')
    picker.select('hidden-or-removed')
    expect(play).not.toHaveBeenCalled()
    picker.select('previous')
    expect(play).toHaveBeenCalledExactlyOnceWith(
      'previous',
      {
        season: 1,
        episode: 2,
      },
      true,
    )
    expect(picker.selection.value).toBeUndefined()
  })

  it('cancel restores the opener, does not play, and discards stale selections', async () => {
    const play = vi.fn()
    const picker = useLibraryPicker(play)

    picker.open({
      files: [file('a', 1), file('b', 1)],
      target: { season: 1, episode: 1 },
    })
    picker.close()
    await nextTick()
    picker.select('a')
    expect(play).not.toHaveBeenCalled()
    expect(mocks.focusOn).toHaveBeenCalledWith(mocks.opener)
    picker.open({ files: [file('a', 1), file('b', 1)], target: {} })
    mocks.deactivate?.()
    picker.select('b')
    expect(play).not.toHaveBeenCalled()
  })
})
