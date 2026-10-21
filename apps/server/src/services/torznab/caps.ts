import type { XmlNode } from './xml.ts'
import { child, children, text } from './xml.ts'

export interface TorznabSearchMode {
  available: boolean
  /** `supportedParams`: q, season, ep, imdbid, tvdbid, ... */
  params: string[]
}

export interface TorznabCategory {
  id: number
  name: string
  subcategories: { id: number, name: string }[]
}

/** То, что поиску раздач нужно знать об индексаторе из ответа `t=caps` */
export interface TorznabCaps {
  search: TorznabSearchMode
  tvSearch: TorznabSearchMode
  movieSearch: TorznabSearchMode
  categories: TorznabCategory[]
}

function searchMode(
  searching: XmlNode | undefined,
  name: string,
): TorznabSearchMode {
  const node = child(searching, name)
  const params = (text(node, 'supportedParams') ?? '')
    .split(',')
    .map(param => param.trim().toLowerCase())
    .filter(Boolean)

  return {
    available: text(node, 'available')?.toLowerCase() === 'yes',
    params,
  }
}

function category(node: XmlNode) {
  const id = Number(text(node, 'id'))
  const name = text(node, 'name')?.trim() ?? ''

  return Number.isInteger(id) && name ? { id, name } : undefined
}

/**
 * Разбирает элемент `<caps>`: из ответа `t=caps` или из списка индексаторов
 * менеджера, где caps вложены в каждый индексатор. `undefined` — это не caps.
 */
export function parseCaps(caps: XmlNode | undefined): TorznabCaps | undefined {
  const searching = child(caps, 'searching')

  if (!caps || !searching)
    return undefined

  const categories = children(child(caps, 'categories'), 'category').flatMap(
    (node) => {
      const parent = category(node)

      if (!parent)
        return []

      const subcategories = children(node, 'subcat').flatMap(
        sub => category(sub) ?? [],
      )

      return [{ ...parent, subcategories }]
    },
  )

  return {
    search: searchMode(searching, 'search'),
    tvSearch: searchMode(searching, 'tv-search'),
    movieSearch: searchMode(searching, 'movie-search'),
    categories,
  }
}
