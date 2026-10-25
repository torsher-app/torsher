import { LOADER_DELAY_MS, LOADER_MIN_VISIBLE_MS } from '@torsher/tokens/loader'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useHeldLoading } from './useHeldLoading'

function setup(initial: boolean) {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })

  const loading = ref(initial)
  const scope = effectScope()
  const shown = scope.run(() => useHeldLoading(() => loading.value))!

  async function finishAfter(ms: number) {
    vi.advanceTimersByTime(ms)
    loading.value = false
    await nextTick()
  }

  return { loading, scope, shown, finishAfter }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useHeldLoading', () => {
  it('drops the skeleton at once when the answer comes before it shows', async () => {
    const { shown, finishAfter } = setup(true)

    expect(shown.value).toBe(true)

    await finishAfter(LOADER_DELAY_MS - 50)

    expect(shown.value).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a skeleton that has just shown for the minimum time', async () => {
    const { shown, finishAfter } = setup(true)

    await finishAfter(LOADER_DELAY_MS + 100)
    expect(shown.value).toBe(true)

    vi.advanceTimersByTime(LOADER_MIN_VISIBLE_MS - 101)
    expect(shown.value).toBe(true)

    vi.advanceTimersByTime(1)
    expect(shown.value).toBe(false)
  })

  it('lets a skeleton that was visible long enough go at once', async () => {
    const { shown, finishAfter } = setup(true)

    await finishAfter(LOADER_DELAY_MS + LOADER_MIN_VISIBLE_MS + 500)

    expect(shown.value).toBe(false)
  })

  it('counts a load that comes back during the hold from its first start', async () => {
    const { loading, shown, finishAfter } = setup(true)

    await finishAfter(LOADER_DELAY_MS + 100)
    loading.value = true
    await nextTick()

    await finishAfter(LOADER_MIN_VISIBLE_MS)

    expect(shown.value).toBe(false)
  })

  it('starts the clock when a later load begins', async () => {
    const { loading, shown, finishAfter } = setup(false)

    expect(shown.value).toBe(false)

    vi.advanceTimersByTime(5000)
    loading.value = true
    await nextTick()
    expect(shown.value).toBe(true)

    await finishAfter(LOADER_DELAY_MS - 50)
    expect(shown.value).toBe(false)
  })

  it('clears the pending hold with its scope', async () => {
    const { scope, shown, finishAfter } = setup(true)

    await finishAfter(LOADER_DELAY_MS + 100)
    scope.stop()
    vi.advanceTimersByTime(LOADER_MIN_VISIBLE_MS)

    expect(shown.value).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
})
