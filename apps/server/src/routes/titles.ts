import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { RankedRelease, TitleSources } from '../services/sources/index.ts'
import { messageResponse } from '../dto/common.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import {
  pinTitleVoice,
  titleParams,
  titleProgress,
  titleSources,
  titleSourcesQuery,
  titleWatch,
  watchErrorResponse,
  watchTitle as watchTitleBody,
} from '../dto/titles.ts'
import { requireViewer } from '../middleware/auth.ts'
import {
  DEFAULT_PROFILE,
  getTitleSources,
  pinVoice,
} from '../services/sources/index.ts'
import { lastTitleProgress } from '../services/sources/progress.ts'
import { WatchError, watchTitle } from '../services/sources/watch.ts'
import { TmdbError } from '../services/tmdb/index.ts'
import { parseCatalogId } from '../services/tmdb/mappers.ts'
import { isWatched } from '../services/torrents/playback.ts'
import { sendTmdbError } from './catalog.ts'
import { sendEngineError } from './engineResponses.ts'

const guardResponses = {
  401: messageResponse,
}

const tmdbResponses = {
  404: messageResponse,
  502: messageResponse,
  503: messageResponse,
}

function toCandidate(release: RankedRelease) {
  const { parsed } = release

  return {
    id: release.id,
    title: release.title,
    indexers: release.indexers.map(indexer => indexer.name),
    size: release.size ?? null,
    episodeSize: release.episodeSize ?? null,
    seeders: release.seeders,
    peers: release.peers ?? null,
    quality: parsed.quality ?? null,
    source: parsed.source ?? null,
    codec: parsed.codec ?? null,
    hdr: parsed.hdr,
    audio: parsed.audio,
    voice: release.voice ?? null,
    seasons: parsed.seasons,
    episodes: parsed.episodes
      ? {
          from: parsed.episodes.from,
          to: parsed.episodes.to,
          total: parsed.episodes.total,
        }
      : null,
    isPack: parsed.isPack,
    confidence:
      release.match.confidence === 'high'
        ? ('high' as const)
        : ('medium' as const),
    pickReason: release.reason ?? null,
    publishedAt: release.publishedAt?.toISOString() ?? null,
  }
}

/** Ссылки индексаторов и infohash наружу не уходят: ответ собирается явно */
export function toSourcesResponse(sources: TitleSources) {
  return {
    season: sources.season ?? null,
    episode: sources.episode ?? null,
    updatedAt: sources.updatedAt.toISOString(),
    profile: {
      qualities: DEFAULT_PROFILE.qualities,
      voiceTypes: DEFAULT_PROFILE.voiceTypes,
    },
    pinnedVoice: sources.pinned ?? null,
    top: sources.ranking.top,
    candidates: sources.ranking.ranked.map(toCandidate),
    voices: sources.voices,
    indexers: {
      total: sources.indexerCount,
      failed: sources.failed.map(({ name, kind }) => ({ name, kind })),
    },
  }
}

export const titleRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireViewer)

  app.get(
    '/:id/sources',
    {
      schema: {
        operationId: 'getTitleSources',
        tags: ['Titles'],
        params: titleParams,
        querystring: titleSourcesQuery,
        response: {
          200: titleSources,
          400: messageResponse,
          ...guardResponses,
          ...tmdbResponses,
        },
      },
    },
    async (request, reply) => {
      const { season, episode, refresh } = request.query

      try {
        const sources = await getTitleSources(request.params.id, {
          season: season === undefined ? undefined : Number(season),
          episode: episode === undefined ? undefined : Number(episode),
          refresh: refresh === '1',
          profileId: request.profileId,
        })

        if (!sources)
          return reply.code(404).send({ message: 'Title not found' })

        return toSourcesResponse(sources)
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.put(
    '/:id/voice',
    {
      schema: {
        operationId: 'putTitleVoice',
        tags: ['Titles'],
        params: titleParams,
        body: pinTitleVoice,
        response: {
          200: pinTitleVoice,
          400: messageResponse,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      const { season, voice } = request.body

      pinVoice(request.params.id, season, voice)

      return { season, voice }
    },
  )

  app.post(
    '/:id/watch',
    {
      schema: {
        operationId: 'postTitleWatch',
        tags: ['Titles'],
        params: titleParams,
        body: watchTitleBody,
        response: {
          200: titleWatch,
          202: titleWatch,
          400: messageResponse,
          ...guardResponses,
          ...tmdbResponses,
          422: watchErrorResponse,
          503: engineUnavailableResponse,
          504: messageResponse,
        },
      },
    },
    async (request, reply) => {
      let result

      try {
        result = await watchTitle(
          request.params.id,
          request.body,
          request.profileId,
        )
      }
      catch (err) {
        if (err instanceof WatchError)
          return reply.code(422).send({ message: err.message, kind: err.kind })

        if (err instanceof TmdbError)
          return sendTmdbError(reply, err)

        return sendEngineError(reply, err)
      }

      if (!result)
        return reply.code(404).send({ message: 'Title not found' })

      if (result.status === 'resolving') {
        return reply.code(202).send({ ...result, fileIndex: null })
      }

      return result
    },
  )

  app.get(
    '/:id/progress',
    {
      schema: {
        operationId: 'getTitleProgress',
        tags: ['Titles'],
        params: titleParams,
        response: {
          200: titleProgress,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      const last = lastTitleProgress(request.profileId, request.params.id)

      return {
        last: last
          ? {
              season: last.season || null,
              episode: last.episode || null,
              position: last.position,
              duration: last.duration,
              watched: isWatched(last.position, last.duration),
              updatedAt: last.updatedAt.toISOString(),
            }
          : null,
      }
    },
  )
}
