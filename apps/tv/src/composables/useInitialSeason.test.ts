import { effectScope, nextTick, ref } from 'vue'
import { describe, expect, it, vi } from 'vitest'
import { useInitialSeason } from './useInitialSeason.ts'
import type { ResourceStatus } from './useResource.ts'

function setup() {
  const scope = effectScope()
  const seasons = ref<{ number: number }[]>([])
  const status = ref<ResourceStatus>('loading')
  const resume = ref<number | null>(2)
  const apply = vi.fn()
  const selection = scope.run(() =>
    useInitialSeason(seasons, status, () => resume.value, apply),
  )!
  return { scope, seasons, status, resume, apply, selection }
}

describe('initial season lifecycle', () => {
  it.each(['catalog', 'progress'])(
    'waits for both resources when %s arrives first',
    async (first) => {
      const state = setup()
      if (first === 'catalog')
        state.seasons.value = [{ number: 1 }, { number: 2 }]
      else state.status.value = 'ready'
      await nextTick()
      expect(state.apply).not.toHaveBeenCalled()
      state.seasons.value = [{ number: 1 }, { number: 2 }]
      state.status.value = 'ready'
      await nextTick()
      expect(state.apply).toHaveBeenCalledExactlyOnceWith(2)
      state.scope.stop()
    },
  )
  it('keeps a manual choice before late progress, including the same selected number', async () => {
    const state = setup()
    state.seasons.value = [{ number: 1 }, { number: 2 }]
    state.selection.manual()
    state.status.value = 'ready'
    await nextTick()
    expect(state.apply).not.toHaveBeenCalled()
    state.scope.stop()
  })
  it('does not reinitialize on background refresh/return but a new instance uses fresh resume', async () => {
    const state = setup()
    state.seasons.value = [{ number: 1 }, { number: 2 }]
    state.status.value = 'ready'
    await nextTick()
    state.selection.manual()
    state.resume.value = 1
    state.seasons.value = [...state.seasons.value]
    await nextTick()
    expect(state.apply).toHaveBeenCalledExactlyOnceWith(2)
    state.scope.stop()
    const fresh = setup()
    fresh.resume.value = 1
    fresh.seasons.value = state.seasons.value
    fresh.status.value = 'ready'
    await nextTick()
    expect(fresh.apply).toHaveBeenCalledExactlyOnceWith(1)
    fresh.scope.stop()
  })
  it('falls back after progress failure and waits harmlessly for an empty catalog', async () => {
    const state = setup()
    state.status.value = 'error'
    await nextTick()
    expect(state.apply).not.toHaveBeenCalled()
    state.seasons.value = [{ number: 1 }]
    await nextTick()
    expect(state.apply).toHaveBeenCalledExactlyOnceWith(1)
    state.scope.stop()
  })
})
