import type {
  CreateTorrentInput,
  DownloadTorrentInput,
  MessageResponse,
  OverviewResponse,
  SeedRule,
  Torrent,
  TorrentList,
  UpdateRetentionInput,
  UpdateTorrentPriorityInput,
  UpdateTorrentSeedingInput,
  UpdateTorrentTitleInput,
} from '@torsher/api-client'
import type { DemoRequest } from '@torsher/demo/router'
import {
  putInLibrary,
  releaseOf,
  selectVideo,
  SPEED,
  torrentOf,
  TYPICAL,
} from '../fixtures/downloads'
import { policy } from '../fixtures/storage'
import { titleNamed, TITLES } from '@torsher/demo/titles'
import {
  ago,
  DAY,
  elapsedSeconds,
  GB,
  HOUR,
  isFresh,
  MINUTE,
  nextId,
} from '@torsher/demo/state'
import { del, DemoError, get, post, put } from '@torsher/demo/router'

interface Entry {
  torrent: Torrent
  /** Скорость загрузки выбора, байт/с */
  speed: number
  /** Отдача, пока раздача качается или раздаётся, байт/с */
  upload: number
  /** Отдано до открытия демо */
  uploadedBase: number
  /** Идёт загрузка: с какой секунды демо скачанное ещё не учтено в файлах */
  flow?: { from: number }
  /** Метаданные придут к этой секунде демо */
  resolveAt?: number
  /** Файлы, которые станут известны с метаданными */
  pendingFiles?: Torrent['files']
  /** Смотрят без выбора: качается только этот файл */
  streamFile?: number
}

const ALWAYS: SeedRule = { mode: 'always' }

function assign(torrent: Torrent, values: Partial<Torrent>) {
  Object.assign(torrent, values)
}

function entryOf(
  torrent: Torrent,
  patch: Partial<Omit<Entry, 'torrent'>> = {},
): Entry {
  return { torrent, speed: 0, upload: 0, uploadedBase: 0, ...patch }
}

/**
 * Установка, которой пользуются: две загрузки идут и одна из них скоро
 * закончится, просмотр качает серию, остальное — на паузе, раздаётся, в
 * библиотеке или в кэше, одна раздача не получила метаданные
 */
function livedEntries(): Entry[] {
  const now = elapsedSeconds()
  const make = (
    id: string,
    name: string,
    options: Parameters<typeof releaseOf>[1],
  ) => {
    const title = titleNamed(name)
    return torrentOf(id, title, releaseOf(title, options))
  }

  const ninefold = make('t-ninefold-s02', 'Ninefold Harbor', {
    season: 2,
    quality: '2160p.WEB-DL.H.265',
    videoSize: TYPICAL.episode4k,
  })
  selectVideo(ninefold, 0.92)
  assign(ninefold, {
    retention: 'keep',
    state: 'downloading',
    addedAt: ago(3 * HOUR),
    peers: { connected: 38, found: 112 },
  })

  const lanterns = make('t-lanterns', 'Lanterns of Vell', {
    quality: '2160p.WEB-DL.H.265',
    videoSize: TYPICAL.movie4k,
  })
  selectVideo(lanterns, 0.41)
  assign(lanterns, {
    retention: 'keep',
    state: 'downloading',
    addedAt: ago(40 * MINUTE),
    peers: { connected: 21, found: 64 },
  })

  const saltwater = make('t-saltwater-e03', 'Saltwater Lullaby', {
    season: 1,
    episode: 3,
    videoSize: TYPICAL.episode,
  })
  saltwater.files[0]!.downloaded = Math.round(saltwater.files[0]!.size * 0.35)
  assign(saltwater, {
    state: 'downloading',
    streaming: true,
    addedAt: ago(12 * MINUTE),
    lastAccessAt: ago(0),
    peers: { connected: 14, found: 40 },
  })

  const kites = make('t-kites-e05', 'Kites over Mareth', {
    season: 2,
    episode: 5,
    videoSize: TYPICAL.episode,
  })
  selectVideo(kites, 0.22)
  assign(kites, {
    retention: 'keep',
    state: 'stalled',
    addedAt: ago(2 * DAY),
    peers: { connected: 0, found: 3 },
  })

  const brightwater = make('t-brightwater-e04', 'Brightwater Ninety', {
    season: 1,
    episode: 4,
    quality: '1080p.WEB-DL.H.264',
    videoSize: 1.3 * GB,
  })
  selectVideo(brightwater, 0)
  assign(brightwater, {
    retention: 'keep',
    state: 'queued',
    addedAt: ago(5 * MINUTE),
    peers: { connected: 0, found: 18 },
  })

  const paper = make('t-paper-comets', 'Paper Comets', {
    videoSize: TYPICAL.movie,
  })
  selectVideo(paper, 0.63)
  assign(paper, {
    retention: 'keep',
    state: 'paused',
    pauseReason: 'user',
    addedAt: ago(DAY + 4 * HOUR),
  })

  const orchard = make('t-quiet-orchard', 'The Quiet Orchard', {
    quality: '1080p.BluRay.x264',
    videoSize: 14 * GB,
  })
  putInLibrary(orchard)
  assign(orchard, {
    state: 'seeding',
    addedAt: ago(21 * DAY),
    lastAccessAt: ago(6 * DAY),
    peers: { connected: 4, found: 26 },
  })

  const moth = make('t-moth-s01', 'Moth and Meridian', {
    season: 1,
    videoSize: TYPICAL.episode,
  })
  putInLibrary(moth)
  assign(moth, {
    state: 'seeding',
    addedAt: ago(45 * DAY),
    lastAccessAt: ago(12 * DAY),
  })
  moth.seeding.rule = { mode: 'ratio', ratio: 1 }

  // Серию взяло «Следить»: скачалась сама и легла в библиотеку
  const glasswing = make('t-glasswing-e04', 'Glasswing', {
    season: 2,
    episode: 4,
    videoSize: 3.1 * GB,
  })
  putInLibrary(glasswing)
  assign(glasswing, {
    state: 'seeding',
    addedAt: ago(2 * DAY + 3 * HOUR),
    lastAccessAt: ago(DAY),
    peers: { connected: 7, found: 31 },
  })

  // Кэш просмотра: досмотрели не до конца, файл на диске частично
  const copper = make('t-copper-weather', 'The Copper Weather', {
    videoSize: TYPICAL.movie,
  })
  copper.files[0]!.downloaded = Math.round(3.1 * GB)
  assign(copper, {
    state: 'partial',
    addedAt: ago(5 * DAY),
    lastAccessAt: ago(5 * DAY),
  })

  const winter = make('t-winter-tolvar', 'Winter in Tolvar', {
    videoSize: 12 * GB,
  })
  winter.files[0]!.downloaded = winter.files[0]!.size
  assign(winter, {
    state: 'seeding',
    addedAt: ago(9 * DAY),
    lastAccessAt: ago(9 * DAY),
    peers: { connected: 2, found: 15 },
  })

  // Имя не дало уверенного тайтла: панель предложит «Исправить совпадение»
  const lamplighters = make('t-lamplighters', 'The Lamplighters of Osk', {
    quality: '720p.HDTV.x264',
    videoSize: 4.4 * GB,
  })
  lamplighters.files[0]!.downloaded = Math.round(1.2 * GB)
  assign(lamplighters, {
    state: 'partial',
    titleId: null,
    matchStatus: 'unsure',
    matchSuggestion: titleNamed('The Lamplighters of Osk').id,
    addedAt: ago(3 * DAY),
    lastAccessAt: ago(3 * DAY),
  })

  const signal = make('t-signal-halden', 'Signal from Halden Reach', {
    videoSize: TYPICAL.movie,
  })
  assign(signal, {
    status: 'failed',
    error: 'timeout',
    files: [],
    totalSize: 0,
    addedAt: ago(7 * HOUR),
  })

  return [
    entryOf(ninefold, {
      speed: SPEED.fast,
      upload: 410 * 1024,
      flow: { from: now },
    }),
    entryOf(lanterns, {
      speed: SPEED.steady,
      upload: 230 * 1024,
      flow: { from: now },
    }),
    entryOf(saltwater, {
      speed: SPEED.stream,
      upload: 90 * 1024,
      flow: { from: now },
      streamFile: 0,
    }),
    entryOf(kites, { speed: SPEED.steady }),
    entryOf(brightwater, { speed: SPEED.steady }),
    entryOf(paper, { speed: SPEED.steady }),
    entryOf(orchard, { upload: 820 * 1024, uploadedBase: 1.4 * 14 * GB }),
    entryOf(moth, { uploadedBase: 1.3 * moth.totalSize }),
    entryOf(glasswing, { upload: 340 * 1024, uploadedBase: 1.3 * GB }),
    entryOf(copper, { speed: SPEED.steady }),
    entryOf(winter, { upload: 120 * 1024, uploadedBase: 5.6 * GB }),
    entryOf(lamplighters, { speed: SPEED.steady }),
    entryOf(signal),
  ]
}

const entries: Entry[] = isFresh ? [] : livedEntries()

function sum<T>(items: T[], value: (item: T) => number) {
  return items.reduce((total, item) => total + value(item), 0)
}

function targetsOf(entry: Entry) {
  const { files } = entry.torrent

  if (entry.streamFile !== undefined)
    return files.filter(file => file.index === entry.streamFile)

  // Как в движке: поднятые владельцем — раньше, остальные по порядку
  const selected = files.filter(file => file.selected)

  return [
    ...selected.filter(file => file.priority === 'high'),
    ...selected.filter(file => file.priority === 'medium'),
    ...selected.filter(file => file.priority === 'low'),
  ]
}

function markFirst(entry: Entry) {
  const pending = entry.flow
    ? targetsOf(entry).filter(file => file.downloaded < file.size)
    : []
  const raised = pending.filter(file => file.priority === 'high')
  const ahead = new Set(raised.length ? raised : pending.slice(0, 1))

  for (const file of entry.torrent.files)
    file.downloadingFirst = ahead.has(file)
}

function isDone(entry: Entry) {
  return targetsOf(entry).every(file => file.downloaded >= file.size)
}

/** Загрузка закончилась: закреплённое ложится в библиотеку и раздаётся */
function finish(entry: Entry) {
  const { torrent } = entry

  entry.flow = undefined
  entry.streamFile = undefined
  torrent.streaming = false
  torrent.state = 'seeding'
  entry.upload ||= 150 * 1024

  if (torrent.retention === 'keep')
    putInLibrary(torrent)
}

function startFlow(entry: Entry) {
  entry.speed ||= SPEED.steady

  if (isDone(entry)) {
    finish(entry)
    return
  }

  entry.torrent.state = 'downloading'
  entry.flow ??= { from: elapsedSeconds() }
}

/** Двигает загрузку к текущей секунде демо: скачанное копится в файлах */
function advance(entry: Entry) {
  const now = elapsedSeconds()
  const { torrent } = entry

  if (
    torrent.status === 'resolving'
    && entry.resolveAt !== undefined
    && now >= entry.resolveAt
  ) {
    torrent.status = 'ready'
    torrent.files = entry.pendingFiles ?? []
    torrent.totalSize = sum(torrent.files, file => file.size)
    torrent.peers = { connected: 26, found: 80 }
    selectVideo(torrent, 0)
    torrent.retention = 'keep'
    entry.resolveAt = undefined
    entry.pendingFiles = undefined
    entry.flow = { from: now }
    torrent.state = 'downloading'
  }

  if (!entry.flow)
    return

  let budget = entry.speed * (now - entry.flow.from)
  entry.flow.from = now

  for (const file of targetsOf(entry)) {
    const take = Math.min(budget, file.size - file.downloaded)
    file.downloaded += take
    budget -= take
  }

  if (isDone(entry))
    finish(entry)
}

/** Скорость в ответе слегка «дышит», как у настоящей раздачи */
function jitter(value: number, seed: number) {
  if (!value)
    return 0

  return Math.round(
    value * (0.88 + 0.24 * Math.abs(Math.sin(elapsedSeconds() / 4 + seed))),
  )
}

function seedingOf(torrent: Torrent, uploaded: number): Torrent['seeding'] {
  const size = torrent.progress.wanted || torrent.sizeOnDisk
  const ratio = size > 0 ? uploaded / size : null
  const base = { rule: torrent.seeding.rule, uploaded, ratio }

  if (torrent.retention === 'cache')
    return { ...base, effective: null, stopped: null }

  const effective = torrent.seeding.rule ?? ALWAYS
  let stopped: Torrent['seeding']['stopped'] = null

  if (effective.mode === 'never') {
    stopped = 'never'
  }
  else if (
    effective.mode === 'ratio'
    && ratio !== null
    && ratio >= (effective.ratio ?? 0)
  ) {
    stopped = 'ratio'
  }

  return { ...base, effective, stopped }
}

/** Раздача, как её отдаёт сервер: цифры прогресса и скорости — на сейчас */
function view(entry: Entry, position: number): Torrent {
  advance(entry)
  markFirst(entry)

  const torrent = structuredClone(entry.torrent)
  const selected = torrent.files.filter(file => file.selected)
  const active = !!entry.flow

  torrent.progress = {
    downloaded: Math.round(sum(selected, file => file.downloaded)),
    wanted: sum(selected, file => file.size),
  }
  torrent.files.forEach((file) => {
    file.downloaded = Math.round(file.downloaded)
  })
  torrent.sizeOnDisk = sum(torrent.files, file => file.downloaded)

  const seeding = torrent.state === 'seeding'
  const uploadSpeed = seeding || active ? entry.upload : 0
  const uploaded = Math.round(
    entry.uploadedBase + (seeding ? uploadSpeed * elapsedSeconds() : 0),
  )

  torrent.seeding = seedingOf(torrent, uploaded)

  // Правило раздачи выполнено: раздача остановлена, но скачана целиком
  if (seeding && torrent.seeding.stopped) {
    torrent.state = 'complete'
    torrent.uploadSpeed = 0
    torrent.peers = { connected: 0, found: torrent.peers.found }
  }
  else {
    torrent.uploadSpeed = jitter(uploadSpeed, position + 0.5)
  }

  torrent.downloadSpeed = active ? jitter(entry.speed, position) : 0

  return torrent
}

function views() {
  return entries.map(view)
}

function entryById(id: string) {
  const found = entries.find(entry => entry.torrent.id === id)

  if (!found)
    throw new DemoError(404, { message: 'Torrent not found' })

  return found
}

function respond(entry: Entry) {
  return view(entry, entries.indexOf(entry))
}

/** Раздачи для «Хранилища»: место на диске, кэш и очередь вытеснения */
export function torrentsSnapshot() {
  return views()
}

/** Плитка загрузок «Обзора», как её собирает сервер */
export function downloadStats(): OverviewResponse['downloads'] {
  const items = views()

  return {
    total: items.length,
    active: items.filter(item =>
      ['queued', 'downloading', 'stalled'].includes(item.state),
    ).length,
    downloadSpeed: sum(items, item => item.downloadSpeed),
    uploadSpeed: sum(items, item => item.uploadSpeed),
  }
}

get<TorrentList>('/api/torrents', () => {
  const items = views()

  return {
    items,
    engine: 'ready',
    totals: {
      downloadSpeed: sum(items, item => item.downloadSpeed),
      uploadSpeed: sum(items, item => item.uploadSpeed),
    },
    cache: {
      used: sum(
        items.filter(item => item.retention === 'cache'),
        item => item.sizeOnDisk,
      ),
      limit: policy.cacheLimit,
    },
  }
})

/** Тайтл для новой раздачи: первый, которого ещё нет в загрузках */
function nextTitle() {
  const used = new Set(
    entries.map(
      entry => entry.torrent.titleId ?? entry.torrent.matchSuggestion,
    ),
  )
  const free = TITLES.filter(title => !used.has(title.id))

  return free[0] ?? TITLES[entries.length % TITLES.length]!
}

post<Torrent, CreateTorrentInput>('/api/torrents', ({ body }) => {
  const magnet = body?.magnet?.trim()

  if (!magnet && !body?.torrentFile) {
    throw new DemoError(400, {
      message: 'Magnet link or torrent file is required',
    })
  }

  if (magnet && !magnet.startsWith('magnet:?'))
    throw new DemoError(400, { message: 'Invalid magnet link' })

  const hash = magnet?.match(/xt=urn:btih:([a-z0-9]+)/i)?.[1]?.toLowerCase()
  const existing
    = hash && entries.find(entry => entry.torrent.infoHash === hash)

  if (existing)
    return respond(existing)

  const title = nextTitle()
  const release = releaseOf(title, {
    season: title.kind === 'series' ? 1 : undefined,
    episode: title.kind === 'series' && title.ongoing ? 1 : undefined,
    videoSize: title.kind === 'movie' ? TYPICAL.movie : TYPICAL.episode,
  })
  const id = nextId('torrent')
  const torrent = torrentOf(id, title, release)
  const entry = entryOf(torrent, {
    // Качается за несколько минут, чтобы в демо было видно конец
    speed: Math.max(SPEED.steady, release.totalSize / 240),
    upload: 200 * 1024,
    pendingFiles: release.files,
  })

  if (hash)
    torrent.infoHash = hash

  assign(torrent, {
    source: magnet ? 'magnet' : 'file',
    status: 'resolving',
    files: [],
    totalSize: 0,
    addedAt: ago(0),
  })
  // У файла `.torrent` метаданные уже есть: качается сразу
  entry.resolveAt = elapsedSeconds() + (magnet ? 3 : 0)
  entries.unshift(entry)

  return respond(entry)
})

del<MessageResponse>('/api/torrents/:id', ({ params }) => {
  const entry = entryById(params.id!)

  entries.splice(entries.indexOf(entry), 1)

  return { message: 'Torrent deleted' }
})

// Повтор нужен только раздаче, которая не дождалась метаданных
post<Torrent>('/api/torrents/:id/retry', ({ params }) => {
  const entry = entryById(params.id!)
  const { torrent } = entry

  if (torrent.status === 'failed') {
    const title = TITLES.find(item => item.id === torrent.titleId)

    if (title) {
      entry.pendingFiles = releaseOf(title, {
        videoSize: TYPICAL.movie,
      }).files
    }

    entry.speed = Math.max(SPEED.steady, TYPICAL.movie / 240)
    entry.upload = 200 * 1024
    entry.resolveAt = elapsedSeconds() + 4
    torrent.status = 'resolving'
    torrent.error = null
  }

  return respond(entry)
})

post<Torrent, DownloadTorrentInput>(
  '/api/torrents/:id/download',
  ({ params, body }) => {
    const entry = entryById(params.id!)
    const { torrent } = entry

    if (torrent.status !== 'ready')
      throw new DemoError(409, { message: 'Torrent metadata is not ready' })

    const wanted = new Set(body.files)
    const files = torrent.files.filter(file => wanted.has(file.index))

    if (files.length !== wanted.size || files.some(file => !file.isVideo))
      throw new DemoError(400, { message: 'Unknown file index' })

    advance(entry)
    for (const file of torrent.files) {
      file.selected = wanted.has(file.index)
      if (!file.selected)
        file.priority = 'medium'
    }
    torrent.retention = 'keep'

    // Просмотр докачивает уже выбранное: файл просмотра больше не особый
    entry.streamFile = undefined
    torrent.streaming = false

    if (torrent.state !== 'paused' && torrent.state !== 'stalled')
      startFlow(entry)

    return respond(entry)
  },
)

put<Torrent, UpdateTorrentPriorityInput>(
  '/api/torrents/:id/priority',
  ({ params, body }) => {
    const entry = entryById(params.id!)
    const changed = new Set(body.files)

    advance(entry)
    for (const file of entry.torrent.files) {
      if (file.selected && changed.has(file.index))
        file.priority = body.priority
    }

    return respond(entry)
  },
)

function pause(req: DemoRequest) {
  const entry = entryById(req.params.id!)

  advance(entry)
  entry.flow = undefined
  entry.torrent.state = 'paused'
  entry.torrent.pauseReason = 'user'
  entry.torrent.peers = { connected: 0, found: entry.torrent.peers.found }

  return respond(entry)
}

function resume(req: DemoRequest) {
  const entry = entryById(req.params.id!)
  const { torrent } = entry

  if (torrent.state === 'paused') {
    torrent.pauseReason = null
    torrent.peers = { connected: 17, found: Math.max(torrent.peers.found, 40) }

    if (targetsOf(entry).length === 0)
      torrent.state = torrent.sizeOnDisk > 0 ? 'partial' : 'idle'
    else startFlow(entry)
  }

  return respond(entry)
}

post<Torrent>('/api/torrents/:id/pause', pause)
post<Torrent>('/api/torrents/:id/resume', resume)

put<Torrent, UpdateRetentionInput>(
  '/api/torrents/:id/retention',
  ({ params, body }) => {
    const entry = entryById(params.id!)
    const { torrent } = entry

    advance(entry)
    torrent.retention = body.retention

    if (body.retention === 'cache')
      torrent.seeding.rule = null
    else if (torrent.files.some(file => file.selected) && isDone(entry))
      putInLibrary(torrent)

    return respond(entry)
  },
)

put<Torrent, UpdateTorrentSeedingInput>(
  '/api/torrents/:id/seeding',
  ({ params, body }) => {
    const entry = entryById(params.id!)

    if (entry.torrent.retention !== 'keep')
      throw new DemoError(409, { message: 'Torrent is not kept' })

    entry.torrent.seeding.rule = body.rule

    // Снятое правилом снова раздаётся, если новое правило это разрешает
    if (
      entry.torrent.state === 'complete'
      || entry.torrent.state === 'seeding'
    ) {
      entry.torrent.state = 'seeding'
      entry.upload ||= 150 * 1024
    }

    return respond(entry)
  },
)

put<Torrent, UpdateTorrentTitleInput>(
  '/api/torrents/:id/title',
  ({ params, body }) => {
    const entry = entryById(params.id!)

    entry.torrent.titleId = body.titleId
    entry.torrent.matchStatus = body.titleId ? 'user' : 'ignored'
    entry.torrent.matchSuggestion = null

    return respond(entry)
  },
)

del<Torrent>('/api/torrents/:id/library', ({ params }) => {
  const entry = entryById(params.id!)
  const { torrent } = entry

  torrent.inLibrary = false
  torrent.retention = 'cache'
  torrent.seeding.rule = null
  torrent.files.forEach((file) => {
    file.inLibrary = false
  })

  return respond(entry)
})
