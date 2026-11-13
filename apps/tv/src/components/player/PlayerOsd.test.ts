import type { TorrentStats } from '@torsher/api-client'
import { messages, pluralRules } from '@torsher/i18n'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createI18n } from 'vue-i18n'
import { expect, it, vi } from 'vitest'
import PlayerOsd from './PlayerOsd.vue'

vi.mock('../../focus/index.ts', () => ({
  SECTION_ATTRIBUTE: 'data-focus-section',
  useFocus: () => ({ configure() {} }),
}))

vi.mock('../../composables/useRowFit.ts', async original => ({
  ...(await original<typeof import('../../composables/useRowFit.ts')>()),
  useRowFit() {},
}))

const stats: TorrentStats = {
  activity: 'downloading',
  peers: { connected: 9, found: 40, seeders: 3 },
  downloadSpeed: 5.5 * 1024 ** 2,
  uploadSpeed: 0,
  badPieces: 0,
  file: { size: 1e9, downloaded: 1e8, bufferedAhead: 1e7 },
}

async function render(
  changes: Partial<InstanceType<typeof PlayerOsd>['$props']> = {},
  locale = 'en_US',
) {
  const app = createSSRApp({
    render: () =>
      h(PlayerOsd, {
        visible: true,
        title: 'Sample video',
        subtitle: '',
        position: 100,
        duration: 1000,
        bufferEnd: 124,
        scrubTarget: null,
        paused: false,
        stats,
        bufferSeconds: 24,
        now: new Date('2026-11-13T12:00:00Z'),
        audioLabel: null,
        subtitlesLabel: null,
        fromStart: false,
        titled: false,
        series: false,
        sourceLabel: '',
        hasNext: false,
        ...changes,
      }),
  })
  app.use(createI18n({ legacy: false, locale, messages, pluralRules }))
  app.directive('focusable', { getSSRProps: () => ({}) })
  return renderToString(app)
}

it('shows Mbps, buffer and connected seeders together with accessible names', async () => {
  const html = await render()
  expect(html).toContain('Server download: 46 Mbps')
  expect(html).toContain('Buffered: 24 s')
  expect(html).toContain('Connected seeders: 3')
  expect(html).not.toContain('Connected seeders: 9')
  expect(html).not.toContain('Connected seeders: 40')
  expect(html).not.toContain('MB/s')
})

it('keeps zero speed and zero seeders neutral with a full buffer', async () => {
  const html = await render(
    {
      stats: {
        ...stats,
        downloadSpeed: 0,
        peers: { connected: 0, found: 40, seeders: 0 },
      },
      bufferSeconds: 420,
    },
    'ru_RU',
  )
  expect(html).toContain('Загрузка сервером: 0,0 Мбит/с')
  expect(html).toContain('Запас видео: 7 мин')
  expect(html).toContain('Подключённые сиды: 0')
  expect(html).not.toContain('osd__pill--low')
})

it('warns only when speed is insufficient and buffer is running out', async () => {
  const html = await render({ stats: { ...stats, downloadSpeed: 0 } })
  expect(html).toContain('osd__pill--low')
  expect(html).toContain('0.0 Mbps')
  expect(html).toContain('Buffered: 24 s')
  expect(html).toContain('Connected seeders: 3')
})

it.each([
  { stats: { ...stats, file: { ...stats.file, downloaded: stats.file.size } } },
  { bufferSeconds: 900 },
])(
  'shows Downloaded when the file or remaining video is available',
  async (changes) => {
    const html = await render(changes)
    expect(html).toContain('Downloaded')
    expect(html).not.toContain('Mbps')
    expect(html).not.toContain('Connected seeders')
  },
)

it('hides torrent metrics without stats, including library playback', async () => {
  const html = await render({ stats: undefined })
  expect(html).not.toContain('osd__pill')
  expect(html).not.toContain('Downloaded')
})

it('does not turn unknown measurements into zero', async () => {
  const html = await render({
    stats: {
      ...stats,
      downloadSpeed: Number.NaN,
      peers: { ...stats.peers, seeders: Number.NaN },
    },
    bufferSeconds: Number.NaN,
  })
  expect(html).toContain('Server download: — Mbps')
  expect(html).toContain('Buffered: —')
  expect(html).toContain('Connected seeders: —')
  expect(html).not.toContain('NaN')
})
