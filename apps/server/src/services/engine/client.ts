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
 * `failed` — движок ответил ошибкой или неожиданной формой.
 */
export type EngineErrorKind
  = 'unavailable' | 'not_found' | 'rejected' | 'timeout' | 'failed'

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
  error_kind: z.string().optional(),
  human_readable: z.string().optional(),
})

const engineFile = z.object({
  name: z.string(),
  components: z.array(z.string()),
  length: z.number(),
  included: z.boolean(),
  attributes: z.object({ padding: z.boolean().optional() }).optional(),
})

const engineTorrentDetails = z.object({
  info_hash: z.string(),
  name: z.string().nullable(),
  total_pieces: z.number().optional(),
  files: z.array(engineFile).optional(),
})

const engineAddResponse = z.object({
  id: z.number().nullable(),
  details: engineTorrentDetails,
})

// Скорость движок отдаёт в MiB/s
const engineSpeed = z.object({ mbps: z.number() })

const engineStats = z.object({
  state: z.string(),
  error: z.string().nullable(),
  file_progress: z.array(z.number()),
  progress_bytes: z.number(),
  total_bytes: z.number(),
  finished: z.boolean(),
  live: z
    .object({
      snapshot: z.object({
        peer_stats: z.object({ live: z.number(), seen: z.number() }),
      }),
      download_speed: engineSpeed,
      upload_speed: engineSpeed,
    })
    .nullable(),
})

export type EngineFile = z.infer<typeof engineFile>
export type EngineTorrentDetails = z.infer<typeof engineTorrentDetails>

export interface EngineStats {
  state: string
  error: string | null
  fileProgress: number[]
  peers: { connected: number, found: number }
  downloadSpeed: number
  uploadSpeed: number
}

export interface EngineHaves {
  /** Битовое поле кусков, старший бит байта — первый кусок (как в протоколе) */
  bits: Uint8Array
  pieceCount: number
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

  const message = body.human_readable ?? `Engine responded ${response.status}`

  if (response.status === 404 || body.error_kind === 'torrent_not_found')
    return new EngineError('not_found', 'Torrent is not in the engine')

  if (response.status >= 400 && response.status < 500)
    return new EngineError('rejected', message)

  return new EngineError('failed', message)
}

interface EngineRequest {
  method?: 'GET' | 'POST'
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

/** Метаданные по magnet: движок ищет пиров и возвращает `.torrent`, раздачу не добавляя */
export async function resolveMagnet(magnet: string, timeoutMs: number) {
  const response = await engineFetch(
    `/torrents/resolve_magnet?timeout_ms=${timeoutMs}`,
    { method: 'POST', body: magnet, timeoutMs: timeoutMs + 5000 },
  )

  if (!response.ok) {
    const err = await errorOf(response)

    // Движок упирается в свой таймаут и отвечает 500 с текстом «timeout»
    if (err.kind === 'failed' && /timeout/i.test(err.message))
      throw new EngineError('timeout', 'No peers sent the torrent metadata')

    throw err
  }

  return new Uint8Array(await response.arrayBuffer())
}

/** Файлы и infohash `.torrent` без добавления раздачи в движок */
export async function inspectTorrent(bytes: Uint8Array) {
  return engineJson(
    '/torrents?list_only=true&is_url=false',
    engineAddResponse,
    { method: 'POST', body: torrentBody(bytes) },
  ).then(response => response.details)
}

/**
 * Добавляет раздачу, качая только выбранные файлы. `overwrite` нужен, чтобы
 * движок подхватил уже скачанные куски, а не отказался писать в существующий файл.
 * Если раздача уже в движке, он возвращает её как есть — выбор файлов не меняется.
 */
export async function addTorrent(bytes: Uint8Array, onlyFiles: number[]) {
  return engineJson(
    `/torrents?overwrite=true&is_url=false&only_files=${onlyFiles.join(',')}`,
    engineAddResponse,
    { method: 'POST', body: torrentBody(bytes) },
  ).then(response => response.details)
}

export async function updateOnlyFiles(infoHash: string, onlyFiles: number[]) {
  await engineJson(`/torrents/${infoHash}/update_only_files`, z.unknown(), {
    method: 'POST',
    body: JSON.stringify({ only_files: onlyFiles }),
    headers: { 'Content-Type': 'application/json' },
  })
}

/** Убирает раздачу из движка, файлы остаются на диске */
export async function forgetTorrent(infoHash: string) {
  await engineJson(`/torrents/${infoHash}/forget`, z.unknown(), {
    method: 'POST',
  })
}

const MIB = 1024 * 1024

export async function torrentStats(infoHash: string): Promise<EngineStats> {
  const stats = await engineJson(`/torrents/${infoHash}/stats/v1`, engineStats)

  return {
    state: stats.state,
    error: stats.error,
    fileProgress: stats.file_progress,
    peers: {
      connected: stats.live?.snapshot.peer_stats.live ?? 0,
      found: stats.live?.snapshot.peer_stats.seen ?? 0,
    },
    downloadSpeed: Math.round((stats.live?.download_speed.mbps ?? 0) * MIB),
    uploadSpeed: Math.round((stats.live?.upload_speed.mbps ?? 0) * MIB),
  }
}

/** Какие куски уже скачаны; пока раздача проверяет файлы, движок отвечает 412 — тогда `null` */
export async function torrentHaves(
  infoHash: string,
): Promise<EngineHaves | null> {
  const response = await engineFetch(`/torrents/${infoHash}/haves`, {
    headers: { Accept: 'application/octet-stream' },
  })

  if (response.status === 412)
    return null

  if (!response.ok)
    throw await errorOf(response)

  const pieceCount = Number(response.headers.get('x-bitfield-len'))

  if (!Number.isInteger(pieceCount))
    throw new EngineError('failed', 'Unexpected engine response')

  return { bits: new Uint8Array(await response.arrayBuffer()), pieceCount }
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
) {
  const response = await engineFetch(
    `/torrents/${infoHash}/stream/${fileIndex}`,
    { headers: range ? { Range: range } : {}, signal },
  )

  if (!response.ok && response.status !== 416)
    throw await errorOf(response)

  return response
}
