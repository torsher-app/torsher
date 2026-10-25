import type { FastifyReply } from 'fastify'
import type {
  IndexerWithManager,
  ManagerWithCounts,
  SyncResult,
} from '../services/indexers/index.ts'
import { feedProbeAt } from '../services/follow/feed.ts'
import { logFor } from '../services/logs/index.ts'
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

/** Проверка источника не прошла — 422 с видом ошибки для понятного текста в панели */
export function sendSourceError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof SourceError))
    throw err

  return reply.code(422).send({ message: err.message, kind: err.kind })
}

export function logCheckError(err: unknown) {
  logFor('sources').error({ err }, 'Indexer check failed')
}
