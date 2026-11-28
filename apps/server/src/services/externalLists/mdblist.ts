import { z } from 'zod'
import { readBodyLimited } from '../net/body.ts'
import { netFetch } from '../net/index.ts'
import { ExternalListsError } from './errors.ts'

const ORIGIN = 'https://api.mdblist.com'
const REQUEST_TIMEOUT_MS = 10_000
const MAX_BODY = 1024 * 1024
const PAGE_SIZE = 100
const MAX_ITEMS = 500
const MAX_PAGES = 6
const SPECIAL_LIST_OWNERS = new Set([
  'official',
  'recommended',
  'share',
  'user',
])

const listMetadata = z.object({
  id: z.number().int().positive(),
  name: z.string().trim().min(1),
  private: z.boolean(),
  items: z.number().int().nonnegative().optional(),
})
const cursorField = z.string().min(1).max(2_048).nullish()
const pageBody = z.object({
  movies: z.array(z.unknown()).optional(),
  shows: z.array(z.unknown()).optional(),
  seasons: z.array(z.unknown()).optional(),
  episodes: z.array(z.unknown()).optional(),
  next_cursor: cursorField,
  pagination: z
    .object({
      next_cursor: cursorField,
      total: z.number().int().nonnegative().optional(),
    })
    .optional(),
})
const row = z.object({
  id: z.number().int().positive().nullish(),
  imdb_id: z.string().nullish(),
  ids: z
    .object({
      tmdb: z.number().int().positive().nullish(),
      imdb: z.string().nullish(),
    })
    .nullish(),
  mediatype: z.string().nullish(),
  rank: z.number().finite().nullish(),
})

export interface SourceTitle {
  type: 'movie' | 'tv'
  tmdbId?: number
  imdbId?: string
  rank?: number
}

export interface SourceSnapshot {
  id: number
  name: string
  items: (SourceTitle | undefined)[]
}

export interface MdblistRequest {
  key: string
  signal: AbortSignal
  beforeRequest: () => void
  onResponse: (response: Response) => void
}

function sourceSegment(value: string) {
  const decoded = decodeURIComponent(value)
  if (
    !decoded
    || decoded.length > 128
    || /^\.{1,2}$/.test(decoded)
    || /[\\/\p{Cc}?#%]/u.test(decoded)
  ) {
    throw new ExternalListsError('invalidSource')
  }
  return encodeURIComponent(decoded)
}

export function sourcePath(source: string | number) {
  const numeric = typeof source === 'number' || /^\d+$/.test(source)
  if (numeric) {
    const id = Number(source)
    if (Number.isSafeInteger(id) && id > 0)
      return `/lists/${id}`
    throw new ExternalListsError('invalidSource')
  }

  try {
    const segments
      = /^https:\/\/mdblist\.com\/lists\/([^/\\?#]+)\/([^/\\?#]+)\/?$/i.exec(
        source,
      )
    if (segments) {
      const owner = sourceSegment(segments[1]!)
      const name = sourceSegment(segments[2]!)
      const ambiguous
        = /^\d+$/.test(owner) && /^(?:items|changes)$/i.test(name)
      if (!SPECIAL_LIST_OWNERS.has(owner.toLowerCase()) && !ambiguous)
        return `/lists/${owner}/${name}`
    }
  }
  catch {
    // Only the expected URL shapes become API paths.
  }
  throw new ExternalListsError('invalidSource')
}

async function fetchJson(
  request: MdblistRequest,
  path: string,
  params: Record<string, string> = {},
) {
  request.signal.throwIfAborted()
  request.beforeRequest()
  const url = new URL(path, ORIGIN)
  url.search = new URLSearchParams({
    ...params,
    apikey: request.key,
  }).toString()
  let response: Response
  try {
    response = await netFetch(url, {
      headers: { Accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.any([
        request.signal,
        AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ]),
    })
  }
  catch {
    // Neither an upstream exception nor its `cause` is safe to retain.
    throw new ExternalListsError('providerError')
  }

  try {
    request.onResponse(response)
  }
  catch (error) {
    await response.body?.cancel().catch(() => {})
    throw error
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {})
    switch (response.status) {
      case 401:
        throw new ExternalListsError('keyRejected')
      case 403:
      case 404:
        throw new ExternalListsError('sourceUnavailable')
      case 429:
        throw new ExternalListsError('retryLater')
      default:
        throw new ExternalListsError('providerError')
    }
  }

  try {
    const raw: unknown = JSON.parse(
      (await readBodyLimited(response, MAX_BODY)).toString('utf8'),
    )
    return { raw, headers: response.headers }
  }
  catch {
    throw new ExternalListsError('providerError')
  }
}

function pageCursor(body: z.infer<typeof pageBody>, headers: Headers) {
  const headerCursor = cursorField.safeParse(headers.get('x-next-cursor'))
  if (!headerCursor.success)
    throw new ExternalListsError('providerError')

  const cursors = new Set(
    [body.pagination?.next_cursor, body.next_cursor, headerCursor.data].filter(
      (value): value is string => !!value,
    ),
  )
  const more = headers.get('x-has-more')?.toLowerCase()
  const cursor = cursors.values().next().value
  const finished
    = more === 'false'
      || body.next_cursor === null
      || body.pagination?.next_cursor === null
  if (
    cursors.size > 1
    || (more !== undefined && more !== 'true' && more !== 'false')
    || (more === 'true' && !cursor)
    || (cursor && finished)
  ) {
    throw new ExternalListsError('providerError')
  }
  return { next: cursor, finished }
}

function normalize(
  input: unknown,
  type: SourceTitle['type'],
): SourceTitle | undefined {
  const parsed = row.safeParse(input)
  if (!parsed.success)
    return undefined

  const value = parsed.data
  const types = type === 'movie' ? ['movie'] : ['show', 'tv']
  if (value.mediatype && !types.includes(value.mediatype))
    return undefined

  if (
    (value.id && value.ids?.tmdb && value.id !== value.ids.tmdb)
    || (value.imdb_id && value.ids?.imdb && value.imdb_id !== value.ids.imdb)
  ) {
    return undefined
  }
  const tmdbId = value.ids?.tmdb ?? value.id ?? undefined
  const imdb = value.ids?.imdb ?? value.imdb_id
  const imdbId = imdb && /^tt\d{5,13}$/.test(imdb) ? imdb : undefined
  return tmdbId || imdbId
    ? { type, tmdbId, imdbId, rank: value.rank ?? undefined }
    : undefined
}

/** No partial snapshot is returned, including on stale/looping cursors. */
export async function readMdblist(
  request: MdblistRequest,
  source: string | number,
): Promise<SourceSnapshot> {
  const path = sourcePath(source)
  const { raw } = await fetchJson(request, path)
  if (Array.isArray(raw) && raw.length !== 1) {
    throw new ExternalListsError(
      raw.length ? 'sourceAmbiguous' : 'sourceUnavailable',
    )
  }
  const metadata = listMetadata.safeParse(Array.isArray(raw) ? raw[0] : raw)
  if (!metadata.success)
    throw new ExternalListsError('providerError')
  const list = metadata.data
  const inputId = /^\/lists\/(\d+)$/.exec(path)?.[1]
  if (list.private || (inputId && list.id !== Number(inputId)))
    throw new ExternalListsError('sourceUnavailable')
  if (list.items !== undefined && list.items > MAX_ITEMS)
    throw new ExternalListsError('sourceTooLarge')
  const name = list.name
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 200)
  if (!name)
    throw new ExternalListsError('providerError')

  const items: SourceSnapshot['items'] = []
  const seenCursors = new Set<string>()
  let cursor: string | undefined
  let expectedTotal = list.items
  for (let index = 0; index < MAX_PAGES; index++) {
    const page = await fetchJson(request, `/lists/${list.id}/items`, {
      limit: String(PAGE_SIZE),
      sort: 'rank',
      order: 'asc',
      ...(cursor ? { cursor } : {}),
    })
    const parsed = pageBody.safeParse(page.raw)
    if (!parsed.success)
      throw new ExternalListsError('providerError')
    const { movies, shows, seasons, episodes, pagination } = parsed.data
    if (!movies && !shows && !seasons && !episodes && pagination?.total !== 0)
      throw new ExternalListsError('providerError')
    const count
      = (movies?.length ?? 0)
        + (shows?.length ?? 0)
        + (seasons?.length ?? 0)
        + (episodes?.length ?? 0)
    if (
      items.length + count > MAX_ITEMS
      || (pagination?.total ?? 0) > MAX_ITEMS
    ) {
      throw new ExternalListsError('sourceTooLarge')
    }
    const pageTotal = pagination?.total
    if (
      count > PAGE_SIZE
      || (pageTotal !== undefined
        && expectedTotal !== undefined
        && pageTotal !== expectedTotal)
    ) {
      throw new ExternalListsError('providerError')
    }
    expectedTotal ??= pageTotal

    for (const item of movies ?? []) items.push(normalize(item, 'movie'))
    for (const item of shows ?? []) items.push(normalize(item, 'tv'))
    for (const _item of seasons ?? []) items.push(undefined)
    for (const _item of episodes ?? []) items.push(undefined)

    const { next, finished } = pageCursor(parsed.data, page.headers)
    cursor = next
    if (!cursor) {
      const complete
        = expectedTotal === undefined
          ? finished || count < PAGE_SIZE
          : expectedTotal === items.length
      if (!complete)
        throw new ExternalListsError('providerError')
      return { id: list.id, name, items }
    }
    if (items.length === MAX_ITEMS)
      throw new ExternalListsError('sourceTooLarge')
    if (
      !count
      || seenCursors.has(cursor)
      || (expectedTotal !== undefined && items.length >= expectedTotal)
    ) {
      throw new ExternalListsError('providerError')
    }
    seenCursors.add(cursor)
  }
  throw new ExternalListsError('providerError')
}
