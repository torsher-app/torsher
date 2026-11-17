import type { Card } from '@torsher/api-client'
import type { Component } from 'vue'
import {
  createRenderer,
  h,
  KeepAlive,
  nextTick,
  ref,
  shallowRef,
  ssrContextKey,
} from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MinePage from './MinePage.vue'
import { titleActions } from '../titleActions.ts'

const actions = titleActions as unknown as { version: number, target?: object }

const mocks = vi.hoisted(() => ({
  mine: {} as any,
  sections: {} as any,
  focus: {} as any,
  listener: (_el: any, _via: string) => {},
  select: (_key: string) => {},
}))
vi.mock('../titleActions.ts', async () => {
  const { reactive } = await import('vue')
  return { titleActions: reactive({ version: 0, target: undefined }) }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))
vi.mock('../focus/index.ts', () => ({ useFocus: () => mocks.focus }))
vi.mock('../composables/useMine.ts', async () => {
  const { ref } = await import('vue')
  return {
    useMineItems: () => mocks.mine,
    useMineSections: () => mocks.sections,
    useSchedule: () => ({
      schedule: ref(),
      status: ref('ready'),
      refresh: vi.fn(),
    }),
  }
})
vi.mock('../composables/useStackScroll.ts', async () => {
  const { ref } = await import('vue')
  return {
    useStackScroll: () => ({
      native: false,
      offset: ref(0),
      followsFocus: ref(false),
      alignTo: vi.fn(),
      onScroll: vi.fn(),
      onWheel: vi.fn(),
      transform: ref(''),
    }),
  }
})
vi.mock('../composables/useHeldLoading.ts', async () => {
  const { ref } = await import('vue')
  return { useHeldLoading: () => ref(false) }
})
// The node renderer exercises real MinePage setup/watchers/KeepAlive lifecycle.
// Its render adapter supplies just the grid DOM used by the focus service.
vi.mock('../components/ScreenState.vue', () => ({ default: {} }))
vi.mock('../components/FocusSection.vue', () => ({ default: {} }))
vi.mock('../components/AppIcon.vue', () => ({ default: {} }))
vi.mock('../components/PosterSkeleton.vue', () => ({ default: {} }))
vi.mock('../components/AppRail.vue', () => ({ default: {} }))
vi.mock('../components/MineSchedule.vue', () => ({ default: {} }))
vi.mock('../components/OptionsPanel.vue', () => ({ default: {} }))
vi.mock('../components/PosterCard.vue', () => ({ default: {} }))

interface Node {
  parent: Node | null
  children: Node[]
}
const node = (): Node => ({ parent: null, children: [] })
function remove(el: Node) {
  if (el.parent)
    el.parent.children = el.parent.children.filter(child => child !== el)
}
const renderer = createRenderer<Node, Node>({
  createElement: node,
  createText: node,
  createComment: node,
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: el => el.parent,
  nextSibling: () => null,
  insert(el, parent) {
    remove(el)
    el.parent = parent
    parent.children.push(el)
  },
  remove,
})
interface Button {
  id: string
  isConnected: boolean
  dataset: { index: string }
  closest: () => Button
}
let current: Button | undefined
let last: Button | undefined
let cards: Button[]
let cleanup: () => void
let visible: ReturnType<typeof ref<boolean>>
const section = {
  id: 'selected-section',
  isConnected: true,
  dataset: { index: '' },
  closest() {
    return this
  },
} as Button
async function settle() {
  for (let i = 0; i < 10; i++) await nextTick()
}
async function mount(key = 'favorites') {
  const grid = {
    contains: (el: Button) => cards.includes(el),
    querySelectorAll: () => cards,
    querySelector: (selector: string) =>
      cards[Number(selector.match(/data-index="(\d+)"/)?.[1])],
  }
  const sectionsRoot = { contains: () => false, querySelector: () => section }
  const root = {
    contains: (el: Button) => cards.includes(el) || el === section,
  }
  visible = ref(true)
  const page = {
    ...MinePage,
    render(_ctx: unknown, _cache: unknown, _props: unknown, setup: any) {
      setup.root = root
      setup.gridRoot = grid
      setup.sectionsRoot = sectionsRoot
      mocks.select = setup.select
      const ids = (setup.items as Card[]).map(item => item.id)
      const previous = cards
      cards = ids.map((id, index) => {
        const button = previous.find(item => item.id === id) ?? {
          id,
          isConnected: true,
          dataset: { index: '' },
          closest() {
            return this
          },
        }
        button.dataset.index = String(index)
        return button
      })
      for (const removed of previous.filter(item => !cards.includes(item))) {
        removed.isConnected = false
        // v-focusable beforeUnmount unregisters the removed last element.
        if (current === removed)
          current = undefined
        if (last === removed)
          last = undefined
      }
      return null
    },
  }
  const app = renderer.createApp({
    render: () =>
      h(KeepAlive, () => (visible.value ? h(page as Component) : null)),
  })
  app.provide(ssrContextKey, {})
  app.mount(node())
  cleanup = () => app.unmount()
  await settle()
  mocks.select(key)
  await settle()
}
function focus(index: number) {
  mocks.focus.focusOn(cards[index])
}
function replace(ids: string[]) {
  mocks.mine.items.value = ids.map(id => ({ id }))
}
beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, innerWidth: 1920 })
  current = undefined
  last = undefined
  cards = []
  actions.version = 0
  actions.target = undefined
  mocks.sections = {
    status: ref('ready'),
    sections: shallowRef([
      { id: 'continue', count: 3 },
      { id: 'favorites', count: 3 },
      { id: 'watchlist', count: 3 },
      { id: 'ratings', count: 3 },
      { id: 'collection', collectionId: 'own', count: 3 },
    ]),
    refresh: vi.fn(),
  }
  mocks.mine = {
    status: ref('ready'),
    items: shallowRef(['first', 'middle', 'last'].map(id => ({ id }))),
    total: ref(3),
    refreshReady: ref(true),
    more: vi.fn(),
    refresh: vi.fn(),
  }
  mocks.focus = {
    onFocus: (listener: typeof mocks.listener) => {
      mocks.listener = listener
      return () => {}
    },
    onKey: () => () => {},
    current: () => current,
    activate: vi.fn(() => mocks.focus.focusOn(last ?? cards[0])),
    focusOn: vi.fn((el: Button | undefined) => {
      if (!el?.isConnected)
        return false
      current = el
      last = el
      mocks.listener(el, 'nav')
      return true
    }),
  }
})
afterEach(() => {
  cleanup?.()
  vi.unstubAllGlobals()
})

it.each(['favorites', 'watchlist', 'ratings', 'collection:own'])(
  'restores the neighbour after returning to %s and removing its middle card',
  async (key) => {
    await mount(key)
    focus(1)
    visible.value = false
    await settle()
    const response = Promise.withResolvers<void>()
    mocks.mine.refresh.mockImplementation(async () => {
      await response.promise
      replace(['first', 'last'])
    })
    actions.version++
    await settle()
    expect(mocks.mine.refresh).not.toHaveBeenCalled()
    visible.value = true
    await settle()
    expect(current?.id).toBe('middle')
    expect(mocks.mine.refresh).toHaveBeenCalledOnce()
    response.resolve()
    await settle()
    expect(current?.id).toBe('last')
    expect(current?.isConnected).toBe(true)
  },
)
it.each([
  { index: 2, remaining: ['first', 'middle'], expected: 'middle' },
  { index: 0, remaining: [], expected: 'selected-section' },
  { index: 1, remaining: ['new', 'middle', 'last'], expected: 'middle' },
])(
  'restores $expected when the refreshed grid contains $remaining',
  async ({ index, remaining, expected }) => {
    await mount()
    focus(index)
    replace(remaining)
    await settle()
    expect(current?.id).toBe(expected)
  },
)
it('does not move focus from the section list when cards refresh', async () => {
  await mount()
  mocks.focus.focusOn(section)
  replace(['last'])
  await settle()
  expect(current).toBe(section)
})
it('does not restore a grid card while a title action panel is open', async () => {
  await mount()
  focus(1)
  actions.target = {}
  replace(['first', 'last'])
  await settle()
  expect(current).toBeUndefined()
})
it('does not focus a cached screen after leaving during refresh', async () => {
  await mount()
  focus(1)
  replace(['first', 'last'])
  visible.value = false
  await settle()
  expect(current).toBeUndefined()
})
