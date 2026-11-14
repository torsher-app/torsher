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
        cacheSeconds: 120,
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
  expect(html).toContain('Player buffer: 24 s')
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
  expect(html).toContain('Буфер плеера: 7 мин')
  expect(html).toContain('Подключённые сиды: 0')
  expect(html).not.toContain('osd__pill--low')
})

it('warns only when speed is insufficient and buffer is running out', async () => {
  const html = await render({
    stats: { ...stats, downloadSpeed: 0 },
    stalled: true,
    cacheSeconds: 24,
  })
  expect(html).toContain('osd__pill--low')
  expect(html).toContain('0.0 Mbps')
  expect(html).toContain('Player buffer: 24 s')
  expect(html).toContain('Connected seeders: 3')
})

it.each([{ verifiedToEnd: true }])(
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
  expect(html).toContain('Player buffer: —')
  expect(html).toContain('Connected seeders: —')
  expect(html).not.toContain('NaN')
})

it('distinguishes player buffer from a conservative cache lower bound, including a verified tail', async () => {
  const html = await render({ bufferSeconds: 7, cacheSeconds: 420 })
  expect(html).toContain('Player buffer: 7 s')
  expect(html).toContain('Server cache: ≥ 7 min')
  const complete = await render({
    bufferSeconds: 7,
    cacheSeconds: 420,
    verifiedToEnd: true,
  })
  expect(complete).toContain('Downloaded')
  expect(complete).toContain('Player buffer: 7 s')
  expect(complete).toContain('Server cache: ≥ 7 min')
})

it('keeps missing or zero cache bounds neutral until playback actually stalls', async () => {
  for (const cacheSeconds of [null, 0]) {
    const html = await render({
      stats: { ...stats, downloadSpeed: 0 },
      cacheSeconds,
    })
    expect(html).not.toContain('osd__pill--low')
  }
  expect(await render({ cacheSeconds: null })).toContain('Server cache: —')
})

const locales = [
  {
    locale: 'en_US',
    player: 'Player buffer:',
    cache: 'Server cache:',
    speed: 'Server download:',
    speedUnit: 'Mbps',
    seeders: 'Connected seeders:',
    seconds: 's',
    minutes: 'min',
    decimal: '.',
    downloaded: 'Downloaded',
  },
  {
    locale: 'ru_RU',
    player: 'Буфер плеера:',
    cache: 'Кэш сервера:',
    speed: 'Загрузка сервером:',
    speedUnit: 'Мбит/с',
    seeders: 'Подключённые сиды:',
    seconds: 'с',
    minutes: 'мин',
    decimal: ',',
    downloaded: 'Скачано',
  },
]

it.each(locales)(
  'formats unknown and invalid cache/player measurements in $locale without a false lower-bound marker',
  async (text) => {
    for (const value of [
      undefined,
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
    ]) {
      const html = await render(
        { cacheSeconds: value, bufferSeconds: Number.NaN },
        text.locale,
      )
      expect(html).toContain(`${text.cache} —`)
      expect(html).toContain(`${text.player} —`)
      expect(html).not.toContain('≥ —')
      expect(html).not.toMatch(/NaN|Infinity/)
    }
    for (const value of [
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
    ]) {
      const html = await render({ bufferSeconds: value }, text.locale)
      expect(html).toContain(`${text.player} —`)
    }
  },
)

it.each(locales)(
  'formats zero, subsecond, minute boundaries and long buffers independently in $locale',
  async (text) => {
    for (const [value, expected] of [
      [0, `0 ${text.seconds}`],
      [0.9, `0 ${text.seconds}`],
      [59.99, `59 ${text.seconds}`],
      [60, `1 ${text.minutes}`],
      [360000, `6000 ${text.minutes}`],
    ] as const) {
      const html = await render(
        { bufferSeconds: value, cacheSeconds: value },
        text.locale,
      )
      expect(html).toContain(`${text.player} ${expected}`)
      expect(html).toContain(`${text.cache} ≥ ${expected}`)
    }
    const distinct = await render(
      { bufferSeconds: 7, cacheSeconds: 420 },
      text.locale,
    )
    expect(distinct).toContain(`${text.player} 7 ${text.seconds}`)
    expect(distinct).toContain(`${text.cache} ≥ 7 ${text.minutes}`)
  },
)

it.each(locales)(
  'formats speed decimal boundaries and connected seeder counts in $locale',
  async (text) => {
    for (const [speed, expected] of [
      [0, `0${text.decimal}0`],
      [12500, `0${text.decimal}1`],
      [1237500, `9${text.decimal}9`],
      [1250000, '10'],
      [12500000, '100'],
    ] as const) {
      const html = await render(
        {
          stats: {
            ...stats,
            downloadSpeed: speed,
            peers: { ...stats.peers, seeders: 0 },
          },
        },
        text.locale,
      )
      expect(html).toContain(`${text.speed} ${expected} ${text.speedUnit}`)
      expect(html).toContain(`${text.seeders} 0`)
    }
    for (const value of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
      1.5,
    ]) {
      const html = await render(
        {
          stats: {
            ...stats,
            downloadSpeed: Number.NaN,
            peers: { ...stats.peers, seeders: value },
          },
        },
        text.locale,
      )
      expect(html).toContain(`${text.speed} — ${text.speedUnit}`)
      expect(html).toContain(`${text.seeders} —`)
      expect(html).not.toMatch(/NaN|Infinity/)
    }
  },
)

it.each(locales)(
  'keeps full-file and verified-tail Done text with distinct Player/Cache in $locale',
  async (text) => {
    for (const [downloaded, anchorOffset] of [
      [1e9, 0],
      [1e8, 7e8],
    ]) {
      const html = await render(
        {
          verifiedToEnd: true,
          bufferSeconds: 7,
          cacheSeconds: 900,
          stats: {
            ...stats,
            file: {
              ...stats.file,
              downloaded: downloaded!,
              playbackCache: {
                sampledAtSeconds: 100,
                anchorOffset: anchorOffset!,
                contiguousEndOffset: 1e9,
                bufferedUntilSeconds: 1000,
                verifiedToEnd: true,
              },
            },
          },
        },
        text.locale,
      )
      expect(html).toContain(text.downloaded)
      expect(html).toContain(`${text.player} 7 ${text.seconds}`)
      expect(html).toContain(`${text.cache} ≥ 15 ${text.minutes}`)
      expect(html).not.toContain(text.speedUnit)
      expect(html).not.toContain(text.seeders)
    }
  },
)

it.each(locales)(
  'suppresses network warnings with either sufficient buffer in $locale',
  async (text) => {
    for (const buffers of [
      { cacheSeconds: 120, bufferSeconds: 0 },
      { cacheSeconds: 0, bufferSeconds: 60 },
    ]) {
      const html = await render(
        { stats: { ...stats, downloadSpeed: 0 }, stalled: true, ...buffers },
        text.locale,
      )
      expect(html).not.toContain('osd__pill--low')
    }
    const small = await render(
      {
        stats: { ...stats, downloadSpeed: 0 },
        stalled: true,
        cacheSeconds: 0,
        bufferSeconds: 7,
      },
      text.locale,
    )
    expect(small).toContain('osd__pill--low')
    for (const cacheSeconds of [null, 0]) {
      expect(
        await render(
          {
            stats: { ...stats, downloadSpeed: 0 },
            stalled: false,
            cacheSeconds,
            bufferSeconds: 0,
          },
          text.locale,
        ),
      ).not.toContain('osd__pill--low')
    }
    for (const downloadSpeed of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(
        await render(
          {
            stats: { ...stats, downloadSpeed },
            stalled: true,
            cacheSeconds: null,
            bufferSeconds: 0,
          },
          text.locale,
        ),
      ).not.toContain('osd__pill--low')
    }
    for (const duration of [Number.NaN, 0, Number.POSITIVE_INFINITY]) {
      expect(
        await render(
          {
            stats: { ...stats, downloadSpeed: 0 },
            stalled: true,
            duration,
            cacheSeconds: null,
            bufferSeconds: 0,
          },
          text.locale,
        ),
      ).not.toContain('osd__pill--low')
    }
  },
)
