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
    z.object({ path: z.string(), length: z.number(), padding: z.boolean() }),
  ),
})

const engineStats = z.object({
  peers: z.object({ connected: z.number(), found: z.number() }),
  downloadSpeed: z.number(),
  uploadSpeed: z.number(),
  fileProgress: z.array(z.number()).nullable(),
  // Скачанные куски строкой из 0 и 1 по порядку кусков
  pieces: z.string(),
})

export type EngineTorrentDetails = z.infer<typeof engineTorrentDetails>

export interface EngineStats {
  peers: { connected: number, found: number }
  downloadSpeed: number
  uploadSpeed: number
  fileProgress: number[]
  pieces: string
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

  if (response.status >= 400 && response.status < 500)
    return new EngineError('rejected', message)

  return new EngineError('failed', message)
}

interface EngineRequest {
  method?: 'GET' | 'POST' | 'DELETE'
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

/** Файлы, infohash и размер куска `.torrent` без добавления раздачи */
export async function inspectTorrent(bytes: Uint8Array) {
  return engineJson('/torrents/inspect', engineTorrentDetails, {
    method: 'POST',
    body: torrentBody(bytes),
  })
}

/**
 * Добавляет раздачу (уже добавленную движок возвращает как есть) и выбирает
 * файлы. Целиком выбранный файл докачивается после начала просмотра, до этого
 * движок качает только куски, которые читает поток.
 */
export async function addTorrent(bytes: Uint8Array, onlyFiles: number[]) {
  return engineJson(
    `/torrents?files=${onlyFiles.join(',')}`,
    engineTorrentDetails,
    {
      method: 'POST',
      body: torrentBody(bytes),
    },
  )
}

/** Убирает раздачу из движка, файлы остаются на диске */
export async function forgetTorrent(infoHash: string) {
  const response = await engineFetch(`/torrents/${infoHash}`, {
    method: 'DELETE',
  })

  if (!response.ok)
    throw await errorOf(response)
}

export async function torrentStats(infoHash: string): Promise<EngineStats> {
  const stats = await engineJson(`/torrents/${infoHash}/stats`, engineStats)

  return {
    peers: stats.peers,
    downloadSpeed: stats.downloadSpeed,
    uploadSpeed: stats.uploadSpeed,
    fileProgress: stats.fileProgress ?? [],
    pieces: stats.pieces,
  }
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
    `/torrents/${infoHash}/files/${fileIndex}/stream`,
    { headers: range ? { Range: range } : {}, signal },
  )

  if (!response.ok && response.status !== 416)
    throw await errorOf(response)

  return response
}
