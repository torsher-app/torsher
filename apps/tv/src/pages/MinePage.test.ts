import type {
  Card,
  MineDiaryMonths,
  MineDiaryPage,
  MineRecommendationItem,
  MineOverview as OverviewData,
} from '@torsher/api-client'
import type { Component } from 'vue'
import {
  createRenderer,
  h,
  KeepAlive,
  markRaw,
  nextTick,
  ref,
  shallowRef,
  ssrContextKey,
} from 'vue'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import MineDiary from '../components/mine/MineDiary.vue'
import MineEditor from '../components/mine/MineEditor.vue'
import MineOverview from '../components/mine/MineOverview.vue'
import MineRecommendations from '../components/mine/MineRecommendations.vue'
import { mineEditor, openMineEditor } from '../lib/mineEditor.ts'
import MinePage from './MinePage.vue'
import { titleActions } from '../titleActions.ts'

const actions = titleActions as unknown as {
  version: number
  viewer: number
  target?: object
}

const mocks = vi.hoisted(() => ({
  mine: {} as any,
  sections: {} as any,
  focus: {} as any,
  listener: (_el: any, _via: string) => {},
  select: (_key: string) => {},
  selectFromMenu: (_key: string) => {},
  putStart: vi.fn().mockResolvedValue({}),
  push: vi.fn(),
  resume: vi.fn(),
  readDiary: vi.fn(),
  readOverview: vi.fn(),
  readMonths: vi.fn(),
  readRecommendations: vi.fn(),
  patchMine: vi.fn(),
  selectGridItem: (_item: object, _event: object) => {},
  selectedKey: () => '',
}))
vi.mock('../titleActions.ts', async () => {
  const { reactive } = await import('vue')
  return {
    titleActions: reactive({ version: 0, target: undefined, viewer: 1 }),
    captureTitleViewer: () => 1,
    titleViewerId: () => 'viewer',
    isTitleViewer: (viewer: number) => viewer === 1,
    knownTitleMine: () => undefined,
    noteTitleMine: vi.fn(),
    noteTitleProgress: vi.fn(),
    rememberTitleMine: vi.fn(),
    setTitleMineWriting: vi.fn(),
  }
})
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('en_US'), t: (key: string) => key }),
}))
vi.mock('../composables/useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
vi.mock('vue-router', () => ({
  useRoute: () => ({ query: {} }),
  useRouter: () => ({ push: mocks.push, replace: vi.fn() }),
}))
vi.mock('../focus/index.ts', () => ({ useFocus: () => mocks.focus }))
vi.mock('../platform/index.ts', () => ({ platform: 'web' }))
vi.mock('../composables/useMine.ts', async () => {
  const { ref } = await import('vue')
  return {
    useMineItems: () => mocks.mine,
    useMineBootstrap: () => mocks.sections,
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
vi.mock('../api.ts', () => ({
  api: {
    mine: {
      putMineStart: mocks.putStart,
      getMineDiary: mocks.readDiary,
      getMineOverview: mocks.readOverview,
      getMineDiaryMonths: mocks.readMonths,
      getMineRecommendations: mocks.readRecommendations,
    },
    titles: { patchTitleMine: mocks.patchMine },
  },
  loadErrorOf: () => 'unavailable',
}))
vi.mock('../composables/useContinuePlayback.ts', async () => {
  const { ref } = await import('vue')
  return {
    useContinuePlayback: () => ({
      resume: mocks.resume,
      picker: { selection: ref() },
    }),
  }
})
vi.mock('../components/mine/MinePersonalSections.vue', () => ({ default: {} }))
vi.mock('../components/ContinueCard.vue', () => ({ default: {} }))
vi.mock('../components/LibraryVersionPicker.vue', () => ({ default: {} }))
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
  el.parent = null
}
const renderer = createRenderer<Node, Node>({
  createElement: node,
  createText: node,
  createComment: node,
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: el => el.parent,
  nextSibling: el =>
    el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  insert(el, parent, anchor) {
    remove(el)
    el.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0)
      parent.children.push(el)
    else parent.children.splice(index, 0, el)
  },
  remove,
})
interface Button {
  id: string
  isConnected: boolean
  dataset: {
    index: string
    section?: string
    entry?: string
    recommendation?: string
  }
  closest: () => Button
}
let current: Button | undefined
let last: Button | undefined
let cards: Button[]
let cleanup: () => void
let visible: ReturnType<typeof ref<boolean>>
let personal: Button[]
let diary: {
  page?: MineDiaryPage
  searchInput: string
  list: unknown
  openActions: (entry: MineDiaryPage['entries'][number], event: object) => void
  chooseAction: (id: string) => void
  read: (direction?: 'older' | 'newer') => Promise<boolean>
  more: (direction: 'older' | 'newer') => Promise<void>
}
let recommendations: {
  filtered: MineRecommendationItem[]
  emit: (event: 'open', card: Card, opener: Button) => void
  openActions: (entry: MineRecommendationItem) => void
  chooseAction: (id: string) => Promise<void>
}
let overview: {
  months: { id: string }[]
  dayError?: string
  dayEntries: MineDiaryPage['entries']
  remainingEntries: number
  visibleDay: string
  previewDay: (day: string) => void
  chooseMonth: (month: string) => void
  openPeriod: () => Promise<void>
  closePeriod: () => void
}
let drillDown: (filter: string, scope: object) => Promise<void>
const scroller = {
  scrollTop: 0,
  getBoundingClientRect: () => ({ top: 0, bottom: 500 }),
}
const fakeSearch = markRaw({
  id: 'title-search',
  isConnected: true,
  dataset: { index: '' },
  closest() {
    return this
  },
} as Button)

function personalButtons(
  ids: string[],
  section: string,
  attribute: 'entry' | 'recommendation',
) {
  const previous = new Map(personal.map(button => [button.id, button]))
  personal = ids.map((id) => {
    const button = previous.get(id) ?? {
      id,
      isConnected: true,
      dataset: { index: '', [attribute]: id },
      closest() {
        return this
      },
      getAttribute: () => section,
      getBoundingClientRect: () => {
        const top
          = personal.findIndex(row => row.id === id) * 100 - scroller.scrollTop
        return { top, bottom: top + 100 }
      },
    }
    previous.delete(id)
    return button
  })
  for (const button of previous.values()) button.isConnected = false
}
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
async function mount(key = 'favorites', renderPersonal = false) {
  const grid = {
    contains: (el: Button) => cards.includes(el),
    querySelectorAll: () => cards,
    querySelector: (selector: string) =>
      cards[Number(selector.match(/data-index="(\d+)"/)?.[1])],
  }
  const sectionsRoot = {
    contains: (el: Button) => el === section,
    querySelector: () => section,
  }
  const root = {
    contains: (el: Button) =>
      cards.includes(el) || personal.includes(el) || el === section,
  }
  const list = {
    contains: (el: Button) => personal.includes(el),
    querySelectorAll: () => personal,
    querySelector: () => scroller,
  }
  // Preserve the real components' setup and emitted actions in the node Vue
  // renderer. The adapters supply the DOM/focus boundary of their SSR templates.
  const Diary = {
    ...MineDiary,
    render(
      _ctx: unknown,
      _cache: unknown,
      _props: unknown,
      setup: typeof diary,
    ) {
      diary = setup
      setup.list = list
      personalButtons(
        setup.page?.entries.map(entry => entry.id) ?? [],
        'mine-diary-list',
        'entry',
      )
      return null
    },
  }
  const Recommendations = {
    ...MineRecommendations,
    render(
      _ctx: unknown,
      _cache: unknown,
      _props: unknown,
      setup: typeof recommendations,
    ) {
      recommendations = setup
      personalButtons(
        setup.filtered.map(item => item.card.id),
        'mine-recommendations-grid',
        'recommendation',
      )
      return null
    },
  }
  const Overview = {
    ...MineOverview,
    render(
      _ctx: unknown,
      _cache: unknown,
      _props: unknown,
      setup: typeof overview,
    ) {
      overview = setup
      return null
    },
  }
  const Editor = {
    ...MineEditor,
    render(
      _ctx: unknown,
      _cache: unknown,
      _props: unknown,
      setup: { searchField?: Button, step: string },
    ) {
      if (setup.step === 'search')
        setup.searchField = fakeSearch
      return null
    },
  }
  visible = ref(true)
  const page = {
    ...MinePage,
    render(_ctx: unknown, _cache: unknown, _props: unknown, setup: any) {
      setup.root = root
      setup.gridRoot = grid
      setup.sectionsRoot = sectionsRoot
      mocks.selectGridItem = setup.selectGridItem
      mocks.select = setup.select
      mocks.selectFromMenu = setup.selectFromMenu
      drillDown = setup.openDiary
      mocks.selectedKey = () => setup.selectedKey
      const ids = (setup.items as { card: Card }[]).map(item => item.card.id)
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
      if (!renderPersonal)
        return null
      return h(KeepAlive, () =>
        setup.shownKey === 'diary'
          ? h(Diary as Component, {
              today: '2026-11-19',
              timeZone: 'UTC',
              filter: setup.diaryFilter,
              scope: setup.diaryScope,
              drilldown: setup.diaryDrilldown,
              onOpen: setup.open,
            })
          : setup.shownKey === 'recommendations'
            ? h(Recommendations as Component, { onOpen: setup.open })
            : setup.shownKey === 'overview'
              ? h(Overview as Component, { today: '2026-11-19' })
              : null)
    },
  }
  const app = renderer.createApp({
    render: () => [
      h(KeepAlive, () => (visible.value ? h(page as Component) : null)),
      renderPersonal && mineEditor.value
        ? h(Editor as Component, { session: mineEditor.value })
        : null,
    ],
  })
  app.provide(ssrContextKey, {})
  app.mount(node())
  cleanup = () => app.unmount()
  await settle()
  if (key)
    mocks.select(key)
  await settle()
}
function focus(index: number) {
  mocks.focus.focusOn(cards[index])
}
function replace(ids: string[]) {
  mocks.mine.items.value = ids.map(id => ({ card: { id } }))
}
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  )
  vi.stubGlobal('window', {
    setTimeout,
    innerWidth: 1920,
    addEventListener() {},
    removeEventListener() {},
  })
  current = undefined
  last = undefined
  cards = []
  personal = []
  scroller.scrollTop = 0
  mocks.putStart.mockClear()
  mocks.push.mockClear()
  mocks.resume.mockClear()
  mocks.readDiary.mockReset()
  mocks.readOverview.mockReset()
  mocks.readMonths.mockReset()
  mocks.readRecommendations.mockReset()
  mocks.patchMine.mockReset()
  actions.version = 0
  actions.viewer = 0
  actions.target = undefined
  mocks.sections = {
    status: ref('ready'),
    bootstrap: shallowRef({
      profileId: 'viewer',
      start: { kind: 'section', section: 'continue' },
      counts: { continue: 3, favorites: 3, watchlist: 3, ratings: 3 },
      collections: [{ id: 'own', name: 'Own', count: 3 }],
    }),
    refresh: vi.fn(),
  }
  mocks.mine = {
    status: ref('ready'),
    items: shallowRef(
      ['first', 'middle', 'last'].map(id => ({ card: { id } })),
    ),
    total: ref(3),
    refreshReady: ref(true),
    more: vi.fn(),
    refresh: vi.fn(),
  }
  const listeners = new Set<typeof mocks.listener>()
  mocks.listener = (el, via) => {
    for (const listener of listeners) listener(el, via)
  }
  mocks.focus = {
    onFocus: (listener: typeof mocks.listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
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
  mineEditor.value = undefined
  cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps an explicit selection when an earlier focus selection is pending', async () => {
  vi.useFakeTimers()
  await mount('continue')
  section.dataset.section = 'continue'
  mocks.listener(section, 'nav')
  mocks.select('favorites')
  await vi.advanceTimersByTimeAsync(250)
  expect(mocks.selectedKey()).toBe('favorites')
  delete section.dataset.section
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

it('applies the saved start after bootstrap without persisting a preview', async () => {
  const bootstrap = mocks.sections.bootstrap.value
  mocks.sections.bootstrap.value = undefined
  await mount('')
  expect(mocks.selectedKey()).toBe('continue')
  mocks.sections.bootstrap.value = {
    ...bootstrap,
    start: { kind: 'collection', collectionId: 'own' },
  }
  await settle()
  expect(mocks.selectedKey()).toBe('collection:own')
  expect(mocks.putStart).not.toHaveBeenCalled()
})

it('keeps an explicit menu choice made before bootstrap arrives', async () => {
  const bootstrap = mocks.sections.bootstrap.value
  mocks.sections.bootstrap.value = undefined
  await mount('')
  mocks.selectFromMenu('favorites')
  mocks.sections.bootstrap.value = {
    ...bootstrap,
    start: { kind: 'section', section: 'overview' },
  }
  await settle()
  expect(mocks.selectedKey()).toBe('favorites')
  expect(mocks.putStart).toHaveBeenLastCalledWith({
    expectedProfileId: 'viewer',
    start: { kind: 'section', section: 'favorites' },
  })
})

it('opens a title without replaying an active cycle that has no server resume target', async () => {
  await mount('continue')
  const card = {
    id: 'series',
    kind: 'series',
    title: 'Series',
    originalTitle: 'Series',
  }
  mocks.selectGridItem(
    {
      card,
      continuation: { ...card, cycleId: 'finished-target' },
      canResume: false,
    },
    { detail: 0 },
  )
  expect(mocks.resume).not.toHaveBeenCalled()
  expect(mocks.push).toHaveBeenCalledWith('/title/series')
})

function diaryFixture() {
  const entries = Array.from(
    { length: 320 },
    (_, index): MineDiaryPage['entries'][number] => ({
      id: `event-${index}`,
      titleId: `movie-${index}`,
      season: 0,
      episode: 0,
      kind: 'movie',
      date: { precision: 'day', day: '2026-11-18' },
      calendarDay: '2026-11-18',
      origin: 'manual',
      rewatch: false,
      note: null,
      viewingContext: null,
      cycleId: null,
      metadata: null,
      createdAt: '2026-11-18T12:00:00Z',
      updatedAt: '2026-11-18T12:00:00Z',
    }),
  )
  mocks.readDiary.mockImplementation(
    async (query: {
      cursor?: string
      direction?: string
      limit: number
    }): Promise<MineDiaryPage> => {
      const boundary = Number(query.cursor?.replace('cursor-', '') ?? 0)
      const from
        = query.direction === 'newer'
          ? Math.max(0, boundary - query.limit)
          : boundary
      const to = Math.min(entries.length, from + query.limit)
      return {
        profileId: 'viewer',
        entries: entries.slice(from, to),
        months: [{ month: '2026-11', count: entries.length }],
        total: entries.length,
        distinctTitles: entries.length,
        olderCursor: to < entries.length ? `cursor-${to}` : null,
        newerCursor: from > 0 ? `cursor-${from}` : null,
      }
    },
  )
}

it('keeps a bounded bidirectional diary window and returns from a title to the deep row and its scroll offset', async () => {
  diaryFixture()
  await mount('diary', true)
  for (let page = 0; page < 3; page++) {
    await diary.read('older')
    await settle()
    expect(personal.length).toBeLessThanOrEqual(120)
  }
  scroller.scrollTop = 6000
  for (let page = 0; page < 2; page++) {
    await diary.read('older')
    await settle()
  }
  expect(personal.map(button => button.id)).toEqual(
    Array.from({ length: 120 }, (_, index) => `event-${120 + index}`),
  )
  // Load upwards after the first five fetches. The old leading row remains in
  // view when its neighbouring page is brought back, with no overlaps or gaps.
  scroller.scrollTop = 140
  await diary.read('newer')
  await settle()
  expect(personal.map(button => button.id)).toEqual(
    Array.from({ length: 120 }, (_, index) => `event-${80 + index}`),
  )
  expect(scroller.scrollTop).toBe(4140)

  const row = personal[44]!
  diary.openActions(diary.page!.entries[44]!, { currentTarget: row })
  mocks.focus.focusOn(section)
  diary.chooseAction('open')
  expect(mocks.push).toHaveBeenCalledWith('/title/movie-124')
  visible.value = false
  await settle()
  visible.value = true
  await settle()
  expect(current).toBe(row)
  expect(scroller.scrollTop).toBe(4140)
  expect(personal[0]?.id).toBe('event-80')
})

it('keeps ordinary diary search on Back and clears it for an explicit Overview drilldown', async () => {
  vi.useFakeTimers()
  diaryFixture()
  overviewFixture()
  await mount('diary', true)
  diary.searchInput = 'previous search'
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  expect(mocks.readDiary.mock.lastCall?.[0]).toMatchObject({
    search: 'previous search',
  })
  visible.value = false
  await settle()
  visible.value = true
  await settle()
  expect(diary.searchInput).toBe('previous search')
  mocks.select('overview')
  await settle()
  await drillDown('movies', { day: '2026-11-18' })
  await settle()
  await vi.advanceTimersByTimeAsync(300)
  expect(diary.searchInput).toBe('')
  expect(mocks.readDiary.mock.lastCall?.[0]).toMatchObject({
    day: '2026-11-18',
    kind: 'movie',
  })
  expect(mocks.readDiary.mock.lastCall?.[0].search).toBeUndefined()
})

function recommendationFixture() {
  const items = Array.from({ length: 8 }, (_, index) => ({
    card: { id: `rec-${index}`, kind: 'movie', title: `Candidate ${index}` },
    runtimeMinutes: null,
    reason: null,
    genres: [],
  }))
  mocks.readRecommendations.mockResolvedValue({
    profileId: 'viewer',
    items,
    genres: [],
    refresh: { state: 'ready' },
  })
}

it('restores the second recommendation row and can add an uncached candidate to the watchlist', async () => {
  recommendationFixture()
  mocks.patchMine.mockResolvedValue({ watchlist: true })
  await mount('recommendations', true)
  const card = personal[5]!
  const item = recommendations.filtered[5]!
  recommendations.emit('open', item.card, card)
  expect(mocks.push).toHaveBeenCalledWith('/title/rec-5')
  visible.value = false
  await settle()
  visible.value = true
  await settle()
  expect(current).toBe(card)
  expect(mocks.patchMine).not.toHaveBeenCalled()
  recommendations.openActions(item)
  await recommendations.chooseAction('watchlist')
  expect(mocks.patchMine).toHaveBeenCalledExactlyOnceWith(
    'rec-5',
    { watchlist: true },
    { language: 'en-US' },
  )
})

it('focuses the empty title search when logging a watch from the diary', async () => {
  diaryFixture()
  await mount('diary', true)
  openMineEditor({ kind: 'log' })
  await settle()
  expect(current).toBe(fakeSearch)
})

function overviewData(
  period: string,
  days = [
    { day: period === '2026-11' ? '2026-11-19' : `${period}-01`, count: 1 },
  ],
): OverviewData {
  return {
    profileId: 'viewer',
    today: '2026-11-19',
    period,
    timeZone: 'UTC',
    totals: {
      movies: 1,
      episodes: 0,
      series: 0,
      rewatch: 0,
      days: 1,
      runtimeMinutes: 100,
      runtimeKnown: 1,
      runtimeUnknown: 0,
      distinctMovies: 1,
      distinctEpisodes: 0,
    },
    days,
    recent: [],
    interests: {
      source: 'diary',
      genres: [],
      countries: [],
      titlesWithMetadata: 1,
      titles: 1,
    },
    previousMarks: { movies: 0, series: 0, examples: [] },
  }
}

function overviewFixture() {
  mocks.readOverview.mockImplementation(
    async ({ period }: { period: string }) => overviewData(period),
  )
}

it('keeps a reopened month picker on its latest response and cancels its request when leaving', async () => {
  diaryFixture()
  overviewFixture()
  const oldRequest = Promise.withResolvers<MineDiaryMonths>()
  const freshRequest = Promise.withResolvers<MineDiaryMonths>()
  const leaving = Promise.withResolvers<MineDiaryMonths>()
  mocks.readMonths
    .mockReturnValueOnce(oldRequest.promise)
    .mockReturnValueOnce(freshRequest.promise)
    .mockReturnValueOnce(leaving.promise)
  await mount('overview', true)
  expect(mocks.readOverview.mock.calls[0]![0].period).toBe('2026-11')
  expect(overview.visibleDay).toBe('2026-11-19')

  const old = overview.openPeriod()
  overview.closePeriod()
  expect(mocks.readMonths.mock.calls[0]![1].signal.aborted).toBe(true)
  const fresh = overview.openPeriod()
  freshRequest.resolve({ months: [{ month: '2026-10', count: 1 }] })
  await fresh
  oldRequest.resolve({ months: [{ month: '2026-09', count: 1 }] })
  await old
  expect(overview.months.map(option => option.id)).toEqual([
    '2026-11',
    '2026-10',
  ])

  const pending = overview.openPeriod()
  visible.value = false
  await settle()
  expect(mocks.readMonths.mock.calls[2]![1].signal.aborted).toBe(true)
  leaving.resolve({ months: [] })
  await pending
})

it('discards the old day preview timer when choosing another month', async () => {
  vi.useFakeTimers()
  diaryFixture()
  overviewFixture()
  await mount('overview', true)
  overview.previewDay('2026-11-18')
  overview.chooseMonth('2026-10')
  await vi.advanceTimersByTimeAsync(150)
  expect(overview.visibleDay).toBe('2026-10-01')
  expect(mocks.readDiary.mock.lastCall?.[0]).toMatchObject({
    day: '2026-10-01',
    limit: 40,
  })
})

it('selects the latest day with activity once when opening a month and preserves a manually selected empty day on refresh', async () => {
  vi.useFakeTimers()
  diaryFixture()
  overviewFixture()
  await mount('overview', true)
  mocks.readOverview.mockResolvedValueOnce(
    overviewData('2026-10', [
      { day: '2026-10-01', count: 2 },
      { day: '2026-10-13', count: 1 },
    ]),
  )
  overview.chooseMonth('2026-10')
  await settle()
  expect(overview.visibleDay).toBe('2026-10-13')
  expect(mocks.readDiary.mock.lastCall?.[0]).toMatchObject({
    day: '2026-10-13',
    limit: 40,
  })

  overview.previewDay('2026-10-08')
  await vi.advanceTimersByTimeAsync(150)
  const reads = mocks.readDiary.mock.calls.length
  mocks.readOverview.mockResolvedValueOnce(
    overviewData('2026-10', [{ day: '2026-10-14', count: 1 }]),
  )
  actions.version++
  await settle()
  expect(mocks.readOverview).toHaveBeenCalledTimes(3)
  expect(overview.visibleDay).toBe('2026-10-08')
  expect(mocks.readDiary).toHaveBeenCalledTimes(reads)
})

it('keeps the latest day of the current period when an earlier period arrives late', async () => {
  diaryFixture()
  overviewFixture()
  await mount('overview', true)
  const october = Promise.withResolvers<OverviewData>()
  mocks.readOverview.mockReturnValueOnce(october.promise)
  mocks.readOverview.mockResolvedValueOnce(
    overviewData('2026-09', [{ day: '2026-09-10', count: 1 }]),
  )
  overview.chooseMonth('2026-10')
  overview.chooseMonth('2026-09')
  await settle()
  expect(overview.visibleDay).toBe('2026-09-10')
  expect(mocks.readOverview.mock.calls[1]![1].signal.aborted).toBe(true)

  october.resolve(overviewData('2026-10', [{ day: '2026-10-13', count: 1 }]))
  await settle()
  expect(overview.visibleDay).toBe('2026-09-10')
  expect(mocks.readDiary.mock.lastCall?.[0]).toMatchObject({
    day: '2026-09-10',
  })
})

it('drops the previous day error when the selected calendar day is empty', async () => {
  vi.useFakeTimers()
  overviewFixture()
  mocks.readDiary.mockRejectedValue(new Error('failed preview'))
  await mount('overview', true)
  expect(overview.dayError).toBe('unavailable')

  overview.previewDay('2026-11-18')
  await vi.advanceTimersByTimeAsync(150)
  expect(overview.dayError).toBeUndefined()
  expect(mocks.readDiary).toHaveBeenCalledOnce()
})

it('keeps the completed day through debounce and loading, then replaces entries and remainder together', async () => {
  vi.useFakeTimers()
  diaryFixture()
  const page: MineDiaryPage = await mocks.readDiary({ limit: 2 })
  mocks.readDiary.mockReset()
  mocks.readDiary.mockResolvedValueOnce(page)
  const next = Promise.withResolvers<MineDiaryPage>()
  mocks.readDiary.mockReturnValueOnce(next.promise)
  mocks.readOverview.mockResolvedValue(
    overviewData('2026-11', [
      { day: '2026-11-19', count: 2 },
      { day: '2026-11-18', count: 10 },
    ]),
  )
  await mount('overview', true)
  const initialRemainder = overview.remainingEntries

  overview.previewDay('2026-11-18')
  await settle()
  expect(overview.dayEntries).toEqual(page.entries)
  expect(overview.remainingEntries).toBe(initialRemainder)
  await vi.advanceTimersByTimeAsync(150)
  expect(overview.dayEntries).toEqual(page.entries)
  expect(overview.remainingEntries).toBe(initialRemainder)

  const entries = page.entries.map(entry => ({
    ...entry,
    id: `next-${entry.id}`,
  }))
  next.resolve({ ...page, entries, total: 10 })
  await settle()
  expect(overview.dayEntries).toEqual(entries)
  expect(overview.remainingEntries).toBe(9)
})

it('clears the completed preview for an empty day and never restores a cancelled response', async () => {
  vi.useFakeTimers()
  diaryFixture()
  const page: MineDiaryPage = await mocks.readDiary({ limit: 2 })
  mocks.readDiary.mockReset()
  mocks.readDiary.mockResolvedValueOnce(page)
  const pending = Promise.withResolvers<MineDiaryPage>()
  mocks.readDiary.mockReturnValueOnce(pending.promise)
  mocks.readOverview.mockResolvedValue(
    overviewData('2026-11', [
      { day: '2026-11-19', count: 2 },
      { day: '2026-11-18', count: 2 },
    ]),
  )
  await mount('overview', true)
  overview.previewDay('2026-11-18')
  await vi.advanceTimersByTimeAsync(150)
  overview.previewDay('2026-11-17')
  await settle()
  expect(overview.dayEntries).toEqual([])
  expect(overview.remainingEntries).toBe(0)
  expect(mocks.readDiary.mock.lastCall?.[1].signal.aborted).toBe(true)
  pending.resolve(page)
  await settle()
  expect(overview.dayEntries).toEqual([])
})

it('replaces a retained preview with a failed-day error and clears it across viewer changes', async () => {
  vi.useFakeTimers()
  diaryFixture()
  mocks.readOverview.mockResolvedValue(
    overviewData('2026-11', [
      { day: '2026-11-19', count: 1 },
      { day: '2026-11-18', count: 1 },
    ]),
  )
  await mount('overview', true)
  expect(overview.dayEntries.length).toBeGreaterThan(0)
  actions.viewer++
  await settle()
  expect(overview.dayEntries).toEqual([])

  overview.previewDay('2026-11-18')
  await vi.advanceTimersByTimeAsync(150)
  expect(overview.dayEntries.length).toBeGreaterThan(0)
  mocks.readDiary.mockRejectedValueOnce(new Error('failed next day'))
  overview.previewDay('2026-11-19')
  await vi.advanceTimersByTimeAsync(150)
  expect(overview.dayError).toBe('unavailable')
  expect(overview.dayEntries).toEqual([])
  expect(overview.remainingEntries).toBe(0)
})
