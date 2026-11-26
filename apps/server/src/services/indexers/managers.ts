import type {
  Indexer,
  IndexerManagerKind,
  IndexerProtocol,
} from '../../db/schema.ts'
import { trustedHttpRequest } from '../net/trustedHttp.ts'
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
  protocol?: IndexerProtocol
  name: string
  /** Torznab-адрес индексатора у менеджера, без `/api` */
  url: string
  enabled: boolean
  /** Если менеджер отдаёт возможности вместе со списком */
  caps?: TorznabCaps
  /** Prowlarr знает, читается ли у индексатора лента; Jackett — нет */
  supportsRss?: boolean
  priority?: number
  knownPrivacy?: Indexer['knownPrivacy']
  minSeedRatio?: number
  minSeedTimeMinutes?: number
}

function privacyOf(value: unknown): Indexer['knownPrivacy'] {
  if (typeof value !== 'string')
    return null
  switch (value.trim().toLowerCase()) {
    case 'public':
      return 'public'
    case 'semiprivate':
    case 'semi-private':
    case 'semi_private':
      return 'semi_private'
    case 'private':
      return 'private'
    default:
      return null
  }
}

function positiveNumber(value: unknown) {
  const number
    = typeof value === 'number' || typeof value === 'string'
      ? Number(value)
      : NaN
  return Number.isFinite(number) && number > 0 ? number : undefined
}

/**
 * Адрес менеджера без хвостового слеша, query и hash; путь (URL base)
 * сохраняется. Адрес копируют из браузера с любой страницы интерфейса или
 * Torznab-адрес индексатора: у Jackett — `/UI/Dashboard` и `/api/v2.0/...`,
 * у Prowlarr — маршруты интерфейса, `/{id}/api` и `/api/v1/...`. URL base —
 * то, что перед ними, поэтому отрезаются только известные маршруты.
 */
export function normalizeManagerUrl(input: string, kind: IndexerManagerKind) {
  const url = new URL(input)

  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/+$/, '')

  if (kind === 'jackett')
    url.pathname = url.pathname.replace(/\/(?:UI|api\/v2\.0)(?:\/.*)?$/i, '')

  if (kind === 'prowlarr') {
    url.pathname = url.pathname.replace(
      /\/(?:indexers|search|history|settings|system|login|api|\d+\/(?:api|download))(?:\/.*)?$/i,
      '',
    )
  }

  return url.href.replace(/\/+$/, '')
}

function notFound(kind: IndexerManagerKind, status: number): never {
  throw new SourceError(
    'unsupported',
    `The address does not expose the ${kind} API or this version is not supported`,
    { status },
  )
}

async function parseProwlarrList(res: Response) {
  if (res.status === 401 || res.status === 403) {
    throw new SourceError('auth', 'Manager rejected the API key', {
      status: res.status,
    })
  }
  if (res.status === 404)
    notFound('prowlarr', res.status)
  if (!res.ok) {
    throw new SourceError('remote', `Manager responded with ${res.status}`, {
      status: res.status,
    })
  }

  let list: unknown
  try {
    list = JSON.parse(await readBody(res))
  }
  catch (err) {
    if (err instanceof SourceError)
      throw err
    throw new SourceError('bad_response', 'Manager response is not JSON', {
      status: res.status,
    })
  }
  if (!Array.isArray(list))
    notFound('prowlarr', res.status)
  return list as unknown[]
}

/** Managing Newznab sources requires explicit opt-in and pinned transport. */
async function listProwlarr(
  baseUrl: string,
  apiKey: string,
  newznab?: string[],
) {
  const url = new URL(`${baseUrl}/api/v1/indexer`)
  const headers = { 'X-Api-Key': apiKey, 'Accept': 'application/json' }
  let list: unknown[]
  if (newznab === undefined) {
    list = await parseProwlarrList(await sourceGet(url, headers))
  }
  else {
    try {
      const request = await trustedHttpRequest(
        url,
        { origin: url.origin, lanAddresses: newznab },
        { headers },
      )
      try {
        list = await parseProwlarrList(request.response)
      }
      finally {
        await request.close()
      }
    }
    catch (error) {
      if (error instanceof SourceError)
        throw error
      throw new SourceError(
        'unreachable',
        'Manager connection was not verified',
      )
    }
  }

  return list.flatMap((item): RemoteIndexer[] => {
    if (typeof item !== 'object' || item === null)
      return []

    const {
      id,
      name,
      protocol,
      enable,
      supportsRss,
      priority,
      privacy,
      fields,
    } = item as Record<string, unknown>

    const sourceProtocol
      = protocol === 'torrent' || protocol === 2
        ? 'torznab'
        : protocol === 'usenet' && newznab !== undefined
          ? 'newznab'
          : undefined
    if (!sourceProtocol)
      return []

    if (
      typeof id !== 'number'
      || !Number.isSafeInteger(id)
      || id < 1
      || typeof name !== 'string'
    ) {
      return []
    }

    const values = new Map<string, unknown>()
    if (Array.isArray(fields)) {
      for (const field of fields) {
        if (
          field
          && typeof field === 'object'
          && typeof field.name === 'string'
        ) {
          values.set(field.name, field.value)
        }
      }
    }
    const seedTime = positiveNumber(
      values.get('torrentBaseSettings.seedTime') ?? values.get('seedTime'),
    )
    const seedRatio = positiveNumber(
      values.get('torrentBaseSettings.seedRatio') ?? values.get('seedRatio'),
    )
    const knownPrivacy = privacyOf(privacy)

    return [
      {
        externalId: String(id),
        ...(sourceProtocol === 'newznab' && { protocol: sourceProtocol }),
        name,
        url: `${baseUrl}/${id}`,
        enabled: enable !== false,
        ...(knownPrivacy && { knownPrivacy }),
        ...(sourceProtocol === 'torznab'
          && seedRatio !== undefined && { minSeedRatio: seedRatio }),
        ...(sourceProtocol === 'torznab'
          && seedTime !== undefined && {
          minSeedTimeMinutes: Math.ceil(seedTime),
        }),
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
    notFound('jackett', res.status)

  const xml = await readTorznabXml(res)

  // Jackett без настроенных индексаторов отвечает `<indexers />`, а пустой
  // элемент парсер отдаёт строкой, не объектом
  if (!('indexers' in xml))
    notFound('jackett', res.status)

  return children(child(xml, 'indexers'), 'indexer').flatMap(
    (node): RemoteIndexer[] => {
      const id = text(node, 'id')
      const name = text(node, 'title')?.trim()
      const knownPrivacy = privacyOf(text(node, 'type'))

      if (!id || !name || text(node, 'configured')?.toLowerCase() === 'false')
        return []

      return [
        {
          externalId: id,
          name,
          url: `${baseUrl}/api/v2.0/indexers/${encodeURIComponent(id)}/results/torznab`,
          enabled: true,
          ...(knownPrivacy && { knownPrivacy }),
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
  newznab?: string[],
): Promise<RemoteIndexer[]> {
  return kind === 'prowlarr'
    ? listProwlarr(baseUrl, apiKey, newznab)
    : listJackett(baseUrl, apiKey)
}
