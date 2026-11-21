import type { MineDiaryEntry } from '@torsher/api-client'
import type { Component } from 'vue'
import type { KeyAction } from '../../focus/keys.ts'
import {
  createRenderer,
  createSSRApp,
  markRaw,
  nextTick,
  ref,
  ssrContextKey,
} from 'vue'
import { renderToString } from 'vue/server-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mineEditor, openMineEditor } from '../../lib/mineEditor.ts'
import { setTitleViewer } from '../../titleActions.ts'
import MineEditor from './MineEditor.vue'

const mocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  patch: vi.fn(),
  log: vi.fn(),
  onKey: vi.fn(),
  current: vi.fn(),
  focusOn: vi.fn(),
  platform: 'webos' as 'webos' | 'web',
  mode: 'remote' as 'remote' | 'pointer',
}))

vi.mock('../../api.ts', () => ({
  api: {
    mine: {
      getMineBootstrap: mocks.bootstrap,
      patchMineDiaryEntry: mocks.patch,
      postMineDiary: mocks.log,
    },
  },
  loadErrorOf: () => 'unavailable',
}))
vi.mock('../../focus/index.ts', () => ({
  SECTION_ATTRIBUTE: 'data-focus-section',
  NATIVE_WHEEL_ATTRIBUTE: 'data-native-wheel',
  useFocus: () => ({
    onKey: mocks.onKey,
    current: mocks.current,
    focusOn: mocks.focusOn,
    activate: vi.fn(),
    configure: vi.fn(),
    get mode() {
      return mocks.mode
    },
  }),
}))
vi.mock('../../composables/useCatalogLanguage.ts', () => ({
  useCatalogLanguage: () => ref('en-US'),
}))
vi.mock('../../platform/index.ts', () => ({
  get platform() {
    return mocks.platform
  },
}))
vi.mock('../ScreenState.vue', () => ({ default: {} }))
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: ref('en_US'), t: (key: string) => key }),
}))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn() }) }))

interface Node {
  children: Node[]
  parent?: Node
}
const node = (): Node => ({ children: [] })
const renderer = createRenderer<Node, Node>({
  createElement: node,
  createText: node,
  createComment: node,
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: el => el.parent ?? null,
  nextSibling: () => null,
  insert(el, parent) {
    el.parent = parent
    parent.children.push(el)
  },
  remove(el) {
    if (el.parent)
      el.parent.children = el.parent.children.filter(child => child !== el)
  },
})

let focusedButton: object | undefined
function button(dataset: Record<string, string> = {}) {
  return markRaw({
    dataset,
    isConnected: true,
    scrollIntoView: vi.fn(),
    matches(selector: string): boolean {
      return selector === ':focus' && focusedButton === this
    },
    closest(this: { dataset: Record<string, string> }, selector: string) {
      return selector === '[data-date-part]' && !this.dataset.datePart
        ? null
        : this
    },
  })
}
const day = button({ datePart: 'day' })
const month = button({ datePart: 'month' })
const year = button({ datePart: 'year' })
const today = button({ dateQuick: '' })
const yesterday = button({ dateQuick: '' })
const undated = button({ dateQuick: '' })
const rewatch = button()
const save = button()
const cancel = button()
const noteField = Object.assign(button(), {
  scrollTop: 0,
  clientHeight: 200,
  scrollHeight: 200,
})

let activeButton: ReturnType<typeof button> | undefined
let handleKey: (
  action: KeyAction,
  event?: Pick<KeyboardEvent, 'target'>,
) => boolean
let controls: {
  dateControls: object
  dateSave: object
  dateCancel: object
  dateNote?: object
  day: string
  date: MineDiaryEntry['date']
  rewatch: boolean
  saving: boolean
  note: string
  keepDateTextKeys: (
    event: Pick<KeyboardEvent, 'key' | 'stopPropagation'>
      & Partial<
        Pick<KeyboardEvent, 'keyCode' | 'preventDefault' | 'isComposing'>
      >,
  ) => void
  focusDateRow: (event: {
    currentTarget: ReturnType<typeof button>
    detail: number
  }) => void
  onDateWheel: (
    part: 'day' | 'month' | 'year',
    event: Pick<WheelEvent, 'deltaY' | 'preventDefault'>,
  ) => void
  setDay: (value: string) => void
  setUnknownDate: () => void
  toggleRewatch: () => void
  save: () => Promise<void>
  back: () => void
}
let unmount: (() => void) | undefined

const entry: MineDiaryEntry = {
  id: 'entry-a',
  titleId: 'movie-a',
  season: 0,
  episode: 0,
  kind: 'movie',
  date: { precision: 'day', day: '2024-01-31' },
  calendarDay: '2024-01-31',
  origin: 'manual',
  rewatch: false,
  cycleId: null,
  metadata: null,
  note: null,
  viewingContext: null,
  createdAt: '2024-01-31T12:00:00Z',
  updatedAt: '2024-01-31T12:00:00Z',
}

async function mountEditor(log = false, editNote = false) {
  if (log) {
    openMineEditor({
      kind: 'log',
      title: { id: entry.titleId, title: 'Movie', kind: 'movie' },
    })
  }
  else {
    openMineEditor({ kind: editNote ? 'diaryNote' : 'diaryDate', entry })
  }
  const rows = new Map([
    ['[data-date-part="day"]', day],
    ['[data-date-part="month"]', month],
    ['[data-date-part="year"]', year],
    ['[data-date-quick]', today],
    ...(log ? [['[data-date-rewatch]', rewatch] as const] : []),
  ])
  const panel = {
    querySelector: (selector: string) => rows.get(selector) ?? null,
    contains: (element: ReturnType<typeof button>) =>
      [...rows.values(), yesterday, undated].includes(element),
  }
  // Keep the SFC setup, lifecycle, and keyboard handler; supply the modal's
  // DOM refs in the node renderer used for TV unit tests.
  const Editor = {
    ...MineEditor,
    render(
      _ctx: unknown,
      _cache: unknown,
      _props: unknown,
      setup: typeof controls,
    ) {
      controls = setup
      setup.dateControls = panel
      setup.dateSave = save
      setup.dateCancel = cancel
      if (log || editNote) {
        setup.dateNote = noteField
      }
      return null
    },
  }
  const app = renderer.createApp(Editor as Component, {
    session: mineEditor.value,
  })
  app.provide(ssrContextKey, {})
  app.mount(node())
  handleKey = mocks.onKey.mock.calls[0]![0]
  unmount = () => app.unmount()
  for (let tick = 0; tick < 6; tick++) await nextTick()
}

function move(
  direction: Extract<KeyAction, { type: 'move' }>['direction'],
  target: ReturnType<typeof button>,
) {
  expect(handleKey({ type: 'move', direction })).toBe(true)
  expect(activeButton).toBe(target)
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.platform = 'webos'
  mocks.mode = 'remote'
  activeButton = undefined
  focusedButton = undefined
  noteField.scrollTop = 0
  noteField.scrollHeight = noteField.clientHeight
  setTitleViewer('viewer-a')
  mocks.bootstrap.mockResolvedValue({
    profileId: 'viewer-a',
    today: '2025-02-28',
    timeZone: 'UTC',
  })
  mocks.onKey.mockReturnValue(() => {})
  mocks.current.mockImplementation(() => activeButton)
  mocks.focusOn.mockImplementation(
    (element: ReturnType<typeof button>, via = 'nav') => {
      activeButton = element
      focusedButton
        = mocks.mode === 'pointer' && via === 'nav' ? undefined : element
      return true
    },
  )
})

afterEach(() => {
  unmount?.()
  unmount = undefined
  setTitleViewer(undefined)
})

it('moves between quick dates, rows and footer without changing the date', async () => {
  await mountEditor()
  expect(activeButton).toBe(day)
  move('up', today)
  mocks.focusOn(yesterday)
  move('down', day)
  move('down', month)
  move('down', year)
  move('down', save)
  move('right', cancel)
  move('up', year)
  move('up', month)
  move('up', day)
  expect(controls.day).toBe('2024-01-31')
  expect(mocks.patch).not.toHaveBeenCalled()
})

it('changes the focused value without saving, clamps leap days and prevents future dates', async () => {
  await mountEditor()
  move('left', day)
  expect(controls.day).toBe('2024-01-30')
  move('right', day)
  move('down', month)
  move('right', month)
  expect(controls.day).toBe('2024-02-29')
  move('down', year)
  move('right', year)
  expect(controls.day).toBe('2025-02-28')
  move('up', month)
  move('up', day)
  move('right', day)
  expect(controls.day).toBe('2025-02-28')
  expect(mocks.patch).not.toHaveBeenCalled()
})

it('focuses a date row on OK or click and writes only once on Save', async () => {
  await mountEditor()
  expect(handleKey({ type: 'enter' })).toBe(false)
  controls.focusDateRow({ currentTarget: day, detail: 0 })
  controls.focusDateRow({ currentTarget: month, detail: 1 })
  expect(activeButton).toBe(month)
  expect(mocks.patch).not.toHaveBeenCalled()
  move('right', month)
  move('down', year)
  move('down', save)
  const write = Promise.withResolvers<void>()
  mocks.patch.mockReturnValueOnce(write.promise)
  const saved = controls.save()
  await controls.save()
  expect(mocks.patch).toHaveBeenCalledExactlyOnceWith('entry-a', {
    expectedProfileId: 'viewer-a',
    language: 'en-US',
    date: { precision: 'day', day: '2024-02-29' },
  })
  write.resolve()
  await saved
  expect(mineEditor.value).toBeUndefined()
})

it.each(['Cancel', 'Back'])(
  'closes on %s without writing the changed date',
  async (action) => {
    await mountEditor()
    move('left', day)
    if (action === 'Cancel') {
      move('down', month)
      move('down', year)
      move('down', save)
      move('right', cancel)
    }
    else {
      expect(handleKey({ type: 'back' })).toBe(false)
    }
    controls.back()
    expect(mocks.patch).not.toHaveBeenCalled()
    expect(mineEditor.value).toBeUndefined()
  },
)

it('keeps rewatch and Note on the remote path between Year and the footer', async () => {
  mocks.log.mockResolvedValue({ entry: null })
  await mountEditor(true)
  move('down', month)
  move('down', year)
  move('down', rewatch)
  controls.toggleRewatch()
  move('down', noteField)
  move('down', save)
  move('right', cancel)
  move('up', noteField)
  move('up', rewatch)
  move('up', year)
  move('down', rewatch)
  move('down', noteField)
  move('down', save)
  await controls.save()
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      date: { precision: 'day', day: '2025-02-28' },
      rewatch: true,
    }),
  )
})

it.each(['webos', 'web'] as const)(
  'edits and saves a diary note on %s using the shared field',
  async (platform) => {
    mocks.platform = platform
    await mountEditor(false, true)
    const app = createSSRApp(
      { ...MineEditor, setup: () => controls } as Component,
      { session: mineEditor.value },
    )
    app.directive('focusable', { getSSRProps: () => ({}) })
    const html = await renderToString(app)
    expect(html.match(/<textarea/g)).toHaveLength(1)
    expect(html).toContain('panel.common.save')
    expect(html).toContain('panel.common.cancel')
    expect(html.match(/class="action(?: action--primary)?"/g)).toHaveLength(2)
    expect(html.match(/<button[^>]+tabindex="0"/g) ?? []).toHaveLength(
      platform === 'web' ? 2 : 0,
    )
    expect(html).not.toContain('mine-editor__read')
    expect(activeButton).toBe(noteField)

    controls.note = 'A note entered with the device keyboard'
    const stopPropagation = vi.fn()
    controls.keepDateTextKeys({ key: 'ArrowDown', stopPropagation })
    expect(stopPropagation).toHaveBeenCalledTimes(platform === 'web' ? 1 : 0)
    move('down', save)
    move('right', cancel)
    move('up', noteField)
    move('down', save)
    expect(mocks.patch).not.toHaveBeenCalled()
    await controls.save()
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith('entry-a', {
      expectedProfileId: 'viewer-a',
      language: 'en-US',
      note: 'A note entered with the device keyboard',
    })
  },
)

it('cancels a changed TV note without saving', async () => {
  await mountEditor(false, true)
  controls.note = 'Unsaved note'
  move('down', save)
  move('right', cancel)
  controls.back()
  expect(mocks.patch).not.toHaveBeenCalled()
  expect(mineEditor.value).toBeUndefined()
})

it('uses the text field receiving the key when pointer focus remembers an action', async () => {
  await mountEditor(false, true)
  mocks.mode = 'pointer'
  mocks.focusOn(cancel)
  expect(
    handleKey(
      { type: 'move', direction: 'down' },
      { target: noteField as unknown as EventTarget },
    ),
  ).toBe(true)
  expect(activeButton).toBe(save)
  expect(focusedButton).toBe(save)
  expect(mocks.focusOn).toHaveBeenLastCalledWith(save, 'pointer')
})

it('scrolls a long TV note in both directions and reaches Save only after its bottom edge', async () => {
  await mountEditor(false, true)
  noteField.scrollHeight = 550
  const event = {
    key: 'ArrowDown',
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
  }
  for (const top of [100, 200, 300, 350]) {
    controls.keepDateTextKeys(event)
    expect(noteField.scrollTop).toBe(top)
    expect(activeButton).toBe(noteField)
  }
  expect(event.preventDefault).toHaveBeenCalledTimes(4)
  expect(event.stopPropagation).toHaveBeenCalledTimes(4)
  controls.keepDateTextKeys(event)
  expect(event.stopPropagation).toHaveBeenCalledTimes(4)
  move('down', save)
  move('up', noteField)
  expect(noteField.scrollTop).toBe(350)

  event.key = 'ArrowUp'
  for (const top of [250, 150, 50, 0]) {
    controls.keepDateTextKeys(event)
    expect(noteField.scrollTop).toBe(top)
    expect(activeButton).toBe(noteField)
  }
  controls.keepDateTextKeys(event)
  expect(event.preventDefault).toHaveBeenCalledTimes(8)
  expect(mocks.patch).not.toHaveBeenCalled()
})

it('supports TV arrow key codes and leaves browser/IME text navigation native', async () => {
  await mountEditor(false, true)
  noteField.scrollHeight = 550
  const event = {
    key: 'Unidentified',
    keyCode: 40,
    stopPropagation: vi.fn(),
    preventDefault: vi.fn(),
    isComposing: false,
  }
  controls.keepDateTextKeys(event)
  expect(noteField.scrollTop).toBe(100)
  event.isComposing = true
  controls.keepDateTextKeys(event)
  expect(noteField.scrollTop).toBe(100)
  expect(event.preventDefault).toHaveBeenCalledOnce()
  expect(event.stopPropagation).toHaveBeenCalledTimes(2)

  unmount?.()
  mocks.platform = 'web'
  noteField.scrollTop = 0
  await mountEditor(false, true)
  controls.keepDateTextKeys({ ...event, isComposing: false })
  expect(noteField.scrollTop).toBe(0)
  expect(event.preventDefault).toHaveBeenCalledOnce()
})

it('holds the submitted date and rewatch flag until the pending save finishes', async () => {
  const write = Promise.withResolvers<void>()
  mocks.log
    .mockReturnValueOnce(write.promise)
    .mockResolvedValueOnce({ entry: null })
  await mountEditor(true)
  controls.setDay('2024-01-31')
  controls.toggleRewatch()
  const saved = controls.save()
  expect(controls.saving).toBe(true)

  // Today and Yesterday both use setDay.
  controls.setDay('2025-02-28')
  controls.setDay('2025-02-27')
  controls.setUnknownDate()
  controls.toggleRewatch()
  await controls.save()
  const originalDate = { precision: 'day', day: '2024-01-31' }
  expect(controls.day).toBe('2024-01-31')
  expect(controls.date).toEqual(originalDate)
  expect(controls.rewatch).toBe(true)
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      date: originalDate,
      rewatch: true,
    }),
  )

  write.reject(new Error('unavailable'))
  await saved
  expect(controls.saving).toBe(false)
  expect(controls.date).toEqual(originalDate)
  controls.setUnknownDate()
  controls.toggleRewatch()
  await controls.save()
  expect(mocks.log).toHaveBeenNthCalledWith(
    2,
    expect.objectContaining({
      date: { precision: 'unknown' },
      rewatch: false,
    }),
  )
})

it('renders the same three selectors in the browser and keeps the single Note field on the keyboard path', async () => {
  mocks.platform = 'web'
  mocks.log.mockResolvedValue({ entry: null })
  await mountEditor(true)
  // Render the real template using the mounted editor's loaded setup state.
  const app = createSSRApp(
    { ...MineEditor, setup: () => controls } as Component,
    { session: mineEditor.value },
  )
  app.directive('focusable', { getSSRProps: () => ({}) })
  const html = await renderToString(app)
  expect(html.match(/data-date-part="[^"]+"/g)).toEqual([
    'data-date-part="day"',
    'data-date-part="month"',
    'data-date-part="year"',
  ])
  expect(html).not.toContain('type="date"')
  expect(html.match(/<textarea[^>]+tabindex="0"/g)).toHaveLength(1)
  expect(html).not.toContain('mine.personal.viewingContext')

  expect(activeButton).toBe(day)
  mocks.mode = 'pointer'
  controls.focusDateRow({ currentTarget: month, detail: 1 })
  expect(activeButton).toBe(month)
  move('left', month)
  expect(controls.day).toBe('2025-01-28')
  move('down', year)
  expect(mocks.focusOn).toHaveBeenLastCalledWith(year, 'pointer')
  expect(year.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest' })
  move('down', rewatch)
  move('down', noteField)
  const stopPropagation = vi.fn()
  controls.keepDateTextKeys({ key: 'ArrowDown', stopPropagation })
  expect(stopPropagation).toHaveBeenCalledOnce()
  controls.keepDateTextKeys({ key: 'Tab', stopPropagation })
  expect(stopPropagation).toHaveBeenCalledOnce()
  controls.note = 'A favourite scene'
  mocks.focusOn(save)
  move('up', noteField)
  expect(mocks.log).not.toHaveBeenCalled()

  mocks.focusOn(save)
  await controls.save()
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      date: { precision: 'day', day: '2025-01-28' },
      note: 'A favourite scene',
    }),
  )
  expect(mocks.log.mock.calls[0]![0]).not.toHaveProperty('viewingContext')
})

function wheelEvent(deltaY: number) {
  return Object.assign(new Event('wheel', { cancelable: true }), {
    deltaY,
    deltaX: deltaY === 0 ? 20 : 0,
  })
}

it('lets browser gestures scroll over the date selector without changing its value', async () => {
  mocks.platform = 'web'
  await mountEditor()
  for (const deltaY of [24, -24, 0]) {
    const event = wheelEvent(deltaY)
    controls.onDateWheel('day', event)
    expect(event.defaultPrevented).toBe(false)
  }
  expect(controls.day).toBe('2024-01-31')
  expect(mocks.patch).not.toHaveBeenCalled()
})

it('changes the TV date only on a vertical wheel gesture', async () => {
  await mountEditor()
  const horizontal = wheelEvent(0)
  controls.onDateWheel('day', horizontal)
  expect(horizontal.defaultPrevented).toBe(false)
  expect(controls.day).toBe('2024-01-31')
  const vertical = wheelEvent(24)
  controls.onDateWheel('day', vertical)
  expect(vertical.defaultPrevented).toBe(true)
  expect(controls.day).toBe('2024-01-30')
  expect(mocks.patch).not.toHaveBeenCalled()
})

it('keeps the focused browser row focused on Enter after pointer input', async () => {
  mocks.platform = 'web'
  await mountEditor()
  mocks.mode = 'pointer'
  controls.focusDateRow({ currentTarget: month, detail: 1 })
  expect(focusedButton).toBe(month)
  mocks.focusOn.mockClear()

  expect(handleKey({ type: 'enter' })).toBe(false)
  controls.focusDateRow({ currentTarget: month, detail: 0 })
  expect(mocks.focusOn).not.toHaveBeenCalled()
  expect(focusedButton).toBe(month)
  expect(controls.day).toBe('2024-01-31')
  expect(mocks.patch).not.toHaveBeenCalled()
})
