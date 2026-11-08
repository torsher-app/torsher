import type { TorrentStats } from '@torsher/api-client'
import type { StageStep } from '../../lib/player.ts'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { expect, it, vi } from 'vitest'
import PlayerBuffering from './PlayerBuffering.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }),
}))

const stats: TorrentStats = {
  activity: 'downloading',
  peers: { connected: 0, found: 40, seeders: 0 },
  downloadSpeed: 0,
  uploadSpeed: 0,
  badPieces: 0,
  file: { size: 100, downloaded: 0, bufferedAhead: 0 },
}

function render(step: StageStep, label?: string) {
  return renderToString(
    createSSRApp({
      render: () => h(PlayerBuffering, { step, stats, label }),
    }),
  )
}

it('explains found peers separately from participants not yet found', async () => {
  const connecting = await render('connectingPeers')
  expect(connecting).toContain('player.connectingPeersHint')
  expect(connecting).not.toContain('player.waitingHint')
  const waiting = await render('waitingPeers')
  expect(waiting).toContain('player.waitingHint')
  expect(waiting).not.toContain('player.connectingPeersHint')
})

it('does not show stale peer counters while reconnecting', async () => {
  const html = await render('reconnecting')
  expect(html).toContain('player.steps.reconnecting')
  expect(html).not.toContain('player.found')
  expect(html).not.toContain('player.peers')
  expect(html).not.toContain('player.waitingHint')
})

it('preserves a custom preparation label without a peer diagnosis', async () => {
  const html = await render('connectingPeers', 'Preparing episode')
  expect(html).toContain('Preparing episode')
  expect(html).not.toContain('player.connectingPeersHint')
})
