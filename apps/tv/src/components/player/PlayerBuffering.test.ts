import type { TorrentStats } from '@torsher/api-client'
import type { StageStep } from '../../lib/player.ts'
import { messages, pluralRules } from '@torsher/i18n'
import { createSSRApp, h } from 'vue'
import { createI18n } from 'vue-i18n'
import { renderToString } from 'vue/server-renderer'
import { expect, it } from 'vitest'
import PlayerBuffering from './PlayerBuffering.vue'

const copy = messages.en_US.player

const stats: TorrentStats = {
  activity: 'downloading',
  peers: { connected: 0, found: 40, seeders: 0 },
  downloadSpeed: 0,
  uploadSpeed: 0,
  badPieces: 0,
  file: { size: 100, downloaded: 0, bufferedAhead: 0 },
}

function render(
  step: StageStep,
  label?: string,
  measurement: TorrentStats | null = stats,
) {
  const app = createSSRApp({
    render: () =>
      h(PlayerBuffering, {
        step,
        stats: measurement ?? undefined,
        label,
        progress: 0.42,
      }),
  })
  app.use(
    createI18n({ legacy: false, locale: 'en_US', messages, pluralRules }),
  )
  return renderToString(app)
}

it('explains found peers separately from participants not yet found', async () => {
  const connecting = await render('connectingPeers')
  expect(connecting).toContain(copy.connectingPeersHint)
  expect(connecting).not.toContain(copy.waitingHint)
  const waiting = await render('waitingPeers')
  expect(waiting).toContain(copy.waitingHint)
  expect(waiting).not.toContain(copy.connectingPeersHint)
})

it('does not show stale peer counters while reconnecting', async () => {
  const html = await render('reconnecting')
  expect(html).toContain(copy.steps.reconnecting)
  expect(html).not.toContain('buffering__number')
  expect(html).not.toContain('Connected seeders')
  expect(html).not.toContain(copy.waitingHint)
})

it('preserves a custom preparation label without a peer diagnosis', async () => {
  const html = await render('connectingPeers', 'Preparing episode')
  expect(html).toContain('Preparing episode')
  expect(html).not.toContain(copy.connectingPeersHint)
})

it.each(['buffering', 'slow'] as const)(
  'shows percent, Mbps and connected seeders during %s',
  async (step) => {
    const html = await render(step, undefined, {
      ...stats,
      downloadSpeed: 5.5 * 1024 ** 2,
      peers: { connected: 9, found: 40, seeders: 3 },
    })
    const text = html.replace(/<[^>]*>/g, '')
    expect(text).toContain('42%')
    expect(text).toContain('46 Mbps')
    expect(html).toContain('Connected seeders: 3')
    expect(html).not.toContain('Connected seeders: 9')
    expect(html).not.toContain('Connected seeders: 40')
    expect(text).not.toContain('MB/s')
    expect(text).not.toContain('·')
  },
)

it('preserves known zero speed and zero seeders', async () => {
  const html = await render('buffering')
  expect(html.replace(/<[^>]*>/g, '')).toContain('0.0 Mbps')
  expect(html).toContain('Connected seeders: 0')
})

it('hides unknown seeder counts without inventing zero', async () => {
  const html = await render('buffering', undefined, {
    ...stats,
    peers: { ...stats.peers, seeders: Number.NaN },
  })
  expect(html).not.toContain('Connected seeders')
  expect(html).not.toContain('NaN')
})

it('keeps the custom preparation label free of torrent metrics', async () => {
  const html = await render('buffering', 'Preparing episode')
  expect(html).not.toContain('Mbps')
  expect(html).not.toContain('Connected seeders')
})

it('does not invent statistics before the first response', async () => {
  const html = await render('buffering', undefined, null)
  expect(html).not.toContain('Mbps')
  expect(html).not.toContain('Connected seeders')
  expect(html).not.toContain('buffering__number')
})
