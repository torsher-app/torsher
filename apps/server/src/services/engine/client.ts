import { z } from 'zod'

/**
 * Почему движок недоступен: `not_installed` — нет бинарника,
 * `starting` — запускается или перезапускается после падения,
 * `stopped` — не запускался (тесты, выгрузка OpenAPI) или остановлен.
 */
export type EngineUnavailableKind = 'not_installed' | 'starting' | 'stopped'

/**
 * `unavailable` — движок не запущен или не отвечает, `not_found` — раздачи
 * в нём нет, `rejected` — движок отклонил запрос (битый `.torrent`, неверный magnet),
 * `timeout` — не дождались ответа (метаданные magnet так и не пришли),
 * `moving` — раздача переезжает в другой каталог,
 * `failed` — движок ответил ошибкой или неожиданной формой.
 */
export type EngineErrorKind
  = 'unavailable' | 'not_found' | 'rejected' | 'timeout' | 'moving' | 'failed'

export class EngineError extends Error {
  readonly kind: EngineErrorKind
  readonly unavailable?: EngineUnavailableKind

  constructor(
    kind: EngineErrorKind,
    message: string,
    options?: ErrorOptions & { unavailable?: EngineUnavailableKind },
  ) {
    super(message, options)
    this.name = 'EngineError'
    this.kind = kind
    this.unavailable = options?.unavailable
  }
}

let baseUrl: string | null = null
let downKind: EngineUnavailableKind = 'stopped'

/** Адрес HTTP API движка ставит супервизор, когда движок ответил */
export function setEngineReady(url: string) {
  baseUrl = url
}

export function setEngineDown(kind: EngineUnavailableKind) {
  baseUrl = null
  downKind = kind
}

export function isEngineReady() {
  return baseUrl !== null
}

export function engineState(): 'ready' | EngineUnavailableKind {
  return baseUrl ? 'ready' : downKind
}

export function engineUnavailableError() {
  return new EngineError('unavailable', 'Torrent engine is not running', {
    unavailable: downKind,
  })
}

const CONTROL_TIMEOUT_MS = 10_000

const engineErrorBody = z.object({
  kind: z.string().optional(),
  message: z.string().optional(),
})

const engineTorrentDetails = z.object({
  infoHash: z.string(),
  name: z.string(),
  pieceLength: z.number(),
  pieceCount: z.number(),
  // Все файлы info по порядку, включая выравнивание: индексы — как у движка
  files: z.array(
    z.object({
      path: z.string(),
      length: z.number(),
      padding: z.boolean(),
      // Только у сверки с диском: `match` — куски внутри файла сошлись по
      // хэшу, `differs` — другой размер или кусок не сошёлся, `unknown` —
      // проверить нечем (нет кусков целиком внутри файла)
      onDisk: z.enum(['match', 'differs', 'missing', 'unknown']).optional(),
    }),
  ),
})

const engineTorrentState = z.object({
  infoHash: z.string(),
  paused: z.boolean(),
  // Файлы, которые качаются целиком; остальное качают только окна потоков
  selected: z.array(z.number()).nullable(),
  // Файлы выбора, которые качаются раньше остальных; у движков прежних версий поля нет
  high: z.array(z.number()).nullable().optional(),
  // Скачано всего, включая куски вне выбора, прочитанные потоком
  bytesCompleted: z.number(),
  bytesWanted: z.number(),
  wantedCompleted: z.number(),
  // Выбор ждёт очереди; у движков прежних версий поля нет
  queued: z.boolean().optional(),
  seeding: z.boolean(),
  // Отдано пирам за всё время
  uploaded: z.number().optional(),
  peers: z.object({ connected: z.number(), found: z.number() }),
  downloadSpeed: z.number(),
  uploadSpeed: z.number(),
  fileProgress: z.array(z.number()).nullable(),
  // Куски с неверным хэшем; у движков прежних версий поля нет
  badPieces: z.number().optional(),
})

const engineStats = engineTorrentState.extend({
  // Скачанные куски строкой из 0 и 1 по порядку кусков
  pieces: z.string(),
})

const engineForget = z.object({ deletedBytes: z.number() })

const engineMoveState = z.object({
  dir: z.string(),
  state: z.enum(['running', 'done', 'failed']),
  bytesTotal: z.number(),
  bytesDone: z.number(),
  error: z.string().optional(),
  /** `exists` — в новом каталоге чужой файл под тем же именем */
  kind: z.string().optional(),
})

export type EngineMoveState = z.infer<typeof engineMoveState>

export type EngineTorrentDetails = z.infer<typeof engineTorrentDetails>

/** Раздача в движке: пауза, выбор, сколько скачано, пиры и скорость */
export interface EngineTorrentState {
  infoHash: string
  paused: boolean
  selected: number[]
  /** Файлы выбора, которые качаются раньше остальных */
  high: number[]
  bytesCompleted: number
  bytesWanted: number
  wantedCompleted: number
  queued: boolean
  seeding: boolean
  uploaded: number
  peers: { connected: number, found: number }
  downloadSpeed: number
  uploadSpeed: number
  fileProgress: number[]
  /** Куски с неверным хэшем за время работы движка: их байты могли уйти в поток */
  badPieces: number
}

export interface EngineStats extends EngineTorrentState {
  pieces: string
}

function toState(raw: z.infer<typeof engineTorrentState>): EngineTorrentState {
  return {
    infoHash: raw.infoHash.toLowerCase(),
    paused: raw.paused,
    selected: raw.selected ?? [],
    high: raw.high ?? [],
    bytesCompleted: raw.bytesCompleted,
    bytesWanted: raw.bytesWanted,
    wantedCompleted: raw.wantedCompleted,
    queued: raw.queued ?? false,
    seeding: raw.seeding,
    uploaded: raw.uploaded ?? 0,
    peers: { connected: raw.peers.connected, found: raw.peers.found },
    downloadSpeed: raw.downloadSpeed,
    uploadSpeed: raw.uploadSpeed,
    fileProgress: raw.fileProgress ?? [],
    badPieces: raw.badPieces ?? 0,
  }
}

function isTimeout(err: unknown) {
  return err instanceof Error && err.name === 'TimeoutError'
}

function isAbort(err: unknown) {
  return err instanceof Error && err.name === 'AbortError'
}

async function errorOf(response: Response) {
  let body: z.infer<typeof engineErrorBody> = {}

  try {
    body = engineErrorBody.parse(await response.json())
  }
  catch {}

  const message = body.message ?? `Engine responded ${response.status}`

  if (response.status === 404)
    return new EngineError('not_found', 'Torrent is not in the engine')

  if (response.status === 504)
    return new EngineError('timeout', message)

  if (response.status === 409 && body.kind === 'torrent_moving')
    return new EngineError('moving', message)

  if (response.status >= 400 && response.status < 500)
    return new EngineError('rejected', message)

  return new EngineError('failed', message)
}

interface EngineRequest {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: RequestInit['body']
  headers?: Record<string, string>
  timeoutMs?: number
  signal?: AbortSignal
}

/** Единственный выход к HTTP API движка; движок слушает только loopback */
async function engineFetch(path: string, request: EngineRequest = {}) {
  if (!baseUrl)
    throw engineUnavailableError()

  const signal
    = request.signal
      ?? AbortSignal.timeout(request.timeoutMs ?? CONTROL_TIMEOUT_MS)

  let response: Response

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: request.method ?? 'GET',
      body: request.body,
      headers: request.headers,
      signal,
    })
  }
  catch (err) {
    if (isAbort(err) && request.signal?.aborted)
      throw err

    if (isTimeout(err)) {
      throw new EngineError('timeout', 'Engine did not respond in time', {
        cause: err,
      })
    }

    throw new EngineError('unavailable', 'Torrent engine is unreachable', {
      cause: err,
      unavailable: 'starting',
    })
  }

  return response
}

async function engineJson<T>(
  path: string,
  schema: z.ZodType<T>,
  request?: EngineRequest,
) {
  const response = await engineFetch(path, request)

  if (!response.ok)
    throw await errorOf(response)

  const parsed = schema.safeParse(await response.json().catch(() => null))

  if (!parsed.success)
    throw new EngineError('failed', 'Unexpected engine response')

  return parsed.data
}

function torrentBody(bytes: Uint8Array) {
  return new Blob([bytes], { type: 'application/x-bittorrent' })
}

/** Метаданные по magnet: движок получает `.torrent` от пиров и ничего не качает */
export async function resolveMagnet(magnet: string, timeoutMs: number) {
  const response = await engineFetch(
    `/torrents/resolve?timeout_ms=${timeoutMs}`,
    { method: 'POST', body: magnet, timeoutMs: timeoutMs + 5000 },
  )

  if (!response.ok)
    throw await errorOf(response)

  return new Uint8Array(await response.arrayBuffer())
}

// Сверка читает файлы целиком: на сезоне это минуты
const COMPARE_TIMEOUT_MS = 30 * 60 * 1000

/**
 * Файлы, infohash и размер куска `.torrent` без добавления раздачи. С `dir` —
 * каталогом, куда раздачу добавят, — у файлов `onDisk`: что там уже лежит.
 */
export async function inspectTorrent(
  bytes: Uint8Array,
  options: { dir?: string } = {},
) {
  const query = options.dir
    ? `?${new URLSearchParams({ dir: options.dir })}`
    : ''

  return engineJson(`/torrents/inspect${query}`, engineTorrentDetails, {
    method: 'POST',
    body: torrentBody(bytes),
    ...(options.dir && { timeoutMs: COMPARE_TIMEOUT_MS }),
  })
}

/**
 * Добавляет раздачу (уже добавленную движок возвращает как есть) и выбирает
 * файлы. Целиком выбранный файл докачивается после начала просмотра, до этого
 * движок качает только куски, которые читает поток. Выбор качается в его
 * порядке, `first` — раньше порядка, `low` — после остальных.
 */
export async function addTorrent(
  bytes: Uint8Array,
  onlyFiles: number[],
  dir?: string,
  first: number[] = [],
  low: number[] = [],
) {
  const query = new URLSearchParams({ files: onlyFiles.join(',') })

  if (first.length)
    query.set('first', first.join(','))

  if (low.length)
    query.set('low', low.join(','))

  // Без каталога — каталог загрузок по умолчанию (`--downloads`)
  if (dir)
    query.set('dir', dir)

  return engineJson(
    `/torrents?${query.toString().replaceAll('%2C', ',')}`,
    engineTorrentDetails,
    {
      method: 'POST',
      body: torrentBody(bytes),
    },
  )
}

async function engineEmpty(path: string, request: EngineRequest) {
  const response = await engineFetch(path, request)

  if (!response.ok)
    throw await errorOf(response)
}

/**
 * Меняет выбор файлов: выбранные качаются целиком сразу, в порядке выбора,
 * `first` — раньше порядка, `low` — после остальных. `[]` — полная закачка встаёт.
 */
export async function selectFiles(
  infoHash: string,
  files: number[],
  first: number[] = [],
  low: number[] = [],
) {
  await engineEmpty(`/torrents/${infoHash}/files`, {
    method: 'PUT',
    body: JSON.stringify({ files, first, low }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Раздавать ли раздачу, когда ей уже ничего не нужно. Пока она качает выбор
 * или её смотрят, движок отдаёт всегда. Переживает перезапуск движка
 */
export async function setTorrentSeed(infoHash: string, seed: boolean) {
  await engineEmpty(`/torrents/${infoHash}/seed`, {
    method: 'PUT',
    body: JSON.stringify({ seed }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Настройки, которые движок меняет без перезапуска: байт/с и штуки, 0 — без ограничения */
export interface EngineLiveSettings {
  downloadLimit: number
  uploadLimit: number
  connsPerTorrent: number
  connsTotal: number
  activeDownloads: number
}

const engineLiveSettings = z.object({
  downloadLimit: z.number(),
  uploadLimit: z.number(),
  connsPerTorrent: z.number(),
  connsTotal: z.number(),
  activeDownloads: z.number(),
})

export async function putEngineSettings(settings: EngineLiveSettings) {
  return engineJson('/settings', engineLiveSettings, {
    method: 'PUT',
    body: JSON.stringify(settings),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Пауза останавливает и закачку, и раздачу; переживает перезапуск движка */
export async function pauseTorrent(infoHash: string) {
  await engineEmpty(`/torrents/${infoHash}/pause`, { method: 'POST' })
}

export async function resumeTorrent(infoHash: string) {
  await engineEmpty(`/torrents/${infoHash}/resume`, { method: 'POST' })
}

/**
 * Убирает раздачу из движка. С `deleteFiles` движок удаляет и её файлы;
 * ответ — сколько байт освободилось. Без него файлы остаются на диске.
 */
export async function forgetTorrent(
  infoHash: string,
  options: { deleteFiles?: boolean } = {},
) {
  const query = options.deleteFiles ? '?delete_files=true' : ''
  const result = await engineJson(
    `/torrents/${infoHash}${query}`,
    engineForget,
    {
      method: 'DELETE',
    },
  )

  return result.deletedBytes
}

/**
 * Начинает перенос файлов раздачи в другой каталог. Раздача на это время
 * уходит из движка; ход — `torrentMoveState`.
 */
export async function moveTorrent(infoHash: string, dir: string) {
  return engineJson(`/torrents/${infoHash}/move`, engineMoveState, {
    method: 'POST',
    body: JSON.stringify({ dir }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Ход переноса; `not_found` — движок о переносе не знает (перезапускался) */
export async function torrentMoveState(infoHash: string) {
  return engineJson(`/torrents/${infoHash}/move`, engineMoveState)
}

/** Все раздачи движка одним запросом: для списка загрузок и учёта места */
export async function listEngineTorrents() {
  const list = await engineJson('/torrents', z.array(engineTorrentState))

  return list.map(toState)
}

export async function torrentStats(infoHash: string): Promise<EngineStats> {
  const stats = await engineJson(`/torrents/${infoHash}/stats`, engineStats)

  return { ...toState(stats), pieces: stats.pieces }
}

/**
 * Адрес потока файла для ffmpeg и ffprobe: они читают движок сами, с Range,
 * без прокси сервера. Движок слушает только loopback.
 */
function streamPath(infoHash: string, fileIndex: number, window?: number) {
  const path = `/torrents/${infoHash}/files/${fileIndex}/stream`

  return window ? `${path}?window=${Math.round(window)}` : path
}

/**
 * Адрес потока для ffmpeg и ffprobe. `window` — сколько байт впереди позиции
 * движок качает, пока поток открыт; без него — только срочное у позиции.
 */
export function engineStreamUrl(
  infoHash: string,
  fileIndex: number,
  window?: number,
) {
  if (!baseUrl)
    throw engineUnavailableError()

  return `${baseUrl}${streamPath(infoHash, fileIndex, window)}`
}

/**
 * Поток файла раздачи. Ответ отдаётся как есть, включая 206 и 416: прокси
 * переносит статус и заголовки Range. Отмена — через `signal` вызывающего.
 */
export async function openStream(
  infoHash: string,
  fileIndex: number,
  range: string | undefined,
  signal: AbortSignal,
  window?: number,
) {
  const response = await engineFetch(streamPath(infoHash, fileIndex, window), {
    headers: range ? { Range: range } : {},
    signal,
  })

  if (!response.ok && response.status !== 416)
    throw await errorOf(response)

  return response
}
