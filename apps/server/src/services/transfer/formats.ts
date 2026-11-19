import type { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { csvRecords } from './csv.ts'
import { isZip, readZip, ZipError } from './zip.ts'

// `torsher` — общий файл импорта или экспорт профиля Torsher
export const importSources = [
  'imdb',
  'letterboxd',
  'trakt',
  'torsher',
] as const

export type ImportSource = (typeof importSources)[number]
export const importLists = [
  'rating',
  'watchlist',
  'watched',
  'history',
] as const
export type ImportList = (typeof importLists)[number]
export type ImportKind = 'movie' | 'series'

type ViewingDate
  = | { precision: 'instant', instant: string, day: null }
    | { precision: 'day', instant: null, day: string }
    | { precision: 'unknown', instant: null, day: null }

export type ImportedViewing
  = | { kind: 'seen', season: number, episode: number }
    | {
      kind: 'entry'
      origin: 'letterboxd' | 'trakt'
      originKey: string
      sourceMatchKey?: string
      season: number
      episode: number
      date: ViewingDate
      rewatch: boolean
      note: string | null
      viewingContext: string | null
    }

/**
 * Строка файла пользователя, приведённая к одному виду. Из чужих файлов
 * берём только его собственные данные: ID, оценку, дату, тип, название
 * и год. Оценки сервиса (`IMDb Rating`, голоса) не читаем.
 */
export interface ImportEntry {
  source: ImportSource
  list: ImportList
  title: string
  originalTitle?: string
  year?: number
  kind?: ImportKind
  tmdbId?: number
  imdbId?: string
  // 1–10
  rating?: number
  at?: Date
  viewing?: ImportedViewing
  // Ephemeral key for attaching a review from the same upload.
  reviewKey?: string
}

export interface PendingViewingGroup {
  matchKey: string
  items: ImportedViewing[]
}

export interface ImportFile {
  name: string
  data: Buffer
}

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
export const MAX_IMPORT_ROWS = 20_000

// `serverExport` — экспорт сервера с несколькими профилями: его
// импортируют в «Резервных копиях»; `newerVersion` — файл от более новой
// версии Torsher
export type ImportFormatErrorKind
  = | 'unsupported'
    | 'broken'
    | 'tooLarge'
    | 'tooMany'
    | 'empty'
    | 'serverExport'
    | 'newerVersion'

export class ImportFormatError extends Error {
  kind: ImportFormatErrorKind
  file?: string

  constructor(kind: ImportFormatErrorKind, file?: string) {
    super(file ? `${kind}: ${file}` : kind)
    this.kind = kind
    this.file = file
  }
}

const IMDB_ID = /^tt\d{5,10}$/
// Тип тайтла IMDb без регистра и пробелов: «TV Mini Series» → tvminiseries
const IMDB_SERIES = new Set(['tvseries', 'tvminiseries'])
const IMDB_SKIPPED = new Set([
  'tvepisode',
  'videogame',
  'podcastseries',
  'podcastepisode',
  'musicvideo',
])

function baseName(name: string) {
  return name.split('/').pop()!.toLowerCase()
}

function isWatchlistName(name: string) {
  return baseName(name).includes('watchlist')
}

function yearOf(value: unknown) {
  const year = Number(value)

  return Number.isInteger(year) && year >= 1870 && year <= 2100
    ? year
    : undefined
}

function dateOf(value: unknown) {
  if (typeof value !== 'string' || !value)
    return undefined

  const time = Date.parse(value)

  // Даты из будущего — мусор: оценку не ставят завтра
  return Number.isFinite(time) && time > 0 && time < Date.now() + 86_400_000
    ? new Date(time)
    : undefined
}

function tenPoint(value: unknown) {
  const rating = Number(value)

  return Number.isInteger(rating) && rating >= 1 && rating <= 10
    ? rating
    : undefined
}

// Пять звёзд с шагом 0,5 → 1–10 без потерь
function fivePoint(value: unknown) {
  const stars = Number(value)

  return Number.isFinite(stars) && stars >= 0.5 && stars <= 5
    ? Math.round(stars * 2)
    : undefined
}

function imdbIdOf(value: unknown) {
  return typeof value === 'string' && IMDB_ID.test(value.trim())
    ? value.trim()
    : undefined
}

function tmdbIdOf(value: unknown) {
  const id = Number(value)

  return Number.isSafeInteger(id) && id > 0 ? id : undefined
}

/** Значение столбца без учёта регистра имени: заголовки правят руками */
function field(record: Record<string, string>, name: string) {
  const key = Object.keys(record).find(
    item => item.toLowerCase() === name.toLowerCase(),
  )

  return key === undefined ? '' : record[key]!
}

function hasColumn(columns: string[], name: string) {
  return columns.some(item => item.toLowerCase() === name.toLowerCase())
}

interface Review {
  key: string
  note: string
}

interface Parsed {
  entries: ImportEntry[]
  skipped: number
  reviews?: Review[]
}

const UNKNOWN_VIEW: ViewingDate = {
  precision: 'unknown',
  instant: null,
  day: null,
}
const DAY = z.iso.date()
const INSTANT = z.iso.datetime({ offset: true })
const TRAKT_HISTORY_FILE = /^(?:history|watched-history)(?:-\d+)?\.json$/
const TRAKT_WATCHED_FILE = /^watched-(?:movies|shows)(?:-\d+)?\.json$/
const TRAKT_HISTORY_ACTIONS = new Set(['scrobble', 'checkin', 'watch'])
const LETTERBOXD_REVIEWS_FILE = /^reviews(?:[-_]\d+| \(\d+\))?\.csv$/
const MAX_NOTE = 10_000
const NOTE_SEPARATOR = '\n\n---\n\n'

function nextOccurrence(keys: Map<string, number>, key: string) {
  const ordinal = (keys.get(key) ?? 0) + 1
  keys.set(key, ordinal)
  return `row:${key}:${ordinal}`
}

function digest(parts: unknown[]) {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex')
}

function ownText(value: unknown, max: number): string | null | undefined {
  if (value == null || value === '')
    return null
  return typeof value === 'string' && value.length <= max ? value : undefined
}

function appendNote(current: string | null, extra: string | null) {
  if (!current || !extra)
    return current ?? extra
  const wrapped = NOTE_SEPARATOR + current + NOTE_SEPARATOR
  if (wrapped.includes(NOTE_SEPARATOR + extra + NOTE_SEPARATOR))
    return current
  const combined = current + NOTE_SEPARATOR + extra
  return combined.length <= MAX_NOTE ? combined : undefined
}

function letterboxdNote(record: Record<string, string>) {
  const note = ownText(field(record, 'Note'), MAX_NOTE)
  const review = ownText(field(record, 'Review'), MAX_NOTE)
  if (note === undefined || review === undefined)
    return { note: undefined, overflow: false }
  const combined = appendNote(note, review)
  return {
    note: combined === undefined ? note : combined,
    overflow: combined === undefined,
  }
}

function letterboxdUri(value: string) {
  try {
    const uri = new URL(value)
    if (uri.protocol !== 'https:' || uri.username || uri.password)
      return undefined
    if (
      uri.hostname === 'letterboxd.com'
      || uri.hostname === 'www.letterboxd.com'
    ) {
      const path = uri.pathname.replace(/\/$/, '').toLowerCase()
      if (/^\/[a-z0-9_-]+\/film\/[a-z0-9_-]+\/[1-9]\d*$/.test(path))
        return { event: path }
      if (/^\/film\/[a-z0-9_-]+$/.test(path))
        return { film: path }
    }
    if (uri.hostname === 'boxd.it' && /^\/[a-z0-9]+\/?$/i.test(uri.pathname))
      return { film: uri.hostname + uri.pathname.replace(/\/$/, '') }
  }
  catch {
    // A URI is an optional identity in the file. It is never fetched.
  }
}

function letterboxdKeys(record: Record<string, string>, day: string | null) {
  const uri = letterboxdUri(field(record, 'Letterboxd URI'))
  const title = field(record, 'Name').trim().normalize('NFC').toLowerCase()
  const year = yearOf(field(record, 'Year')) ?? null
  const logged = field(record, 'Date').trim()
  const row = digest([uri?.film ?? title, year, day])
  const event = uri?.event && `uri:${digest([uri.event])}`
  const reviewKey = digest([
    row,
    DAY.safeParse(logged).success ? logged : null,
  ])
  // Even a film URI cannot link a review when multiple actual diary rows
  // share the same title, watch day and log day.
  return { row, event, review: event ?? `row:${reviewKey}` }
}

function letterboxdReviewRows(records: Record<string, string>[]): Parsed {
  const reviews: Review[] = []
  let skipped = 0
  for (const record of records) {
    const watched = field(record, 'Watched Date').trim()
    const { note, overflow } = letterboxdNote(record)
    if (
      !field(record, 'Name').trim()
      || !note
      || (watched && !DAY.safeParse(watched).success)
    ) {
      skipped++
      continue
    }
    if (overflow)
      skipped++
    reviews.push({ key: letterboxdKeys(record, watched || null).review, note })
  }
  return { entries: [], skipped, reviews }
}

function imdbRows(name: string, records: Record<string, string>[]): Parsed {
  const entries: ImportEntry[] = []
  let skipped = 0
  const isList = records.length > 0 && 'Position' in records[0]!

  for (const record of records) {
    const imdbId = imdbIdOf(record.Const)
    const type = (record['Title Type'] ?? '').toLowerCase().replace(/\s+/g, '')

    if (!imdbId || IMDB_SKIPPED.has(type)) {
      skipped++
      continue
    }

    const base = {
      source: 'imdb' as const,
      imdbId,
      title: record.Title ?? '',
      originalTitle: record['Original Title'] || undefined,
      year: yearOf(record.Year),
      kind: IMDB_SERIES.has(type) ? ('series' as const) : ('movie' as const),
    }
    const rating = tenPoint(record['Your Rating'])

    if (rating) {
      entries.push({
        ...base,
        list: 'rating',
        rating,
        at: dateOf(record['Date Rated']),
      })
    }
    else if (isList || isWatchlistName(name)) {
      entries.push({ ...base, list: 'watchlist', at: dateOf(record.Created) })
    }
    else {
      skipped++
    }
  }

  return { entries, skipped }
}

function letterboxdRows(
  name: string,
  columns: string[],
  records: Record<string, string>[],
): Parsed {
  const entries: ImportEntry[] = []
  const baseFile = baseName(name)
  const diary = hasColumn(columns, 'Watched Date')
  const hasReview = hasColumn(columns, 'Review')
  const annotatedDiary
    = hasColumn(columns, 'Note') || hasColumn(columns, 'Context')
  // A canonical diary file establishes the row's meaning even if it
  // includes a Review column. An ambiguously named review-only shape
  // otherwise serves as enrichment.
  if (
    LETTERBOXD_REVIEWS_FILE.test(baseFile)
    || (baseFile !== 'diary.csv' && diary && hasReview && !annotatedDiary)
  ) {
    return letterboxdReviewRows(records)
  }

  const watchedList = baseFile === 'watched.csv' && !diary
  const watchlist
    = !diary && !hasColumn(columns, 'Rating') && isWatchlistName(name)
  const occurrences = new Map<string, number>()
  let skipped = 0

  for (const record of records) {
    const title = field(record, 'Name').trim()

    if (!title) {
      skipped++
      continue
    }

    const base = {
      source: 'letterboxd' as const,
      title,
      year: yearOf(field(record, 'Year')),
      kind: 'movie' as const,
    }

    if (watchlist) {
      entries.push({
        ...base,
        list: 'watchlist',
        at: dateOf(field(record, 'Date')),
      })
      continue
    }
    if (watchedList) {
      entries.push({
        ...base,
        list: 'history',
        viewing: { kind: 'seen', season: 0, episode: 0 },
      })
      continue
    }

    const watched = field(record, 'Watched Date').trim()
    if (diary) {
      const { note, overflow } = letterboxdNote(record)
      const viewingContext = ownText(
        field(record, 'Context') || field(record, 'Tags'),
        1000,
      )
      if (
        (watched && !DAY.safeParse(watched).success)
        || note === undefined
        || viewingContext === undefined
      ) {
        skipped++
        continue
      }
      if (overflow)
        skipped++
      const date: ViewingDate = watched
        ? { precision: 'day', day: watched, instant: null }
        : UNKNOWN_VIEW
      const keys = letterboxdKeys(record, date.day)
      entries.push({
        ...base,
        list: 'history',
        reviewKey: keys.review,
        viewing: {
          kind: 'entry',
          origin: 'letterboxd',
          originKey: keys.event ?? nextOccurrence(occurrences, keys.row),
          season: 0,
          episode: 0,
          date,
          rewatch: /^(?:yes|true)$/i.test(field(record, 'Rewatch').trim()),
          note,
          viewingContext,
        },
      })
    }

    const rating = fivePoint(field(record, 'Rating'))
    if (rating) {
      entries.push({
        ...base,
        list: 'rating',
        rating,
        at: dateOf(watched) ?? dateOf(field(record, 'Date')),
      })
    }
    else if (!diary) {
      skipped++
    }
  }

  return { entries, skipped }
}

/**
 * Формат импорта Letterboxd: в него переводят свои данные конвертеры
 * других сервисов, поэтому фильм ли это, заранее неизвестно.
 */
function importFormatRows(
  name: string,
  records: Record<string, string>[],
): Parsed {
  const entries: ImportEntry[] = []
  let skipped = 0
  const watchlist = isWatchlistName(name)

  for (const record of records) {
    const base = {
      source: 'letterboxd' as const,
      title: field(record, 'Title'),
      year: yearOf(field(record, 'Year')),
      tmdbId: tmdbIdOf(field(record, 'tmdbID')),
      imdbId: imdbIdOf(field(record, 'imdbID')),
    }

    if (!base.title && !base.tmdbId && !base.imdbId) {
      skipped++
      continue
    }

    // Из двух столбцов оценки действует последний в строке, как у Letterboxd
    const rating
      = tenPoint(field(record, 'Rating10')) ?? fivePoint(field(record, 'Rating'))

    if (rating) {
      entries.push({
        ...base,
        list: 'rating',
        rating,
        at: dateOf(field(record, 'WatchedDate')),
      })
    }
    else if (watchlist) {
      entries.push({ ...base, list: 'watchlist' })
    }
    else {
      skipped++
    }
  }

  return { entries, skipped }
}

interface TraktMedia {
  title?: string
  year?: number
  ids?: { tmdb?: number, imdb?: string }
}

interface TraktItem {
  type?: string
  id?: unknown
  action?: string
  rating?: number
  rated_at?: string
  listed_at?: string
  watched_at?: unknown
  last_watched_at?: unknown
  plays?: unknown
  movie?: TraktMedia
  show?: TraktMedia
  episode?: { season?: unknown, number?: unknown }
  rewatch?: unknown
  notes?: unknown
  note?: unknown
  viewing_context?: unknown
}

function traktEventId(value: unknown) {
  const id
    = typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : value
  return typeof id === 'string'
    && /^[1-9]\d{0,18}$/.test(id)
    && (id.length < 19 || id <= '9223372036854775807')
    ? id
    : undefined
}

function isCoordinate(value: unknown, minimum: number): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum
  )
}

function traktCoordinates(item: TraktItem) {
  if (item.type !== 'episode')
    return { season: 0, episode: 0 }
  const { season, number } = item.episode ?? {}
  if (isCoordinate(season, 0) && isCoordinate(number, 1))
    return { season, episode: number }
}

function traktDate(value: unknown): ViewingDate | undefined {
  if (value == null)
    return UNKNOWN_VIEW
  if (typeof value !== 'string' || !INSTANT.safeParse(value).success)
    return undefined
  const time = Date.parse(value)
  if (Number.isFinite(time)) {
    return {
      precision: 'instant',
      instant: new Date(time).toISOString(),
      day: null,
    }
  }
}

function traktRows(
  name: string,
  items: unknown[],
  occurrences: Map<string, number>,
): Parsed {
  const entries: ImportEntry[] = []
  let skipped = 0
  const watchlist = isWatchlistName(name)
  const historyFile = TRAKT_HISTORY_FILE.test(baseName(name))
  const watchedFile = TRAKT_WATCHED_FILE.test(baseName(name))

  for (const raw of items) {
    if (typeof raw !== 'object' || raw === null) {
      skipped++
      continue
    }
    const item = raw as TraktItem
    const rating = tenPoint(item.rating)
    const aggregate
      = Object.hasOwn(item, 'plays') || Object.hasOwn(item, 'last_watched_at')
    const event
      = !aggregate
        && (Object.hasOwn(item, 'watched_at')
          || (!!item.action && TRAKT_HISTORY_ACTIONS.has(item.action))
          || (historyFile
            && item.id != null
            && rating === undefined
            && !item.rated_at
            && !item.listed_at))
    const movie
      = item.type === 'movie'
        || (aggregate && item.type === undefined && !!item.movie)
    const series
      = item.type === 'show'
        || item.type === 'episode'
        || (aggregate && item.type === undefined && !!item.show)
    const media = movie ? item.movie : series ? item.show : undefined
    const title = typeof media?.title === 'string' ? media.title.trim() : ''
    const kind = movie ? ('movie' as const) : ('series' as const)
    const year = yearOf(media?.year)
    const tmdbId = tmdbIdOf(media?.ids?.tmdb)
    const imdbId = imdbIdOf(media?.ids?.imdb)

    if (!media || (!title && !tmdbId && !imdbId)) {
      skipped++
      continue
    }
    const base = {
      source: 'trakt' as const,
      title,
      year,
      kind,
      tmdbId,
      imdbId,
    }

    if (aggregate) {
      const coordinates = traktCoordinates(item)
      const hasPlays = isCoordinate(item.plays, 1)
      const validPlays = item.plays === undefined || hasPlays
      const hasLastWatch
        = typeof item.last_watched_at === 'string'
          && INSTANT.safeParse(item.last_watched_at).success
      if (
        !coordinates
        || !validPlays
        || (!hasPlays && !hasLastWatch && !watchedFile)
      ) {
        skipped++
        continue
      }

      entries.push({
        ...base,
        list: 'history',
        viewing: { kind: 'seen', ...coordinates },
      })
    }
    else if (event) {
      const coordinates = traktCoordinates(item)
      const date = traktDate(item.watched_at)
      const id = traktEventId(item.id)
      const note = ownText(item.notes ?? item.note, MAX_NOTE)
      const viewingContext = ownText(item.viewing_context, 1000)
      if (
        (item.type !== 'movie' && item.type !== 'episode')
        || !coordinates
        || !date
        || (item.id != null && !id)
        || note === undefined
        || viewingContext === undefined
      ) {
        skipped++
        continue
      }
      const titleIdentity = tmdbId
        ?? imdbId ?? [title.normalize('NFC').toLowerCase(), year]
      const key = digest([
        kind,
        titleIdentity,
        coordinates.season,
        coordinates.episode,
        date,
      ])
      entries.push({
        ...base,
        list: 'history',
        viewing: {
          kind: 'entry',
          ...coordinates,
          origin: 'trakt',
          originKey: id ? `id:${id}` : nextOccurrence(occurrences, key),
          date,
          rewatch: item.rewatch === true,
          note,
          viewingContext,
        },
      })
    }
    else if (item.type === 'episode') {
      skipped++
    }
    else if (rating) {
      entries.push({
        ...base,
        list: 'rating',
        rating,
        at: dateOf(item.rated_at),
      })
    }
    else if (watchlist) {
      entries.push({ ...base, list: 'watchlist', at: dateOf(item.listed_at) })
    }
    else {
      skipped++
    }
  }

  return { entries, skipped }
}

const torsherImport = z
  .object({
    format: z.literal('torsher-import'),
    version: z.literal(1),
    entries: z.array(
      z
        .object({
          list: z.literal('watched'),
          title: z.string().trim().min(1).max(500),
          kind: z.enum(['movie', 'series']),
          originalTitle: z.string().trim().min(1).max(500).optional(),
          year: z.number().int().min(1870).max(2100).optional(),
          tmdbId: z.number().int().positive().optional(),
          imdbId: z.string().regex(IMDB_ID).optional(),
        })
        .strict(),
    ),
  })
  .strict()

function parseJson(
  name: string,
  text: string,
  occurrences = new Map<string, number>(),
): Parsed {
  let value: unknown

  try {
    value = JSON.parse(
      text,
      (key: string, raw: unknown, context?: { source?: string }) =>
        // JSON numbers above MAX_SAFE_INTEGER are rounded before the reviver.
        // Node 24 also exposes the original digits of the history ID.
        key === 'id' && typeof raw === 'number' && !Number.isSafeInteger(raw)
          ? (context?.source ?? raw)
          : raw,
    )
  }
  catch {
    throw new ImportFormatError('broken', name)
  }

  if (
    typeof value === 'object'
    && value !== null
    && 'format' in value
    && value.format === 'torsher-import'
  ) {
    if (
      'version' in value
      && typeof value.version === 'number'
      && value.version > 1
    ) {
      throw new ImportFormatError('newerVersion', name)
    }

    const parsed = torsherImport.safeParse(value)

    if (!parsed.success)
      throw new ImportFormatError('broken', name)

    if (parsed.data.entries.length > MAX_IMPORT_ROWS)
      throw new ImportFormatError('tooMany', name)

    return {
      entries: parsed.data.entries.map(entry => ({
        ...entry,
        source: 'torsher' as const,
      })),
      skipped: 0,
    }
  }

  if (!Array.isArray(value))
    throw new ImportFormatError('unsupported', name)

  return traktRows(name, value, occurrences)
}

function parseCsvFile(name: string, text: string): Parsed {
  const { columns, records } = csvRecords(text)

  if (hasColumn(columns, 'Const'))
    return imdbRows(name, records)

  if (hasColumn(columns, 'Letterboxd URI') && hasColumn(columns, 'Name'))
    return letterboxdRows(name, columns, records)

  if (['tmdbID', 'imdbID', 'Title'].some(item => hasColumn(columns, item)))
    return importFormatRows(name, records)

  throw new ImportFormatError('unsupported', name)
}

/**
 * Letterboxd keeps deleted files and lists in subfolders. Read only the
 * root files (optionally in a Letterboxd export wrapper). For Trakt read
 * recognised archive fixtures by name but
 * never walk deleted/archived records or list directories.
 */
function acceptsArchived(name: string) {
  const parts = name.toLowerCase().split('/')
  if (
    name.includes('\\')
    || parts.some(
      part =>
        !part
        || ['.', '..', 'deleted', 'orphaned', 'likes', 'lists'].includes(part),
    )
  ) {
    return false
  }

  const base = parts.at(-1)!
  if (base.endsWith('.csv')) {
    const root
      = parts.length === 1
        || (parts.length === 2 && /^letterboxd[-_][a-z0-9_.-]+$/.test(parts[0]!))
    return (
      root
      && (['ratings.csv', 'watchlist.csv', 'diary.csv', 'watched.csv'].includes(
        base,
      )
      || LETTERBOXD_REVIEWS_FILE.test(base))
    )
  }

  return (
    TRAKT_HISTORY_FILE.test(base)
    || TRAKT_WATCHED_FILE.test(base)
    || /^(?:ratings-(?:movies|shows)|(?:lists-)?watchlist)(?:-\d+)?\.json$/.test(
      base,
    )
  )
}

function attachReviews(entries: ImportEntry[], reviews: Review[]) {
  const candidates = new Map<
    string,
    Extract<ImportedViewing, { kind: 'entry' }>[]
  >()
  for (const { reviewKey, viewing } of entries) {
    if (!reviewKey || viewing?.kind !== 'entry')
      continue
    const matches = candidates.get(reviewKey) ?? []
    matches.push(viewing)
    candidates.set(reviewKey, matches)
  }

  const byKey = new Map<string, Set<string>>()
  for (const { key, note } of reviews) {
    const notes = byKey.get(key) ?? new Set()
    notes.add(note)
    byKey.set(key, notes)
  }
  let skipped = 0
  for (const [key, notes] of byKey) {
    const matches = candidates.get(key)
    if (
      !matches
      || new Set(matches.map(row => row.originKey)).size !== 1
      || notes.size !== 1
    ) {
      skipped += notes.size
      continue
    }
    let overflow = false
    for (const viewing of matches) {
      const combined = appendNote(viewing.note, notes.values().next().value!)
      if (combined === undefined)
        overflow = true
      else viewing.note = combined
    }
    if (overflow)
      skipped++
  }
  return skipped
}

interface ImportPart {
  file: ImportFile
  historyOccurrences?: Map<string, number>
}

function archiveParts(files: ImportFile[]): ImportPart[] {
  const ordered: ImportPart[] = files.map(file => ({ file }))
  const groups = new Map<
    string,
    {
      pages: Array<{ file: ImportFile, index: number, page: number }>
      numbers: Set<number>
    }
  >()
  for (const [index, file] of files.entries()) {
    const match = /^(.*\/)?(history|watched-history)-(\d+)\.json$/.exec(
      file.name.toLowerCase(),
    )
    if (!match)
      continue
    const page = Number(match[3])
    if (!Number.isSafeInteger(page))
      continue

    const key = (match[1] ?? '') + match[2]!
    const group = groups.get(key) ?? { pages: [], numbers: new Set<number>() }
    // Alternate names for the same page aren't evidence of another dataset page.
    if (group.numbers.has(page))
      continue
    group.numbers.add(page)
    group.pages.push({ file, index, page })
    groups.set(key, group)
  }

  for (const { pages } of groups.values()) {
    // One archive family is an explicit dataset boundary. Keep unrelated
    // files in place and let numbered pages share the same row ordinals.
    const indices = pages.map(row => row.index)
    const historyOccurrences = new Map<string, number>()
    pages.sort(
      (a, b) => a.page - b.page || a.file.name.localeCompare(b.file.name),
    )
    for (const [offset, page] of pages.entries())
      ordered[indices[offset]!] = { file: page.file, historyOccurrences }
  }
  return ordered
}

/** Разбор всех загруженных файлов; zip раскрывается в свои файлы */
export function parseImportFiles(files: ImportFile[]) {
  const total = files.reduce((sum, file) => sum + file.data.length, 0)

  if (total > MAX_IMPORT_BYTES)
    throw new ImportFormatError('tooLarge')

  const plain: ImportPart[] = []
  let unpackedBytes = 0

  for (const file of files) {
    let parts: ImportPart[]
    try {
      parts = isZip(file.data)
        ? archiveParts(
            readZip(
              file.data,
              acceptsArchived,
              MAX_IMPORT_BYTES - unpackedBytes,
            ),
          )
        : [{ file }]
    }
    catch (err) {
      if (err instanceof ZipError)
        throw new ImportFormatError('broken', file.name)

      throw err
    }

    for (const part of parts) {
      unpackedBytes += part.file.data.length
      if (unpackedBytes > MAX_IMPORT_BYTES)
        throw new ImportFormatError('tooLarge')
      plain.push(part)
    }
  }

  const entries: ImportEntry[] = []
  const reviews: Review[] = []
  let skipped = 0

  for (const { file, historyOccurrences } of plain) {
    const text = file.data.toString('utf8')
    const parsed = /^\s*[[{]/.test(text)
      ? parseJson(file.name, text, historyOccurrences)
      : parseCsvFile(file.name, text)

    if (
      entries.length
      + parsed.entries.length
      + reviews.length
      + (parsed.reviews?.length ?? 0)
      > MAX_IMPORT_ROWS
    ) {
      throw new ImportFormatError('tooMany')
    }

    entries.push(...parsed.entries)
    reviews.push(...(parsed.reviews ?? []))
    skipped += parsed.skipped
  }

  if (entries.length === 0)
    throw new ImportFormatError('empty')

  return {
    entries,
    skipped: skipped + attachReviews(entries, reviews),
    sources: [...new Set(entries.map(entry => entry.source))],
  }
}
