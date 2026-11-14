import { createRenderer, nextTick, ref } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { screensaverMinutes, useScreensaver } from './useScreensaver.ts'

vi.mock('../inputDebug.ts', () => ({
  reportScreensaverDebug: vi.fn(),
  SCREENSAVER_DEBUG_REQUEST: 'torsher:screensaver-debug-request',
}))
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
let cleanup: () => void
let documentEvents: EventTarget & { hidden: boolean }
let windowEvents: EventTarget
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  windowEvents = new EventTarget()
  documentEvents = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('window', windowEvents)
  vi.stubGlobal('document', documentEvents)
  screensaverMinutes.value = 2
})
afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function mount() {
  const enabled = ref(true)
  let saver!: ReturnType<typeof useScreensaver>
  const app = renderer.createApp({
    setup() {
      saver = useScreensaver(() => enabled.value)
      return () => null
    },
  })
  app.mount({})
  cleanup = () => app.unmount()
  return { saver, enabled }
}
it('clears an active saver synchronously when an automatic route transition disables it', async () => {
  const { saver, enabled } = mount()
  vi.advanceTimersByTime(120_000)
  expect(saver.active.value).toBe(true)
  enabled.value = false
  expect(saver.active.value).toBe(false)
  expect(saver.resting.value).toBe(false)
  vi.advanceTimersByTime(3600_000)
  enabled.value = true
  await nextTick()
  vi.advanceTimersByTime(115_000)
  expect(saver.active.value).toBe(false)
  vi.advanceTimersByTime(5000)
  expect(saver.active.value).toBe(true)
})
it('releases the visible session in background and preserves the original hour on return', () => {
  const { saver } = mount()
  vi.advanceTimersByTime(120_000)
  documentEvents.hidden = true
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  expect(saver.visible.value).toBe(false)
  expect(saver.active.value).toBe(true)
  vi.advanceTimersByTime(1000)
  documentEvents.hidden = false
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  expect(saver.visible.value).toBe(true)
  expect(saver.resting.value).toBe(false)
  documentEvents.hidden = true
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  // Browser timers may be suspended while hidden.
  vi.setSystemTime(Date.now() + 3600_000)
  documentEvents.hidden = false
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  expect(saver.visible.value).toBe(true)
  expect(saver.resting.value).toBe(true)
})
it('turns active and resting off immediately when the setting becomes zero', () => {
  const { saver } = mount()
  vi.advanceTimersByTime(3720_000)
  expect(saver.resting.value).toBe(true)
  screensaverMinutes.value = 0
  expect(saver.active.value).toBe(false)
  expect(saver.resting.value).toBe(false)
  vi.advanceTimersByTime(7200_000)
  expect(saver.active.value).toBe(false)
})
it('consumes only the first input and ignores repeated pointer coordinates', () => {
  const { saver } = mount()
  const pointer = () =>
    Object.assign(new Event('mousemove', { cancelable: true }), {
      screenX: 10,
      screenY: 10,
    })
  windowEvents.dispatchEvent(pointer())
  vi.advanceTimersByTime(120_000)
  windowEvents.dispatchEvent(pointer())
  expect(saver.active.value).toBe(true)
  const first = new Event('keydown', { cancelable: true })
  windowEvents.dispatchEvent(first)
  expect(first.defaultPrevented).toBe(true)
  expect(saver.active.value).toBe(false)
  const next = new Event('keydown', { cancelable: true })
  windowEvents.dispatchEvent(next)
  expect(next.defaultPrevented).toBe(false)
})
