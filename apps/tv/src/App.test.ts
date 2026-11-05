import {
  createRenderer,
  defineComponent,
  h,
  onBeforeUnmount,
  ref,
  ssrContextKey,
} from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { DiagnosticInput } from './diagnostics/collector.ts'
import { createSupportRuntime } from './diagnostics/support.ts'
import App from './App.vue'

const mocks = vi.hoisted(() => ({ diagnosticError: vi.fn() }))
vi.mock('./diagnostics/index.ts', () => ({
  diagnosticError: mocks.diagnosticError,
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/play/fixture' }) }))
vi.mock('./router.ts', () => ({
  isStacked: () => false,
  screenKey: 'fixture',
}))
vi.mock('./session.ts', () => ({
  session: { profile: { id: 'profile-0001' } },
}))
vi.mock('./inputDebug.ts', () => ({ inputDebug: false }))
vi.mock('./composables/useScreensaver.ts', () => ({
  useScreensaver: () => ({ active: ref(false), resting: ref(false) }),
}))
vi.mock('./components/AppScreensaver.vue', () => ({ default: {} }))
vi.mock('./components/InputDebug.vue', () => ({ default: {} }))
vi.mock('./components/TitleActions.vue', () => ({ default: {} }))

interface Element {
  children: Element[]
  parent: Element | null
}
const element = (): Element => ({ children: [], parent: null })
const renderer = createRenderer<Element, Element>({
  createElement: element,
  createText: element,
  createComment: element,
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: node => node.parent,
  nextSibling: () => null,
  insert(node, parent) {
    node.parent = parent
    parent.children.push(node)
  },
  remove(node) {
    if (node.parent) {
      node.parent.children = node.parent.children.filter(
        child => child !== node,
      )
    }
  },
})
let support: ReturnType<typeof createSupportRuntime>
let events: DiagnosticInput[]
beforeEach(() => {
  vi.stubGlobal('__DEMO__', false)
  mocks.diagnosticError.mockReset()
  events = []
  support = createSupportRuntime({
    session: () => 'session-0001',
    now: Date.now,
    target: new EventTarget(),
    emit: input => events.push(input),
    environment: () => ({
      tvBuildId: 'test-build',
      clientKind: 'browser',
      browserFamily: 'unknown',
      osFamily: 'unknown',
      deviceModel: 'unsupported',
    }),
    assets: async () => new Map(),
    schedule: (fn, delay) => setTimeout(fn, delay),
    cancel: timer => clearTimeout(timer),
  })
  mocks.diagnosticError.mockImplementation(
    (...args: Parameters<typeof support.error>) => support.error(...args),
  )
})
afterEach(() => {
  support.setEnabled(false)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function mount(
  handler: () => unknown,
  teardown = false,
  terminal?: (error: unknown) => void,
) {
  let activate = () => {}
  const Child = defineComponent({
    emits: ['activate'],
    setup(_, { emit }) {
      activate = () => emit('activate')
      if (teardown)
        onBeforeUnmount(handler)
      return () => h('div')
    },
  })
  const app = renderer.createApp({
    ...App,
    render: () => h(Child, { onActivate: handler }),
  })
  // A terminal observer is used only for async/lifecycle cases: it proves the ancestor
  // did not consume the error. The separate synchronous test exercises Vue's default throw.
  if (terminal)
    app.config.errorHandler = terminal
  app.provide(ssrContextKey, {})
  app.mount(element())
  return { activate: () => activate(), unmount: () => app.unmount() }
}
const errors = () => events.filter(event => event.event === 'client.error')

it.each([false, true])(
  'preserves the identical default Vue synchronous throw with diagnostics %s',
  (enabled) => {
    support.setEnabled(enabled)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const original = new TypeError('SECRET /private/file?token=secret')
    const app = mount(() => {
      throw original
    })
    expect(app.activate).toThrow(original)
    expect(mocks.diagnosticError).toHaveBeenCalledExactlyOnceWith(
      'runtime',
      original,
    )
    expect(errors()).toHaveLength(enabled ? 1 : 0)
    expect(JSON.stringify(events)).not.toMatch(/SECRET|private|token/)
    app.unmount()
  },
)

it.each([false, true])(
  'preserves rejected async Vue handler propagation with diagnostics %s',
  async (enabled) => {
    support.setEnabled(enabled)
    const original = new TypeError('SECRET')
    Object.defineProperty(original, 'stack', {
      value: 'at secret (https://foreign/secret.js:4:8)',
    })
    const terminal = vi.fn()
    const app = mount(() => Promise.reject(original), false, terminal)
    app.activate()
    await Promise.resolve()
    await Promise.resolve()
    expect(terminal.mock.calls[0]?.[0]).toBe(original)
    expect(mocks.diagnosticError).toHaveBeenCalledExactlyOnceWith(
      'runtime',
      original,
    )
    expect(errors()).toHaveLength(enabled ? 1 : 0)
    if (enabled) {
      expect(errors()[0]).toMatchObject({
        source: 'runtime',
        code: 'type_error',
        locations: [],
        droppedLocations: 1,
      })
    }
    expect(JSON.stringify(events)).not.toMatch(/SECRET|foreign|secret\.js/)
    app.unmount()
  },
)

it.each([false, true])(
  'preserves descendant unmount propagation with diagnostics %s',
  (enabled) => {
    support.setEnabled(enabled)
    const original = new RangeError('SECRET')
    const terminal = vi.fn()
    const app = mount(
      () => {
        throw original
      },
      true,
      terminal,
    )
    app.unmount()
    expect(terminal.mock.calls[0]?.[0]).toBe(original)
    expect(mocks.diagnosticError).toHaveBeenCalledExactlyOnceWith(
      'runtime',
      original,
    )
    expect(errors()).toHaveLength(enabled ? 1 : 0)
    if (enabled)
      expect(errors()[0]).toMatchObject({ code: 'range_error' })
  },
)

it('does not install the observer in demo and respects runtime disable', () => {
  vi.stubGlobal('__DEMO__', true)
  support.setEnabled(true)
  const original = new Error('SECRET')
  const terminal = vi.fn()
  const demo = mount(
    () => {
      throw original
    },
    false,
    terminal,
  )
  demo.activate()
  expect(mocks.diagnosticError).not.toHaveBeenCalled()
  expect(terminal.mock.calls[0]?.[0]).toBe(original)
  demo.unmount()
  vi.stubGlobal('__DEMO__', false)
  const normal = mount(
    () => {
      throw original
    },
    false,
    terminal,
  )
  support.setEnabled(false)
  normal.activate()
  expect(errors()).toHaveLength(0)
  normal.unmount()
})

it('does not let a diagnostic observer failure replace the original error', () => {
  mocks.diagnosticError.mockImplementation(() => {
    throw new Error('reporter failure')
  })
  const terminal = vi.fn()
  const original = new Error('original')
  const app = mount(
    () => {
      throw original
    },
    false,
    terminal,
  )
  app.activate()
  expect(terminal).toHaveBeenCalledTimes(1)
  expect(terminal.mock.calls[0]?.[0]).toBe(original)
  app.unmount()
})
