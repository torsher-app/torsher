import type { Component } from 'vue'
import {
  createRenderer,
  h,
  nextTick,
  onMounted,
  ref,
  ssrContextKey,
} from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  screensaverMinutes,
  useScreensaver,
} from '../composables/useScreensaver.ts'
import AppScreensaver from './AppScreensaver.vue'

const mocks = vi.hoisted(() => ({
  webos: false,
  android: false,
  luna: vi.fn(),
  androidHold: vi.fn(),
  video: vi.fn(),
  releaseLuna: vi.fn(),
  releaseAndroid: vi.fn(),
  releaseVideo: vi.fn(),
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('en') }) }))
vi.mock('../composables/useScreensaverBackdrops.ts', () => ({
  useScreensaverBackdrops: () => ({ items: ref([]), key: ref('safe') }),
}))
vi.mock('../inputDebug.ts', () => ({
  reportScreensaverDebug: vi.fn(),
  SCREENSAVER_DEBUG_REQUEST: 'torsher:screensaver-debug-request',
}))
vi.mock('../platform/webos.ts', () => ({
  isWebos: () => mocks.webos,
  holdSystemScreensaver: mocks.luna,
}))
vi.mock('../platform/android.ts', () => ({
  get isAndroidShell() {
    return mocks.android
  },
  holdAndroidScreen: mocks.androidHold,
}))
vi.mock('../platform/screensaverVideo.ts', () => ({
  startScreensaverVideo: mocks.video,
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
// Keep setup and lifecycle, replace only the DOM rendered by the SSR-compiled SFC.
const Saver = Object.assign({}, AppScreensaver, {
  render(
    _ctx: unknown,
    _cache: unknown,
    _props: unknown,
    setup: { hold?: object },
  ) {
    if (mocks.webos && !setup.hold)
      setup.hold = {}
    return null
  },
})
let cleanup: () => void
let documentEvents: EventTarget & { hidden: boolean }
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(100_000)
  vi.clearAllMocks()
  mocks.webos = false
  mocks.android = false
  mocks.luna.mockReturnValue(mocks.releaseLuna)
  mocks.androidHold.mockReturnValue(mocks.releaseAndroid)
  mocks.video.mockReturnValue(mocks.releaseVideo)
  documentEvents = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('document', documentEvents)
  vi.stubGlobal('window', new EventTarget())
  screensaverMinutes.value = 2
})
afterEach(() => {
  cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function mount(component: Component, props?: Record<string, unknown>) {
  const app = renderer.createApp(component, props)
  app.provide(ssrContextKey, {})
  app.mount({})
  cleanup = () => app.unmount()
}
it('does not start hold, slides, or clocks when mounted already resting', () => {
  mocks.webos = true
  mount(Saver, { resting: true })
  expect(mocks.video).not.toHaveBeenCalled()
  expect(mocks.luna).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})
it('does not acquire video or platform resources on desktop', () => {
  mount(Saver, { resting: false })
  expect(mocks.video).not.toHaveBeenCalled()
  expect(mocks.luna).not.toHaveBeenCalled()
  expect(mocks.androidHold).not.toHaveBeenCalled()
})
it('preserves Android hold without a video and releases at rest', async () => {
  mocks.android = true
  const resting = ref(false)
  mount({ setup: () => () => h(Saver, { resting: resting.value }) })
  expect(mocks.androidHold).toHaveBeenCalledTimes(1)
  expect(mocks.video).not.toHaveBeenCalled()
  resting.value = true
  await nextTick()
  expect(mocks.releaseAndroid).toHaveBeenCalledTimes(1)
  expect(vi.getTimerCount()).toBe(0)
})
it('releases on hide, remounts before the hour, and does not reacquire after the original hour', async () => {
  mocks.webos = true
  mount({
    setup() {
      const saver = useScreensaver(() => true)
      return () =>
        saver.active.value && saver.visible.value
          ? h(Saver, { resting: saver.resting.value })
          : null
    },
  })
  await vi.advanceTimersByTimeAsync(120_000)
  expect(mocks.video).toHaveBeenCalledTimes(1)
  documentEvents.hidden = true
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  expect(mocks.releaseVideo).toHaveBeenCalledTimes(1)
  expect(mocks.releaseLuna).toHaveBeenCalledTimes(1)
  documentEvents.hidden = false
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  expect(mocks.video).toHaveBeenCalledTimes(2)
  documentEvents.hidden = true
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  vi.setSystemTime(Date.now() + 3600_000)
  documentEvents.hidden = false
  documentEvents.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  expect(mocks.video).toHaveBeenCalledTimes(2)
  expect(mocks.luna).toHaveBeenCalledTimes(2)
})
it('releases the saver decoder before an automatically routed player mounts', async () => {
  mocks.webos = true
  const player = ref(false)
  const mounted = vi.fn(() => {
    expect(mocks.releaseVideo).toHaveBeenCalledTimes(1)
    expect(mocks.releaseLuna).toHaveBeenCalledTimes(1)
  })
  const Player = {
    setup() {
      onMounted(mounted)
      return () => null
    },
  }
  mount({
    setup() {
      const saver = useScreensaver(() => !player.value)
      // Same ordering as App: route first, screensaver second. mounted is post-flush.
      return () =>
        h('root', [
          player.value ? h(Player) : null,
          saver.active.value && saver.visible.value
            ? h(Saver, { resting: saver.resting.value })
            : null,
        ])
    },
  })
  await vi.advanceTimersByTimeAsync(120_000)
  expect(mocks.video).toHaveBeenCalledTimes(1)
  player.value = true
  await nextTick()
  expect(mounted).toHaveBeenCalledTimes(1)
})
