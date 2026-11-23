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
        speed: 1,
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

it('shows Mbps, buffer and the labeled count of connected peers', async () => {
  const html = await render()
  expect(html).toContain('Server download: 46 Mbps')
  expect(html).toContain('Buffered: 24 s')
  expect(html).toContain('9 peers')
  expect(html).not.toMatch(/3 peers|40 peers|seeders/)
  expect(html).not.toContain('MB/s')
})

it.each([
  ['en_US', 1, '1 peer'],
  ['en_US', 2, '2 peers'],
  ['ru_RU', 1, '1 пир'],
  ['ru_RU', 2, '2 пира'],
] as const)(
  'pluralizes connected peers in %s for %d',
  async (locale, connected, expected) => {
    const html = await render(
      { stats: { ...stats, peers: { ...stats.peers, connected } } },
      locale,
    )
    expect(html).toContain(expected)
  },
)

it('keeps zero speed and zero connected peers neutral with a full buffer', async () => {
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
  expect(html).toContain('0 пиров')
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
  expect(html).toContain('Buffered: 24 s')
  expect(html).toContain('9 peers')
})

it.each([{ verifiedToEnd: true }])(
  'shows Downloaded when the file or remaining video is available',
  async (changes) => {
    const html = await render(changes)
    expect(html).toContain('Downloaded')
    expect(html).not.toContain('Mbps')
    expect(html).not.toContain('9 peers')
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
      peers: { ...stats.peers, connected: Number.NaN },
    },
    bufferSeconds: Number.NaN,
  })
  expect(html).toContain('Server download: — Mbps')
  expect(html).toContain('Buffered: —')
  expect(html).not.toMatch(/\d+ peers?\b/)
  expect(html).not.toContain('NaN')
})

it('shows one timer buffer without player or cache labels or combining their values', async () => {
  const html = await render({ bufferSeconds: 7, cacheSeconds: 420 })
  expect(html).toContain('Buffered: 7 s')
  expect(html.match(/aria-label="Buffered:/g)).toHaveLength(1)
  expect(html).toContain('M12 10v4M9.5 2.5h5M12 2.5V6M17.5 7.5l2-2')
  expect(html).not.toContain('Player')
  expect(html).not.toContain('Cache')
  expect(html).not.toContain('Server cache')
  expect(html).not.toContain('≥')
  expect(html).not.toContain('7 min')
  expect(html.indexOf('Server download:')).toBeLessThan(
    html.indexOf('Buffered:'),
  )
  expect(html.indexOf('Buffered:')).toBeLessThan(html.indexOf('9 peers'))
})

it('keeps missing or zero cache bounds neutral until playback actually stalls', async () => {
  for (const cacheSeconds of [null, 0]) {
    const html = await render({
      stats: { ...stats, downloadSpeed: 0 },
      cacheSeconds,
    })
    expect(html).not.toContain('osd__pill--low')
  }
})

const locales = [
  {
    locale: 'en_US',
    buffer: 'Buffered:',
    speed: 'Server download:',
    speedUnit: 'Mbps',
    peers: 'peers',
    seconds: 's',
    minutes: 'min',
    decimal: '.',
    downloaded: 'Downloaded',
  },
  {
    locale: 'ru_RU',
    buffer: 'Запас видео:',
    speed: 'Загрузка сервером:',
    speedUnit: 'Мбит/с',
    peers: 'пиров',
    seconds: 'с',
    minutes: 'мин',
    decimal: ',',
    downloaded: 'Скачано',
  },
]

it.each(locales)(
  'formats unknown and invalid player measurements in $locale',
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
      expect(html).toContain(`${text.buffer} —`)
      expect(html).not.toContain('≥ —')
      expect(html).not.toMatch(/NaN|Infinity/)
    }
    for (const value of [
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
      -1,
    ]) {
      const html = await render({ bufferSeconds: value }, text.locale)
      expect(html).toContain(`${text.buffer} —`)
    }
  },
)

it.each(locales)(
  'formats zero, subsecond, minute boundaries and long buffers in $locale',
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
      expect(html).toContain(`${text.buffer} ${expected}`)
    }
    const distinct = await render(
      { bufferSeconds: 7, cacheSeconds: 420 },
      text.locale,
    )
    expect(distinct).toContain(`${text.buffer} 7 ${text.seconds}`)
    expect(distinct).not.toContain(`7 ${text.minutes}`)
  },
)

it.each(locales)(
  'formats speed decimal boundaries and connected peer counts in $locale',
  async (text) => {
    for (const [speed, expected] of [
      [0, `0${text.decimal}0`],
      [1, `&lt;0${text.decimal}1`],
      [6249, `&lt;0${text.decimal}1`],
      [6250, `0${text.decimal}1`],
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
            peers: { ...stats.peers, connected: 0, seeders: 0 },
          },
        },
        text.locale,
      )
      expect(html).toContain(`${text.speed} ${expected} ${text.speedUnit}`)
      expect(html).toContain(`0 ${text.peers}`)
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
            peers: { ...stats.peers, connected: value },
          },
        },
        text.locale,
      )
      expect(html).toContain(`${text.speed} — ${text.speedUnit}`)
      expect(html).not.toContain(text.peers)
      expect(html).not.toMatch(/NaN|Infinity/)
    }
  },
)

it.each(locales)(
  'shows only Done for full files and verified tails in $locale',
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
      expect(html).not.toContain(text.buffer)
      expect(html).not.toContain(text.speedUnit)
      expect(html).not.toContain(text.peers)
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

it.each(['en_US', 'ru_RU'])(
  'shows honest cached playback 0 Mbps, six connected peers and 29 seconds in %s',
  async (locale) => {
    const html = await render(
      {
        stats: {
          ...stats,
          downloadSpeed: 0,
          peers: { connected: 6, found: 40, seeders: 0 },
        },
        bufferSeconds: 29,
        cacheSeconds: null,
      },
      locale,
    )
    expect(html.replace(/<[^>]*>/g, '')).not.toMatch(/Torrent|Торрент/)
    expect(html).toContain(
      locale === 'en_US'
        ? 'Server download: 0.0 Mbps'
        : 'Загрузка сервером: 0,0 Мбит/с',
    )
    expect(html).toContain(
      locale === 'en_US' ? 'Buffered: 29 s' : 'Запас видео: 29 с',
    )
    expect(html).toContain(locale === 'en_US' ? '6 peers' : '6 пиров')
    expect(html).not.toContain('osd__pill--low')
  },
)

it('does not claim a zero signal when speed or average bitrate is unknown', async () => {
  for (const changes of [
    {
      stats: {
        ...stats,
        downloadSpeed: 0,
        downloadSpeedMeasured: false,
        peers: { ...stats.peers, seedersKnown: false },
      },
    },
    { duration: Number.NaN },
  ]) {
    const html = await render(changes)
    const signal = html.match(
      /<span[^>]*class="[^"]*\bsignal\b[^"]*"[^>]*>/,
    )?.[0]
    expect(signal).toBeDefined()
    expect(signal).toContain('aria-hidden="true"')
    expect(signal).not.toContain('aria-label=')
    expect(signal).not.toContain('role=')
  }
  const cold = await render({
    stats: {
      ...stats,
      downloadSpeed: 0,
      downloadSpeedMeasured: false,
      peers: { ...stats.peers, seedersKnown: false },
    },
  })
  expect(cold).toContain('Server download: — Mbps')
  expect(cold).toContain('9 peers')
  expect(await render({ stats: { ...stats, downloadSpeed: 0 } })).toContain(
    'Network: 0 of 4',
  )
  const idle = await render({ stats: { ...stats, activity: 'idle' } })
  expect(idle).not.toContain('osd__pill')
})

it.each(['en_US', 'ru_RU'])(
  'adjusts ETA without changing media remaining in %s',
  async (locale) => {
    const now = new Date(2026, 10, 17, 18, 0, 0)
    const normal = await render({ now, speed: 1 }, locale)
    const fast = await render({ now, speed: 1.5 }, locale)
    const slow = await render({ now, speed: 0.5 }, locale)
    const scrub = await render({ now, speed: 1.5, scrubTarget: 550 }, locale)
    for (const html of [normal, fast, slow]) expect(html).toContain('−15:00')
    const clock = (minutes: number) =>
      new Intl.DateTimeFormat(locale.replace('_', '-'), {
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(2026, 10, 17, 18, minutes, 0))
    expect(normal).toContain(clock(15))
    expect(fast).toContain(clock(10))
    expect(slow).toContain(clock(30))
    expect(scrub).toContain(clock(5))
    expect(scrub).toContain('−7:30')
  },
)
