import { effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTitleChanges } from './useTitleChanges.ts'

let scope: ReturnType<typeof effectScope>
beforeEach(() => {
  scope = effectScope()
})
afterEach(() => scope.stop())

function setup() {
  const version = ref(0)
  const active = ref(true)
  const ready = ref(true)
  const blocked = ref(false)
  const refresh = vi.fn(() => Promise.resolve())
  const sync = scope.run(() =>
    useTitleChanges(
      () => version.value,
      () => ready.value,
      refresh,
      () => active.value,
      () => blocked.value,
    ),
  )!
  return { version, active, ready, blocked, refresh, sync }
}

it('holds dirty versions across initial loading, KeepAlive and an open or reopened menu', async () => {
  const state = setup()
  state.ready.value = false
  state.version.value++
  await nextTick()
  state.active.value = false
  state.ready.value = true
  await nextTick()
  state.blocked.value = true
  state.active.value = true
  await nextTick()
  expect(state.refresh).not.toHaveBeenCalled()
  state.blocked.value = false
  state.blocked.value = true
  await nextTick()
  expect(state.refresh).not.toHaveBeenCalled()
  state.blocked.value = false
  await nextTick()
  expect(state.refresh).toHaveBeenCalledOnce()
  await nextTick()
  expect(state.sync()).toBe(false)
})

it('coalesces running changes and waits for the menu to close before a follow-up', async () => {
  const state = setup()
  let finish!: () => void
  state.refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  state.version.value++
  await nextTick()
  state.version.value += 2
  await nextTick()
  expect(state.sync()).toBe(true)
  expect(state.refresh).toHaveBeenCalledOnce()
  state.blocked.value = true
  finish()
  await nextTick()
  await nextTick()
  expect(state.refresh).toHaveBeenCalledOnce()
  state.blocked.value = false
  await nextTick()
  expect(state.refresh).toHaveBeenCalledTimes(2)
})

it('consumes a failed attempt without an automatic retry loop and accepts the next event', async () => {
  const state = setup()
  state.refresh.mockRejectedValueOnce(new Error('offline'))
  state.version.value++
  await nextTick()
  await nextTick()
  expect(state.refresh).toHaveBeenCalledOnce()
  state.version.value++
  await nextTick()
  expect(state.refresh).toHaveBeenCalledTimes(2)
})

it('keeps a failed version dirty and retries on the next activation without a loop', async () => {
  const state = setup()
  state.refresh.mockRejectedValueOnce(new Error('offline'))
  state.version.value++
  await nextTick()
  await nextTick()
  expect(state.refresh).toHaveBeenCalledTimes(1)
  state.active.value = false
  await nextTick()
  state.active.value = true
  await nextTick()
  await nextTick()
  expect(state.refresh).toHaveBeenCalledTimes(2)
  expect(state.sync()).toBe(false)
})

it('does not deliver accumulated changes after disposal', async () => {
  const state = setup()
  let finish!: () => void
  state.refresh.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  state.version.value++
  await nextTick()
  state.version.value++
  scope.stop()
  finish()
  await nextTick()
  await nextTick()
  expect(state.refresh).toHaveBeenCalledOnce()
})
