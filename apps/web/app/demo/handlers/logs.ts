import type {
  LogEntry,
  LogLevelBodyInput,
  LogLevelResponse,
  LogsResponse,
} from '@torsher/api-client'
import { releaseName, titleNamed } from '../fixtures/titles'
import { get, put, unavailable } from '../router'
import { DEMO_VERSION, elapsedSeconds, HOUR, isFresh, MB } from '../state'

type Level = LogEntry['level']
type Draft = Omit<LogEntry, 'id' | 'seq' | 'time'>

const LEVELS: Level[] = ['debug', 'info', 'warn', 'error']
const DEFAULT_LIMIT = 200
// Журнал за последние часы: несколько сотен строк
const HISTORY_SECONDS = 8 * HOUR
const HISTORY_LINES = 420

let level: Level = 'info'

// Детерминированный шум: тот же журнал при каждом открытии демо
let seed = 20261026

function random() {
  seed = (seed + 0x6D2B79F5) | 0
  let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)

  value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value

  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(random() * list.length)]!
}

function between(min: number, max: number) {
  return Math.round(min + random() * (max - min))
}

const RELEASES = [
  releaseName(titleNamed('Glasswing'), { season: 2, episode: 6 }),
  releaseName(titleNamed('Kites over Mareth'), { season: 1, episode: 8 }),
  releaseName(titleNamed('Ninefold Harbor'), { season: 3 }),
  releaseName(titleNamed('Lanterns of Vell'), {
    quality: '2160p.WEB-DL.H.265',
  }),
  releaseName(titleNamed('Paper Comets')),
]
const INDEXERS = ['Demo indexer', 'Public indexer', 'Anime indexer']
const DEVICES = ['Living room TV', 'Bedroom TV', 'Kitchen tablet']
const PATHS = [
  '/api/overview',
  '/api/torrents',
  '/api/home',
  '/api/catalog/search',
  '/api/notifications/unread',
]

/** Обычная жизнь сервера: что он пишет в журнал, пока им пользуются */
const ROUTINE: (() => Draft)[] = [
  () => ({
    level: 'info',
    source: 'sources',
    message: 'Search finished',
    context: { indexers: 3, results: between(4, 60), ms: between(400, 2600) },
  }),
  () => ({
    level: 'info',
    source: 'engine',
    message: 'Torrent added',
    context: { name: pick(RELEASES) },
  }),
  () => ({
    level: 'info',
    source: 'engine',
    message: 'Torrent completed',
    context: { name: pick(RELEASES) },
  }),
  () => ({
    level: 'info',
    source: 'playback',
    message: 'Transcode started',
    context: { device: pick(DEVICES), encoder: 'vaapi', height: 1080 },
  }),
  () => ({
    level: 'info',
    source: 'playback',
    message: 'Stream opened',
    context: { device: pick(DEVICES), name: pick(RELEASES) },
  }),
  () => ({
    level: 'info',
    source: 'playback',
    message: 'Playback session ended',
    context: { device: pick(DEVICES), minutes: between(3, 110) },
  }),
  () => ({
    level: 'info',
    source: 'storage',
    message: 'Cache cleanup finished',
    context: { removed: between(1, 4), freed: between(800, 9000) * MB },
  }),
  () => ({
    level: 'info',
    source: 'catalog',
    message: 'Library sync finished',
    context: { added: between(0, 3), ms: between(120, 900) },
  }),
  () => ({
    level: 'info',
    source: 'auth',
    message: 'Device session refreshed',
    context: { device: pick(DEVICES) },
  }),
  () => ({
    level: 'info',
    source: 'notifications',
    message: 'Notification sent',
    context: { channel: pick(['Telegram', 'Home server']) },
  }),
  () => ({
    level: 'warn',
    source: 'sources',
    message: 'Indexer check failed',
    context: {
      indexer: 'Anime indexer',
      host: 'anime.indexer.example',
      reason: 'timeout',
    },
  }),
  () => ({
    level: 'warn',
    source: 'engine',
    message: 'Tracker announce failed',
    context: { host: 'tracker.example', status: 503 },
    repeat: between(2, 5),
  }),
  () => ({
    level: 'warn',
    source: 'network',
    message: 'Host check failed',
    context: { host: 'indexer.example', reason: 'timeout' },
  }),
  () => ({
    level: 'info',
    source: 'network',
    message: 'Host is reachable again',
    context: { host: 'indexer.example', ms: between(40, 300) },
  }),
]

// Частые строки чаще: поиск и просмотр — каждый день, сбои — редко
const WEIGHTS = [6, 3, 3, 4, 5, 4, 2, 2, 2, 2, 1, 1, 1, 1]

function routine(): Draft {
  let roll = random() * WEIGHTS.reduce((sum, weight) => sum + weight, 0)

  for (const [index, weight] of WEIGHTS.entries()) {
    roll -= weight

    if (roll < 0)
      return ROUTINE[index]!()
  }

  return ROUTINE[0]!()
}

function debugLine(): Draft {
  return {
    level: 'debug',
    source: 'server',
    message: 'Request completed',
    context: {
      method: 'GET',
      url: pick(PATHS),
      status: 200,
      ms: between(1, 40),
    },
  }
}

/** Старт процесса: им начинается журнал любого сервера */
const STARTUP: Draft[] = [
  {
    level: 'info',
    source: 'server',
    message: `Torsher ${DEMO_VERSION} starting`,
  },
  {
    level: 'info',
    source: 'server',
    message: 'Database ready',
    context: { migrations: 0 },
  },
  {
    level: 'info',
    source: 'engine',
    message: 'Engine ready',
    context: { peerPort: 51837 },
  },
  {
    level: 'info',
    source: 'playback',
    message: 'Media acceleration checked',
    context: { encoder: 'vaapi', device: '/dev/dri/renderD128' },
  },
  {
    level: 'info',
    source: 'backups',
    message: 'Backup schedule set',
    context: { time: '04:00' },
  },
  {
    level: 'info',
    source: 'server',
    message: 'Server listening',
    context: { port: 8080 },
  },
]

const entries: LogEntry[] = []
const demoStartedAt = Date.now() - elapsedSeconds() * 1000

function add(draft: Draft, at: number) {
  const seq = entries.length + 1

  entries.push({ id: seq, seq, time: new Date(at).toISOString(), ...draft })
}

function history() {
  const start = demoStartedAt - (isFresh ? 90 : HISTORY_SECONDS) * 1000

  STARTUP.forEach((draft, index) => add(draft, start + index * 400))

  if (isFresh)
    return

  const step = (HISTORY_SECONDS * 1000) / HISTORY_LINES
  let at = start + 5000

  // Ночная плановая копия — в начале журнала
  add(
    {
      level: 'info',
      source: 'backups',
      message: 'Backup created',
      context: { reason: 'scheduled', size: 24.6 * MB },
    },
    at,
  )

  for (let line = 0; line < HISTORY_LINES; line++) {
    at += step * (0.4 + random() * 1.2)

    if (at >= demoStartedAt)
      break

    add(routine(), at)
  }

  // Один сбой с подробностями: карточка записи показывает стек
  add(
    {
      level: 'error',
      source: 'sources',
      message: 'Indexer request failed',
      details: [
        'Error: connect ETIMEDOUT 192.168.1.40:443',
        '    at TCPConnectWrap.afterConnect (node:net:1611:16)',
      ].join('\n'),
      context: { indexer: pick(INDEXERS), host: 'anime.indexer.example' },
    },
    demoStartedAt - 25 * 60 * 1000,
  )

  entries.sort((a, b) => a.time.localeCompare(b.time))
  entries.forEach((entry, index) => {
    entry.id = index + 1
    entry.seq = index + 1
  })
}

history()

// Новые строки по ходу демо: опрос с `after` видит, что сервер живёт
let nextLiveAt = 4

function catchUp() {
  const now = elapsedSeconds()

  while (nextLiveAt <= now) {
    const at = demoStartedAt + nextLiveAt * 1000

    if (level === 'debug')
      add(debugLine(), at)

    // Свежий сервер почти молчит: им ещё не пользуются
    if (!isFresh)
      add(routine(), at)

    nextLiveAt += between(4, 12)
  }
}

get<LogsResponse>('/api/logs', ({ query }) => {
  catchUp()

  const minimum = LEVELS.indexOf((query.get('level') as Level) ?? 'info')
  const sources = query.get('source')?.split(',')
  const needle = query.get('q')?.trim().toLowerCase()
  const before = query.has('before') ? Number(query.get('before')) : undefined
  const after = query.has('after') ? Number(query.get('after')) : undefined
  const limit = Number(query.get('limit')) || DEFAULT_LIMIT

  const found = entries.filter(
    entry =>
      LEVELS.indexOf(entry.level) >= Math.max(minimum, 0)
      && (!sources || sources.includes(entry.source))
      && (!needle || entry.message.toLowerCase().includes(needle))
      && (before === undefined || entry.seq < before)
      && (after === undefined || entry.seq > after),
  )

  // С `after` — ближайшие к курсору, иначе — самые новые; новые сверху
  const page
    = after !== undefined ? found.slice(0, limit) : found.slice(-limit)

  return {
    entries: page.reverse(),
    level,
    levelLocked: false,
    hasMore: found.length > limit,
    instance: 'demo',
  }
})

put<LogLevelResponse, LogLevelBodyInput>('/api/logs/level', ({ body }) => {
  level = body.level

  return { level }
})

// Файл журнала собирает сервер
get('/api/logs/download', () => unavailable())
