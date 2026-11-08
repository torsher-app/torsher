import { effectScope, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useFollowSave } from './useFollowSave.ts'

const { dispose } = vi.hoisted(() => ({ dispose: [] as (() => void)[] }))
vi.mock('vue', async original => ({
  ...(await original<typeof import('vue')>()),
  onBeforeUnmount: (fn: () => void) => dispose.push(fn),
}))
beforeEach(() => {
  dispose.length = 0
})
function setup(save: (body: object) => Promise<boolean>) {
  const scope = effectScope()
  const context = ref('title|2')
  const state = scope.run(() => useFollowSave(context, ref(true), save))!
  return {
    state,
    context,
    stop() {
      dispose.forEach(fn => fn())
      scope.stop()
    },
  }
}
describe('follow panel save ownership', () => {
  it.each([true, false])(
    'ignores old completion %s after switching title/season',
    async (result) => {
      let finish!: (result: boolean) => void
      const save = vi
        .fn()
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              finish = resolve
            }),
        )
        .mockResolvedValueOnce(true)
      const { state, context, stop } = setup(save)
      const old = state.persist({
        voicePolicy: { mode: 'only', studio: 'Studio A' },
      })
      context.value = 'other-title|3'
      const current = state.persist({ voicePolicy: { mode: 'any' } })
      finish(result)
      expect(await old).toBe(false)
      expect(await current).toBe(true)
      expect(state.error.value).toBe(false)
      expect(state.saving.value).toBe(false)
      stop()
    },
  )
  it('ignores stale errors/finally while the new context is saving', async () => {
    let reject!: (error: Error) => void
    let finish!: (result: boolean) => void
    const save = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((_, fail) => {
            reject = fail
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
    const { state, context, stop } = setup(save)
    const old = state.persist({ mode: 'notify' })
    context.value = 'title|3'
    const current = state.persist({ mode: 'download' })
    reject(new Error('offline'))
    expect(await old).toBe(false)
    expect(state.error.value).toBe(false)
    expect(state.saving.value).toBe(true)
    finish(true)
    await current
    stop()
  })
  it('deduplicates an explicit action and permits retry after failed save', async () => {
    const save = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const { state, stop } = setup(save)
    const body = { voicePolicy: { mode: 'only' as const, studio: 'Studio B' } }
    const pending = state.persist(body)
    expect(await state.persist(body)).toBe(false)
    expect(await pending).toBe(false)
    expect(state.error.value).toBe(true)
    expect(await state.persist(body)).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    expect(body.voicePolicy.studio).toBe('Studio B')
    stop()
  })
})
