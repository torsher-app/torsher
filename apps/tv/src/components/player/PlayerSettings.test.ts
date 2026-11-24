import type { PlayerSettings as PlayerSettingsData } from '@torsher/api-client'
import { renderToString } from 'vue/server-renderer'
import { createSSRApp, h } from 'vue'
import { expect, it, vi } from 'vitest'
import PlayerSettings from './PlayerSettings.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en_US' } }),
}))
vi.mock('../../focus/index.ts', () => ({ useFocus: () => ({}) }))
vi.mock('../FocusSection.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))
vi.mock('./PlayerPanel.vue', () => ({
  default: { template: '<div><slot /></div>' },
}))
vi.mock('./PanelRow.vue', () => ({
  default: {
    props: ['label'],
    setup: (props: { label: string }) => () => h('button', props.label),
  },
}))

it('offers the new subtitle style controls only when the server supports them', async () => {
  const settings: PlayerSettingsData = {
    autoNext: true,
    subtitleSize: 'm',
    subtitleBackground: 'box',
  }
  const render = (value: PlayerSettingsData) =>
    renderToString(
      createSSRApp(PlayerSettings, { speed: 1, settings: value, link: '' }),
    )
  const legacy = await render(settings)
  expect(legacy).toContain('player.settings.subtitleSize')
  expect(legacy).not.toContain('player.settings.subtitlePosition')
  expect(legacy).not.toContain('player.settings.subtitleColor')

  const current = await render({
    ...settings,
    subtitlePosition: 'default',
    subtitleColor: 'default',
  })
  expect(current).toContain('player.settings.subtitlePosition')
  expect(current).toContain('player.settings.subtitleColor')
})
