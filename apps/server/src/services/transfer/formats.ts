import type { Buffer } from 'node:buffer'
import { csvRecords } from './csv.ts'
import { isZip, readZip, ZipError } from './zip.ts'

export const importSources = ['imdb', 'letterboxd', 'trakt'] as const

export type ImportSource = (typeof importSources)[number]
export type ImportList = 'rating' | 'watchlist'
export type ImportKind = 'movie' | 'series'

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
}

export interface ImportFile {
  name: string
  data: Buffer
}

export const MAX_IMPORT_BYTES = 20 * 1024 * 1024
export const MAX_IMPORT_ROWS = 20_000

export type ImportFormatErrorKind
  = 'unsupported' | 'broken' | 'tooLarge' | 'tooMany' | 'empty'

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

  return Number.isInteger(id) && id > 0 ? id : undefined
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

interface Parsed {
  entries: ImportEntry[]
  skipped: number
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
  let skipped = 0
  const watchlist = !hasColumn(columns, 'Rating') && isWatchlistName(name)

  for (const record of records) {
    const title = record.Name ?? ''

    if (!title) {
      skipped++
      continue
    }

    const base = {
      source: 'letterboxd' as const,
      title,
      year: yearOf(record.Year),
      kind: 'movie' as const,
    }

    if (watchlist) {
      entries.push({ ...base, list: 'watchlist', at: dateOf(record.Date) })
      continue
    }

    const rating = fivePoint(record.Rating)

    if (rating) {
      entries.push({
        ...base,
        list: 'rating',
        rating,
        at: dateOf(record['Watched Date']) ?? dateOf(record.Date),
      })
    }
    else {
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
  rating?: number
  rated_at?: string
  listed_at?: string
  movie?: TraktMedia
  show?: TraktMedia
}

function traktRows(name: string, items: unknown[]): Parsed {
  const entries: ImportEntry[] = []
  let skipped = 0
  const watchlist = isWatchlistName(name)

  for (const raw of items) {
    const item = raw as TraktItem
    const media
      = item?.type === 'movie'
        ? item.movie
        : item?.type === 'show'
          ? item.show
          : undefined

    if (!media) {
      skipped++
      continue
    }

    const base = {
      source: 'trakt' as const,
      title: media.title ?? '',
      year: yearOf(media.year),
      kind: item.type === 'movie' ? ('movie' as const) : ('series' as const),
      tmdbId: tmdbIdOf(media.ids?.tmdb),
      imdbId: imdbIdOf(media.ids?.imdb),
    }
    const rating = tenPoint(item.rating)

    if (rating) {
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

function parseJson(name: string, text: string): Parsed {
  let value: unknown

  try {
    value = JSON.parse(text)
  }
  catch {
    throw new ImportFormatError('broken', name)
  }

  if (!Array.isArray(value))
    throw new ImportFormatError('unsupported', name)

  return traktRows(name, value)
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
 * Файлы внутри архива сервиса, которые читаем; остальное (история, отзывы,
 * лайки, удалённое) пропускаем молча. У Letterboxd в подкаталогах лежат
 * удалённые записи с теми же именами, поэтому берём только корень.
 */
function acceptsArchived(name: string) {
  const base = baseName(name)

  if (base.endsWith('.csv')) {
    return (
      !name.includes('/') && ['ratings.csv', 'watchlist.csv'].includes(base)
    )
  }

  return /^(?:ratings-(?:movies|shows)|(?:lists-)?watchlist)(?:-\d+)?\.json$/.test(
    base,
  )
}

/** Разбор всех загруженных файлов; zip раскрывается в свои файлы */
export function parseImportFiles(files: ImportFile[]) {
  const total = files.reduce((sum, file) => sum + file.data.length, 0)

  if (total > MAX_IMPORT_BYTES)
    throw new ImportFormatError('tooLarge')

  const plain: ImportFile[] = []

  for (const file of files) {
    if (!isZip(file.data)) {
      plain.push(file)
      continue
    }

    try {
      plain.push(...readZip(file.data, acceptsArchived, MAX_IMPORT_BYTES))
    }
    catch (err) {
      if (err instanceof ZipError)
        throw new ImportFormatError('broken', file.name)

      throw err
    }
  }

  const entries: ImportEntry[] = []
  let skipped = 0

  for (const file of plain) {
    const text = file.data.toString('utf8')
    const parsed = /^\s*[[{]/.test(text)
      ? parseJson(file.name, text)
      : parseCsvFile(file.name, text)

    entries.push(...parsed.entries)
    skipped += parsed.skipped

    if (entries.length > MAX_IMPORT_ROWS)
      throw new ImportFormatError('tooMany')
  }

  if (entries.length === 0)
    throw new ImportFormatError('empty')

  return {
    entries,
    skipped,
    sources: [...new Set(entries.map(entry => entry.source))],
  }
}
