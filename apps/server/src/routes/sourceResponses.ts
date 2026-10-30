import type { FastifyReply } from 'fastify'
import type {
  IndexerWithManager,
  ManagerWithCounts,
  SyncResult,
} from '../services/indexers/index.ts'
import { feedProbeAt } from '../services/follow/feed.ts'
import { logFor } from '../services/logs/index.ts'
import { isLoopbackHostname, isMdnsHostname } from '../services/net/address.ts'
import { SourceError } from '../services/torznab/index.ts'

// Наружу — явно собранный объект: шифртекст ключа в ответ не попадает
export function toIndexerResponse(indexer: IndexerWithManager) {
  return {
    id: indexer.id,
    name: indexer.name,
    url: indexer.url,
    hasApiKey: indexer.apiKey !== null,
    enabled: indexer.enabled,
    managerId: indexer.managerId,
    managerKind: indexer.managerKind,
    missing: indexer.missing,
    categories: (indexer.caps?.categories ?? []).map(({ id, name }) => ({
      id,
      name,
    })),
    searchModes: indexer.caps
      ? {
          search: indexer.caps.search.available,
          tvSearch: indexer.caps.tvSearch.available,
          movieSearch: indexer.caps.movieSearch.available,
        }
      : null,
    checkStatus: indexer.checkStatus,
    checkedAt: indexer.checkedAt?.toISOString() ?? null,
    feed: {
      supported: indexer.supportsRss,
      checkedAt: indexer.rssCheckedAt?.toISOString() ?? null,
      probeAt: feedProbeAt(indexer)?.toISOString() ?? null,
    },
  }
}

export function toManagerResponse(manager: ManagerWithCounts) {
  return {
    id: manager.id,
    kind: manager.kind,
    url: manager.url,
    syncedAt: manager.syncedAt?.toISOString() ?? null,
    indexerCount: manager.indexerCount,
    missingCount: manager.missingCount,
  }
}

export function toSyncResponse(result: SyncResult) {
  return {
    manager: toManagerResponse(result.manager),
    added: result.added,
    updated: result.updated,
    missing: result.missing,
  }
}

// Адрес не ответил: если это сам сервер или имя mDNS, панель объясняет
// именно это, а не просит проверить адрес. Если такой адрес работает
// (Torsher без Docker, `network_mode: host`), до ошибки дело не доходит
function errorKindFor(err: SourceError, url?: string) {
  if (!url || (err.kind !== 'unreachable' && err.kind !== 'timeout'))
    return err.kind

  const { hostname } = new URL(url)

  if (isLoopbackHostname(hostname))
    return 'loopback'

  if (isMdnsHostname(hostname))
    return 'mdns'

  return err.kind
}

/**
 * Проверка источника не прошла — 422 с видом ошибки для понятного текста
 * в панели. `url` — адрес, который ввёл пользователь.
 */
export function sendSourceError(
  reply: FastifyReply,
  err: unknown,
  url?: string,
) {
  if (!(err instanceof SourceError))
    throw err

  return reply
    .code(422)
    .send({ message: err.message, kind: errorKindFor(err, url) })
}

export function logCheckError(err: unknown) {
  logFor('sources').error({ err }, 'Indexer check failed')
}
