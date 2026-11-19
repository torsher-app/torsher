import { createRenderer, nextTick, ssrContextKey } from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { setTitleViewer } from '../../titleActions.ts'
import { mineViewer } from '../../lib/minePersonal.ts'
import { mineUndo, showMineUndo } from '../../lib/mineUndo.ts'
import MineUndoToast from './MineUndoToast.vue'

const mocks = vi.hoisted(() => ({
  key: (_action: any) => false,
  listener: (_element: any) => {},
  current: undefined as any,
  focusOn: vi.fn(),
  activate: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('../../api.ts', () => ({
  api: { mine: { deleteMineDiaryEntry: mocks.remove } },
}))
vi.mock('../../focus/index.ts', () => ({
  useFocus: () => ({
    current: () => mocks.current,
    activate: mocks.activate,
    focusOn: mocks.focusOn,
    onKey: (fn: typeof mocks.key) => {
      mocks.key = fn
      return () => {}
    },
    onFocus: (fn: typeof mocks.listener) => {
      mocks.listener = fn
      return () => {}
    },
  }),
}))
vi.mock('../../focus/titleActionReturn.ts', () => ({
  captureTitleActionReturn: () => () => false,
}))
vi.mock('vue-router', () => ({ useRoute: () => ({ fullPath: '/mine' }) }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: 'en_US' }),
}))
vi.mock('../FocusSection.vue', () => ({ default: {} }))
const renderer = createRenderer<object, object>({
  patchProp() {},
  insert() {},
  remove() {},
  setElementText() {},
  setText() {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  parentNode: () => null,
  nextSibling: () => null,
})
let dispose: (() => void) | undefined
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('__DEMO__', false)
  vi.resetAllMocks()
  setTitleViewer(undefined)
  setTitleViewer('A')
})
afterEach(() => {
  dispose?.()
  mineUndo.value = undefined
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

async function mount() {
  const opener = { isConnected: true, closest: () => null }
  const button = {}
  mocks.current = opener
  showMineUndo({
    kind: 'logged',
    entryId: 'entry',
    day: null,
    titleId: 'film',
    title: 'Fictional film',
    language: 'en-US',
    context: mineViewer()!,
    opener: opener as unknown as HTMLElement,
  })
  const app = renderer.createApp(
    { ...MineUndoToast, render: () => null },
    { change: mineUndo.value! },
  )
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount({})
  dispose = () => app.unmount()
  const vm = (
    app as unknown as {
      _instance: { setupState: { root: unknown, undo: () => Promise<void> } }
    }
  )._instance.setupState
  vm.root = { contains: (element: unknown) => element === button }
  mocks.activate.mockImplementation(() => {
    mocks.current = button
    mocks.listener(button)
    return true
  })
  mocks.focusOn.mockImplementation((element) => {
    mocks.current = element
    mocks.listener(element)
    return true
  })
  await nextTick()
  return { vm, opener }
}

it('leaves focus on the opener, reaches Undo with Down, and pauses expiry until Back', async () => {
  const { opener } = await mount()
  expect(mocks.activate).not.toHaveBeenCalled()
  expect(mocks.current).toBe(opener)
  expect(mocks.key({ type: 'move', direction: 'down' })).toBe(true)
  expect(mocks.activate).toHaveBeenCalledWith('mine-undo', 'nav')
  await vi.advanceTimersByTimeAsync(20_000)
  expect(mineUndo.value).toBeDefined()
  expect(mocks.key({ type: 'back' })).toBe(true)
  await nextTick()
  expect(mocks.focusOn).toHaveBeenCalledWith(opener)
  expect(mineUndo.value).toBeUndefined()
})

it('does not recreate an expiry timer after an in-flight undo unmounts', async () => {
  let finish!: () => void
  mocks.remove.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  const { vm } = await mount()
  const pending = vm.undo()
  dispose!()
  finish()
  await pending
  expect(vi.getTimerCount()).toBe(0)
})
