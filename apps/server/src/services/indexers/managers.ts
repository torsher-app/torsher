import type { IndexerManagerKind } from '../../db/schema.ts'
import type { TorznabCaps } from '../torznab/index.ts'
import {
  child,
  children,
  parseCaps,
  readBody,
  readTorznabXml,
  SourceError,
  sourceGet,
  text,
  torznabRequestUrl,
} from '../torznab/index.ts'

/** Индексатор, настроенный в менеджере, в виде Torznab-источника */
export interface RemoteIndexer {
  externalId: string
  name: string
  /** Torznab-адрес индексатора у менеджера, без `/api` */
  url: string
  enabled: boolean
  /** Если менеджер отдаёт возможности вместе со списком */
  caps?: TorznabCaps
  /** Prowlarr знает, читается ли у индексатора лента; Jackett — нет */
  supportsRss?: boolean
  priority?: number
}

/**
 * Адрес менеджера без хвостового слеша, query и hash; путь (URL base)
 * сохраняется. У Jackett адрес копируют из браузера (`/UI/Dashboard`) или
 * кнопкой Torznab-ленты (`/api/v2.0/...`): URL base — то, что перед ними.
 */
export function normalizeManagerUrl(input: string, kind: IndexerManagerKind) {
  const url = new URL(input)

  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')

  if (kind === 'jackett')
    url.pathname = url.pathname.replace(/\/(?:UI|api\/v2\.0)(?:\/.*)?$/i, '')

  return url.href.replace(/\/+$/, '')
}

function notFound(kind: IndexerManagerKind): never {
  throw new SourceError(
    'unsupported',
    `The address does not expose the ${kind} API or this version is not supported`,
  )
}

/**
 * Список — `GET /api/v1/indexer` с ключом в `X-Api-Key`; Torznab индексатора —
 * `/{id}/api`. Usenet-индексаторы пропускаем: раздачи только из торрентов.
 */
async function listProwlarr(baseUrl: string, apiKey: string) {
  const res = await sourceGet(new URL(`${baseUrl}/api/v1/indexer`), {
    'X-Api-Key': apiKey,
    'Accept': 'application/json',
  })

  if (res.status === 401 || res.status === 403)
    throw new SourceError('auth', 'Manager rejected the API key')

  if (res.status === 404)
    notFound('prowlarr')

  if (!res.ok)
    throw new SourceError('remote', `Manager responded with ${res.status}`)

  let list: unknown

  try {
    list = JSON.parse(await readBody(res))
  }
  catch (err) {
    if (err instanceof SourceError)
      throw err

    throw new SourceError('bad_response', 'Manager response is not JSON', {
      cause: err,
    })
  }

  if (!Array.isArray(list))
    notFound('prowlarr')

  return list.flatMap((item): RemoteIndexer[] => {
    if (typeof item !== 'object' || item === null)
      return []

    const { id, name, protocol, enable, supportsRss, priority }
      = item as Record<string, unknown>

    // Перечисление приходит строкой, у старых версий — числом (2 — torrent)
    if (protocol !== 'torrent' && protocol !== 2)
      return []

    if (typeof id !== 'number' || typeof name !== 'string')
      return []

    return [
      {
        externalId: String(id),
        name,
        url: `${baseUrl}/${id}`,
        enabled: enable !== false,
        ...(typeof supportsRss === 'boolean' && { supportsRss }),
        ...(typeof priority === 'number'
          && Number.isInteger(priority) && { priority }),
      },
    ]
  })
}

/**
 * Список настроенных индексаторов отдаёт агрегатор `all` запросом
 * `t=indexers&configured=true` с ключом в `apikey`, вместе с caps каждого.
 * Torznab индексатора — `/api/v2.0/indexers/{id}/results/torznab/api`.
 */
async function listJackett(baseUrl: string, apiKey: string) {
  const res = await sourceGet(
    torznabRequestUrl(
      `${baseUrl}/api/v2.0/indexers/all/results/torznab`,
      { t: 'indexers', configured: 'true' },
      apiKey,
    ),
  )

  if (res.status === 404)
    notFound('jackett')

  const xml = await readTorznabXml(res)

  // Jackett без настроенных индексаторов отвечает `<indexers />`, а пустой
  // элемент парсер отдаёт строкой, не объектом
  if (!('indexers' in xml))
    notFound('jackett')

  return children(child(xml, 'indexers'), 'indexer').flatMap(
    (node): RemoteIndexer[] => {
      const id = text(node, 'id')
      const name = text(node, 'title')?.trim()

      if (!id || !name || text(node, 'configured')?.toLowerCase() === 'false')
        return []

      return [
        {
          externalId: id,
          name,
          url: `${baseUrl}/api/v2.0/indexers/${encodeURIComponent(id)}/results/torznab`,
          enabled: true,
          caps: parseCaps(child(node, 'caps')),
        },
      ]
    },
  )
}

export function listManagerIndexers(
  kind: IndexerManagerKind,
  baseUrl: string,
  apiKey: string,
): Promise<RemoteIndexer[]> {
  return kind === 'prowlarr'
    ? listProwlarr(baseUrl, apiKey)
    : listJackett(baseUrl, apiKey)
}
