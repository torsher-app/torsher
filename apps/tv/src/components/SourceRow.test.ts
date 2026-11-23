import type { SourceCandidate } from '@torsher/api-client'
import { messages, pluralRules } from '@torsher/i18n'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'
import { expect, it } from 'vitest'
import SourceRow from './SourceRow.vue'

const baseCandidate: SourceCandidate = {
  id: 'src-1',
  title: 'Example.Show.S01.1080p.WEB-DL',
  indexers: ['Indexer A'],
  size: 14.2 * 1024 ** 3,
  episodeSize: null,
  seeders: 48,
  peers: 49,
  quality: '1080p',
  resolution: { value: '1080p', basis: 'title', sure: true },
  source: 'WEB-DL',
  codec: 'H.264',
  hdr: [],
  audio: [],
  channels: '5.1',
  subs: [],
  voice: { studio: 'Studio A', type: 'MVO' },
  voiceKeys: ['studio:Studio A'],
  audioFit: null,
  seasons: [1],
  episodes: { from: 1, to: 8 },
  isPack: true,
  confidence: 'high',
  pickReason: null,
  publishedAt: null,
  lastWatched: false,
}

async function render(
  extra: Partial<SourceCandidate> = {},
  locale: 'en_US' | 'ru_RU' = 'en_US',
) {
  const app = createSSRApp({
    render: () =>
      h(SourceRow, {
        candidate: { ...baseCandidate, ...extra },
      }),
  })
  app.use(createI18n({ legacy: false, locale, messages, pluralRules }))
  app.directive('focusable', { getSSRProps: () => ({}) })
  return renderToString(app)
}

it.each([
  ['en_US', 0, '0 seeders', 'bad'],
  ['en_US', 1, '1 seeder', 'warn'],
  ['en_US', 9, '9 seeders', 'warn'],
  ['en_US', 48, '48 seeders', 'ok'],
  ['ru_RU', 0, '0 сидов', 'bad'],
  ['ru_RU', 1, '1 сид', 'warn'],
  ['ru_RU', 2, '2 сида', 'warn'],
  ['ru_RU', 48, '48 сидов', 'ok'],
] as const)(
  'labels seeders explicitly with tone class in %s for %d',
  async (locale, seeders, expected, tone) => {
    const html = await render({ seeders, peers: seeders + 7 }, locale)
    expect(html).toContain(expected)
    expect(html).toContain(`source__seeders--${tone}`)
    expect(html).not.toContain('M12 19.5v-14M6 11.5l6-6 6 6')
    expect(html).not.toContain('M12 4.5v14M6 12.5l6 6 6-6')
    expect(html.match(/class="[^"]*\bsource__stat(?:\s|")/g)).toHaveLength(1)
  },
)
