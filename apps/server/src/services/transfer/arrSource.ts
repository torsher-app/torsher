import type {
  ArrConnectionBody,
  ArrErrorKind,
  ArrPreviewRow,
} from '../../dto/arrTransfer.ts'
import { ARR_ROW_LIMIT } from '../../dto/arrTransfer.ts'
import { BodyTooLargeError, readBodyLimited } from '../net/body.ts'
import {
  previewTrustedAddress,
  TrustedHttpError,
  trustedHttpRequest,
  trustedUrl,
} from '../net/trustedHttp.ts'

const STATUS_BYTES = 64 * 1024
const LIST_BYTES = 16 * 1024 * 1024

type SourceKind = ArrConnectionBody['kind']
type RowReason = ArrPreviewRow['reasons'][number]
const sources = {
  sonarr: { name: 'Sonarr', path: 'series', majors: [4] },
  radarr: { name: 'Radarr', path: 'movie', majors: [5, 6, 7] },
} satisfies Record<
  SourceKind,
  { name: string, path: string, majors: number[] }
>

export class ArrImportError extends Error {
  readonly kind: ArrErrorKind

  constructor(kind: ArrErrorKind) {
    super(kind)
    this.kind = kind
    this.name = 'ArrImportError'
  }
}

export interface ArrTarget {
  kind: SourceKind
  base: URL
  addresses: string[]
}

export interface ArrSourceRow {
  id?: number
  sourceTitle?: string
  sourceStatus?: ArrPreviewRow['sourceStatus']
  year?: number
  tmdbId?: number
  tvdbId?: number
  imdbId?: string
  skip?: RowReason
  reasons: RowReason[]
}

function asRecord(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function positiveInt(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined
}

function baseUrl(input: string) {
  const url = trustedUrl(input)
  const path = input.replace(/^https?:\/\/[^/]+/i, '').replace(/\/+$/, '')
  if (input.includes('?'))
    throw new ArrImportError('address')

  // URL уже нормализует dot-segments. Проверяем исходный путь до его использования.
  for (const segment of path.slice(1).split('/')) {
    const decoded = decodeURIComponent(segment)
    if (
      /^(?:\.|\.\.)$|[/%\\?#\p{Cc}\p{Cf}]/u.test(decoded)
      || (path && !decoded)
    ) {
      throw new ArrImportError('address')
    }
  }

  url.pathname = url.pathname.replace(/\/+$/, '')
  return url
}

function sourceError(error: unknown) {
  if (error instanceof ArrImportError)
    return error
  if (error instanceof TrustedHttpError) {
    if (error.kind === 'address_changed' || error.kind === 'needs_confirmation')
      return new ArrImportError('address_changed')
    if (error.kind === 'busy')
      return new ArrImportError('busy')
  }
  return new ArrImportError('address')
}

export async function resolveArrTarget(
  body: ArrConnectionBody,
): Promise<ArrTarget> {
  try {
    const base = baseUrl(body.url)
    const target = await previewTrustedAddress(base)
    return {
      kind: body.kind,
      base,
      addresses: target.private ? target.addresses : [],
    }
  }
  catch (error) {
    throw sourceError(error)
  }
}

async function arrGet(
  target: ArrTarget,
  path: string,
  apiKey: string,
  signal: AbortSignal,
  maxBytes: number,
) {
  const url = new URL(target.base)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/api/v3/${path}`
  try {
    const request = await trustedHttpRequest(
      url,
      { origin: target.base.origin, lanAddresses: target.addresses },
      { headers: { 'X-Api-Key': apiKey, 'Accept': 'application/json' }, signal },
    )
    try {
      const { response } = request
      if (response.status === 401 || response.status === 403)
        throw new ArrImportError('auth')
      if (response.status === 404)
        throw new ArrImportError('unsupported')
      if (!response.ok)
        throw new ArrImportError('bad_response')

      const bytes = await readBodyLimited(response, maxBytes)
      return JSON.parse(bytes.toString('utf8')) as unknown
    }
    finally {
      await request.close()
    }
  }
  catch (error) {
    if (error instanceof BodyTooLargeError) {
      throw new ArrImportError(
        path === 'system/status' ? 'bad_response' : 'limit',
      )
    }
    if (error instanceof SyntaxError)
      throw new ArrImportError('bad_response')
    throw sourceError(error)
  }
}

function seasonFlags(seasons: unknown) {
  if (!Array.isArray(seasons))
    return []
  return seasons.flatMap((value) => {
    const season = asRecord(value)
    if (season?.seasonNumber === 0)
      return []
    return [positiveInt(season?.seasonNumber) ? season?.monitored : undefined]
  })
}

function normalizeRow(
  value: unknown,
  kind: SourceKind,
  apiKey: string,
): ArrSourceRow {
  const row = asRecord(value)
  const rawId = positiveInt(row?.id)
  const id = rawId && String(rawId) !== apiKey ? rawId : undefined
  const title = typeof row?.title === 'string' ? row.title.trim() : ''
  // Ответ принадлежит внешнему экземпляру. Его отражение ключа не уходит в UI
  // или метаданные TMDB, даже если выглядит как допустимое поле тайтла.
  const sourceTitle
    = title
      && title.length <= 500
      && !/[\p{Cc}\p{Cf}]/u.test(title)
      && !title.includes(apiKey)
      ? title
      : undefined
  const year = positiveInt(row?.year)
  const status = row?.status
  const sourceStatus
    = kind === 'sonarr'
      && status !== apiKey
      && (status === 'upcoming'
        || status === 'continuing'
        || status === 'ended'
        || status === 'deleted')
      ? status
      : undefined
  const normalized: ArrSourceRow = {
    id,
    sourceTitle,
    sourceStatus,
    year: year && year <= 9999 && String(year) !== apiKey ? year : undefined,
    reasons: [],
  }
  if (!row || !id || !sourceTitle || typeof row.monitored !== 'boolean')
    return { ...normalized, skip: 'invalid' }
  if (!row.monitored)
    return { ...normalized, skip: 'unmonitored' }

  const tmdbId = positiveInt(row.tmdbId)
  if (tmdbId && String(tmdbId) !== apiKey)
    normalized.tmdbId = tmdbId
  if (kind === 'radarr') {
    if (row.hasFile !== false) {
      normalized.reasons.push(
        row.hasFile === true ? 'has_file' : 'unknown_file',
      )
    }
    return normalized
  }

  const tvdbId = positiveInt(row.tvdbId)
  if (tvdbId && String(tvdbId) !== apiKey)
    normalized.tvdbId = tvdbId
  if (
    typeof row.imdbId === 'string'
    && /^tt\d{1,15}$/.test(row.imdbId)
    && row.imdbId !== apiKey
  ) {
    normalized.imdbId = row.imdbId
  }

  if (row.status === 'deleted')
    return { ...normalized, skip: 'deleted' }

  const flags = seasonFlags(row.seasons)
  if (!flags.includes(true))
    return { ...normalized, skip: 'no_monitored_seasons' }
  if (flags.some(value => value !== true) || row.monitorNewItems !== 'all')
    normalized.reasons.push('partial_monitoring')
  if (row.status === 'ended')
    normalized.reasons.push('ended')
  return normalized
}

/** The key is confined to these two reads and normalization of their responses. */
export async function readArrSource(
  target: ArrTarget,
  apiKey: string,
  signal: AbortSignal,
) {
  const source = sources[target.kind]
  const status = asRecord(
    await arrGet(target, 'system/status', apiKey, signal, STATUS_BYTES),
  )
  const version
    = typeof status?.version === 'string'
      ? /^(\d+)\.\d+\.\d+(?:\.\d+)?$/.exec(status.version)
      : null
  if (typeof status?.appName !== 'string' || typeof status.version !== 'string')
    throw new ArrImportError('bad_response')
  if (
    status.appName.toLowerCase() !== source.name.toLowerCase()
    || !version
    || !source.majors.includes(Number(version[1]))
  ) {
    throw new ArrImportError('unsupported')
  }

  const list = await arrGet(target, source.path, apiKey, signal, LIST_BYTES)
  if (!Array.isArray(list))
    throw new ArrImportError('bad_response')
  if (list.length > ARR_ROW_LIMIT)
    throw new ArrImportError('limit')

  return list.map(value => normalizeRow(value, target.kind, apiKey))
}
