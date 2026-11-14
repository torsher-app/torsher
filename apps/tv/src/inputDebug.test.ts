import { createRenderer, h, nextTick, ssrContextKey } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'

let cleanup: (() => void) | undefined
afterEach(() => {
  cleanup?.()
  cleanup = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.resetModules()
})
it('emits local screensaver events only when the existing input debug is enabled', async () => {
  const target = Object.assign(new EventTarget(), { location: { search: '' } })
  vi.stubGlobal('window', target)
  const listener = vi.fn()
  target.addEventListener('torsher:screensaver-debug', listener)
  const { inputDebug, reportScreensaverDebug }
    = await import('./inputDebug.ts')
  const event = { kind: 'phase', status: 'active', elapsed: 1000 } as const
  reportScreensaverDebug(event)
  expect(listener).not.toHaveBeenCalled()
  inputDebug.value = true
  reportScreensaverDebug(event)
  expect(listener).toHaveBeenCalledTimes(1)
  expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual(event)
  inputDebug.value = false
  reportScreensaverDebug(event)
  expect(listener).toHaveBeenCalledTimes(1)
})

const renderer = createRenderer<object, object>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: () => null,
  nextSibling: () => null,
  insert() {},
  remove() {},
})
it.each([
  { minutes: 2, status: 'waiting' },
  { minutes: 0, status: 'off' },
])(
  'records the current $status phase and elapsed time when diagnostics are enabled after startup',
  async ({ minutes, status }) => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
    const target = Object.assign(new EventTarget(), {
      location: { search: '' },
    })
    vi.stubGlobal('window', target)
    vi.stubGlobal(
      'document',
      Object.assign(new EventTarget(), {
        hidden: false,
        documentElement: { getAttribute: () => null },
      }),
    )
    const {
      inputDebug,
      toggleInputDebug,
      SCREENSAVER_DEBUG_EVENT,
      SCREENSAVER_DEBUG_REQUEST,
    } = await import('./inputDebug.ts')
    const { screensaverMinutes, useScreensaver }
      = await import('./composables/useScreensaver.ts')
    const { default: InputDebug } = await import('./components/InputDebug.vue')
    let debugLines: { text: string }[] = []
    const Debug = {
      ...InputDebug,
      render(
        _ctx: unknown,
        _cache: unknown,
        _props: unknown,
        setup: { lines: { text: string }[] },
      ) {
        debugLines = setup.lines
        return null
      },
    }
    screensaverMinutes.value = minutes
    const listener = vi.fn()
    target.addEventListener(SCREENSAVER_DEBUG_EVENT, listener)
    const app = renderer.createApp({
      setup() {
        useScreensaver(() => true)
        return () => (inputDebug.value ? h(Debug) : null)
      },
    })
    app.provide(ssrContextKey, {})
    app.mount({})
    cleanup = () => app.unmount()
    vi.advanceTimersByTime(35_000)
    expect(listener).not.toHaveBeenCalled()
    toggleInputDebug()
    await nextTick()
    expect(listener).toHaveBeenCalledTimes(1)
    expect((listener.mock.calls[0]![0] as CustomEvent).detail).toEqual({
      kind: 'phase',
      status,
      elapsed: 35_000,
    })
    expect(debugLines.map(line => line.text)).toEqual([
      `saver phase ${status} 35s`,
    ])
    vi.advanceTimersByTime(5000)
    expect(listener).toHaveBeenCalledTimes(1)
    app.unmount()
    cleanup = undefined
    target.dispatchEvent(new Event(SCREENSAVER_DEBUG_REQUEST))
    expect(listener).toHaveBeenCalledTimes(1)
  },
)
