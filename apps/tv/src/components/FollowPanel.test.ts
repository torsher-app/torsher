import type { Component } from 'vue'
import type { TitleFollow, TitleFollowResponse } from '@torsher/api-client'
import type { PanelOption } from './OptionsPanel.vue'
import {
  createRenderer,
  defineComponent,
  h,
  nextTick,
  ref,
  ssrContextKey,
} from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import FollowPanel from './FollowPanel.vue'
import OptionsPanel from './OptionsPanel.vue'

const mocks = vi.hoisted(() => ({
  panel: {} as {
    options: PanelOption[]
    focusOption?: string
    subtitle?: string
  },
  select: (_id: string) => {},
  back: () => {},
  get: vi.fn(),
  activate: vi.fn(),
}))
vi.mock('../api.ts', () => ({
  api: { titles: { getFollowVoices: mocks.get } },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../composables/useTitleFollow.ts', () => ({
  useFollowTexts: () => ({
    waitLabel: String,
    statusLine: () => '',
    policyLine: () => '',
  }),
}))
vi.mock('../focus/index.ts', () => ({
  useFocus: () => ({ activate: mocks.activate }),
}))
vi.mock('./OptionsPanel.vue', () => ({
  default: defineComponent({
    props: ['options', 'title', 'subtitle', 'focusSelected', 'focusOption'],
    emits: ['select', 'close'],
    setup(props, { emit }) {
      mocks.panel = props as typeof mocks.panel
      mocks.select = id => emit('select', id)
      mocks.back = () => emit('close')
      return () => h('div')
    },
  }),
}))
interface Element {
  children: Element[]
  parent: Element | null
}
function element(): Element {
  return { children: [], parent: null }
}
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
async function settle() {
  for (let i = 0; i < 6; i++) await nextTick()
}
async function setup() {
  const save = vi.fn().mockResolvedValue(true)
  const context = ref({
    titleId: 'title-one',
    view: {
      canEdit: true,
      follow: {
        kind: 'series',
        season: 2,
        mode: 'notify',
        audioEffective: 'ru',
        audioServer: 'ru',
        voicePolicy: { mode: 'auto' },
        voiceResolution: { source: 'none', season: 2 },
        waitHours: 24,
        qualityPreset: 'best',
        profileCount: 1,
      },
    } as unknown as TitleFollowResponse,
  })
  // Run the SFC's actual setup/lifecycle against a minimal host. Its SSR-compiled
  // template is replaced only by the OptionsPanel event boundary used in the UI.
  const Panel = {
    ...FollowPanel,
    render(this: {
      $: {
        setupState: {
          options: PanelOption[]
          subtitle: string
          returnTo?: string
          select: (id: string) => void
          back: () => void
        }
      }
    }) {
      const state = this.$.setupState
      return h(OptionsPanel, {
        title: 'Studio',
        options: state.options,
        subtitle: state.subtitle,
        focusOption: state.returnTo,
        onSelect: state.select,
        onClose: state.back,
      })
    },
  }
  const app = renderer.createApp(
    defineComponent({
      setup: () => () =>
        h(Panel as unknown as Component, {
          title: 'Synthetic title',
          ...context.value,
          view: context.value.view as TitleFollowResponse & {
            follow: TitleFollow
          },
          save,
        }),
    }),
  )
  app.provide(ssrContextKey, {})
  app.mount(element())
  await settle()
  return { save, context, stop: () => app.unmount() }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('__DEMO__', false)
  vi.stubGlobal('document', { activeElement: null })
  mocks.get.mockResolvedValue({
    season: 2,
    cache: 'miss',
    updatedAt: null,
    stale: false,
    items: [],
    failed: [],
    indexerCount: 1,
  })
})
async function studios() {
  mocks.select('voice')
  await settle()
  mocks.select('only')
  await settle()
}
describe('tV studio steps', () => {
  it('omits redundant explicit provenance while keeping automatic season provenance', async () => {
    const { context, stop } = await setup()
    context.value.view.follow!.voicePolicy = {
      mode: 'only',
      studio: 'HDRezka Studio',
    }
    context.value.view.follow!.voiceResolution = {
      season: 2,
      active: true,
      source: 'explicit',
      sourceSeason: null,
      studio: 'HDRezka Studio',
    }
    mocks.select('voice')
    await settle()
    expect(mocks.panel.subtitle).not.toContain(
      'follow.studio.sources.explicit',
    )
    expect(mocks.panel.subtitle).toContain('follow.studio.trackHint')
    context.value.view.follow!.voicePolicy = { mode: 'auto' }
    context.value.view.follow!.voiceResolution!.source = 'season_pin'
    await settle()
    expect(mocks.panel.subtitle).toContain('follow.studio.sources.season_pin')
    stop()
  })
  it('provides every known studio without a keyboard and Back never saves', async () => {
    const { save, stop } = await setup()
    await studios()
    mocks.select('otherStudios')
    await settle()
    expect(
      mocks.panel.options.some(item => item.id === 'studio:HDRezka Studio'),
    ).toBe(true)
    expect(mocks.panel.options.length).toBeGreaterThan(50)
    vi.stubGlobal('document', { activeElement: { tagName: 'INPUT' } })
    mocks.back()
    await settle()
    expect(mocks.activate).toHaveBeenCalledWith('options-panel')
    expect(save).not.toHaveBeenCalled()
    vi.stubGlobal('document', { activeElement: null })
    mocks.back()
    await settle()
    expect(mocks.panel.focusOption).toBe('otherStudios')
    expect(save).not.toHaveBeenCalled()
    mocks.back()
    await settle()
    expect(mocks.panel.focusOption).toBe('only')
    expect(save).not.toHaveBeenCalled()
    stop()
  })
  it('saves an out-of-results canonical choice exactly once', async () => {
    const { save, stop } = await setup()
    await studios()
    mocks.select('otherStudios')
    await settle()
    mocks.select('studio:HDRezka Studio')
    mocks.select('studio:HDRezka Studio')
    await settle()
    expect(save).toHaveBeenCalledExactlyOnceWith({
      voicePolicy: { mode: 'only', studio: 'HDRezka Studio' },
    })
    stop()
  })
  it('keeps the previous rule and selection step after a failed save', async () => {
    const { save, context, stop } = await setup()
    save.mockResolvedValue(false)
    await studios()
    mocks.select('otherStudios')
    await settle()
    mocks.select('studio:HDRezka Studio')
    await settle()
    expect(context.value.view.follow?.voicePolicy).toEqual({ mode: 'auto' })
    expect(
      mocks.panel.options.some(item => item.id === 'studio:HDRezka Studio'),
    ).toBe(true)
    stop()
  })
})

it('merges alias evidence into one canonical row with conservative counts', async () => {
  const item = {
    types: ['MVO'],
    count: 2,
    seeders: 10,
    found: true,
    saved: false,
    inherited: false,
  }
  mocks.get.mockResolvedValue({
    season: 2,
    cache: 'hit',
    updatedAt: null,
    stale: false,
    failed: [],
    indexerCount: 1,
    items: [
      { ...item, studio: 'HDRezka' },
      {
        ...item,
        studio: 'HDRezka Studio',
        count: 4,
        found: false,
        inherited: true,
      },
    ],
  })
  const { context, stop } = await setup()
  context.value.view = {
    ...context.value.view,
    follow: {
      ...context.value.view.follow!,
      voicePolicy: { mode: 'only', studio: 'HDRezka' },
    },
  }
  await studios()
  const choices = mocks.panel.options.filter(
    item => item.id === 'studio:HDRezka Studio',
  )
  expect(choices).toHaveLength(1)
  expect(choices[0]).toMatchObject({ selected: true })
  expect(choices[0]!.hint).toContain('follow.studio.foundSeason')
  expect(choices[0]!.hint).toContain('follow.studio.inherited')
  expect(choices[0]!.hint).toContain('follow.studio.saved')
  stop()
})
