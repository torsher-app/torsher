import type { TorznabCaps, TorznabSearchMode } from './caps.ts'
import type { XmlNode } from './xml.ts'
import { readTorznabXml, sourceGet, torznabRequestUrl } from './client.ts'
import { child, children, text } from './xml.ts'

export interface SearchIds {
  /** С префиксом `tt`, как в TMDB. */
  imdb?: string
  tmdb?: number
  tvdb?: number
}

export interface SearchQuery {
  kind: 'movie' | 'series'
  ids: SearchIds
  /** Названия для текстового поиска, уже без повторов. */
  titles: string[]
  year?: number
  season?: number
}

export type SearchParams = Record<string, string>

/** Раздача из ответа поиска Torznab */
export interface TorznabRelease {
  title: string
  guid?: string
  /**
   * Страница раздачи на трекере из `<comments>` (у Jackett — `Details`,
   * у Prowlarr — `InfoUrl`), без неё — `guid`, если это адрес страницы: по
   * ней узнаётся обновлённая тема.
   */
  detailsUrl?: string
  /** Ссылка на `.torrent` у индексатора; в ней бывает API-ключ. */
  link?: string
  magnet?: string
  /** Нижний регистр, hex. */
  infoHash?: string
  size?: number
  seeders?: number
  peers?: number
  publishedAt?: Date
  categories: number[]
}

function supports(mode: TorznabSearchMode, param: string) {
  return mode.available && mode.params.includes(param)
}

// Режим, объявленный без supportedParams, текст всё равно принимает
function supportsText(mode: TorznabSearchMode) {
  return (
    mode.available && (mode.params.length === 0 || mode.params.includes('q'))
  )
}

function idParams(
  caps: TorznabCaps,
  query: SearchQuery,
): SearchParams | undefined {
  const { ids } = query

  if (query.kind === 'movie') {
    const mode = caps.movieSearch

    if (ids.tmdb && supports(mode, 'tmdbid'))
      return { t: 'movie', tmdbid: String(ids.tmdb) }

    // Для фильмов Newznab ждёт номер IMDb без `tt`
    if (ids.imdb && supports(mode, 'imdbid'))
      return { t: 'movie', imdbid: ids.imdb.replace(/^tt/, '') }

    return undefined
  }

  const mode = caps.tvSearch
  let params: SearchParams | undefined

  if (ids.tvdb && supports(mode, 'tvdbid'))
    params = { t: 'tvsearch', tvdbid: String(ids.tvdb) }
  else if (ids.imdb && supports(mode, 'imdbid'))
    params = { t: 'tvsearch', imdbid: ids.imdb }
  else if (ids.tmdb && supports(mode, 'tmdbid'))
    params = { t: 'tvsearch', tmdbid: String(ids.tmdb) }

  if (params && query.season !== undefined && supports(mode, 'season'))
    params.season = String(query.season)

  return params
}

/**
 * Запросы к одному индексатору по его caps: сначала по ID, если режим это
 * умеет, затем по каждому названию текстом. Текст нужен всегда: многие
 * индексаторы ID не понимают или знают не все раздачи по ID. Сезон в текстовый
 * запрос не добавляется — индексаторы переводят его в `S02`, а в русских
 * названиях сезон пишут словами; лишнее отсеет матчер.
 *
 * Категорию (`cat`) не передаём: многие индексаторы отдают раздачи без
 * стандартных категорий Torznab или со своими, и фильтр по «Фильмам» или «ТВ»
 * отсекает всё. Фильм это или сериал, проверяет матчер по разобранному названию.
 */
export function buildSearchRequests(
  caps: TorznabCaps,
  query: SearchQuery,
): SearchParams[] {
  const requests: SearchParams[] = []
  const byId = idParams(caps, query)

  if (byId)
    requests.push(byId)

  if (supportsText(caps.search)) {
    for (const title of query.titles) {
      const q
        = query.kind === 'movie' && query.year ? `${title} ${query.year}` : title

      requests.push({ t: 'search', q })
    }
  }

  return requests
}

function attributes(item: XmlNode) {
  const attrs = new Map<string, string>()

  for (const attr of children(item, 'torznab:attr')) {
    const name = text(attr, 'name')?.toLowerCase()
    const value = text(attr, 'value')

    if (name && value !== undefined && !attrs.has(name))
      attrs.set(name, value)
  }

  return attrs
}

function toNumber(value: string | undefined) {
  if (value === undefined || value.trim() === '')
    return undefined

  const number = Number(value)

  return Number.isFinite(number) && number >= 0 ? number : undefined
}

function categoriesOf(item: XmlNode, attrs: Map<string, string>) {
  const values = (Array.isArray(item.category) ? item.category : []).map(
    value => (typeof value === 'string' ? value : text(value, '#text')),
  )
  const fromAttr = attrs.get('category')

  if (fromAttr)
    values.push(...fromAttr.split(','))

  return [...new Set(values.map(toNumber))].filter(
    (id): id is number => id !== undefined,
  )
}

function dateOf(value: string | undefined) {
  if (!value)
    return undefined

  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? undefined : date
}

function toRelease(item: XmlNode): TorznabRelease | undefined {
  const title = text(item, 'title')?.trim()

  if (!title)
    return undefined

  const attrs = attributes(item)
  const enclosure = child(item, 'enclosure')
  const links = [text(item, 'link'), text(enclosure, 'url')].filter(
    (value): value is string => !!value?.trim(),
  )
  const magnet
    = attrs.get('magneturl') ?? links.find(link => link.startsWith('magnet:'))
  const link = links.find(value => /^https?:\/\//i.test(value))
  const comments = text(item, 'comments')?.trim()
  const guid = text(item, 'guid')?.trim() || undefined
  // `guid` бывает и ссылкой на `.torrent`: тогда темы по нему не узнать
  const guidPage
    = guid
      && /^https?:\/\//i.test(guid)
      && !links.some(value => value.trim() === guid)
      ? guid
      : undefined
  const infoHash = attrs.get('infohash')?.trim().toLowerCase()
  const seeders = toNumber(attrs.get('seeders'))
  // `peers` в Torznab — сиды вместе с личерами
  const peers = toNumber(attrs.get('peers'))

  return {
    title,
    guid,
    detailsUrl:
      comments && /^https?:\/\//i.test(comments) ? comments : guidPage,
    link,
    magnet,
    infoHash:
      infoHash && /^[0-9a-f]{40}$/.test(infoHash) ? infoHash : undefined,
    size: toNumber(
      attrs.get('size') ?? text(item, 'size') ?? text(enclosure, 'length'),
    ),
    seeders,
    peers,
    publishedAt: dateOf(text(item, 'pubDate')),
    categories: categoriesOf(item, attrs),
  }
}

/** Разбирает ответ поиска: `<rss><channel><item>…` */
export function parseSearchResults(xml: XmlNode): TorznabRelease[] {
  const channel = child(child(xml, 'rss'), 'channel')

  return children(channel, 'item').flatMap(item => toRelease(item) ?? [])
}

/** Один поисковый запрос к индексатору */
export async function searchIndexer(
  baseUrl: string,
  params: SearchParams,
  apiKey?: string,
): Promise<TorznabRelease[]> {
  const res = await sourceGet(
    torznabRequestUrl(baseUrl, { ...params, extended: '1' }, apiKey),
  )

  return parseSearchResults(await readTorznabXml(res))
}
