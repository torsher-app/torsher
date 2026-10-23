import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import type { RankedRelease, TitleSources } from '../services/sources/index.ts'
import { messageResponse } from '../dto/common.ts'
import { engineUnavailableResponse } from '../dto/torrents.ts'
import {
  markWatched as markWatchedBody,
  openTitle,
  pinTitleVoice,
  titleFiles,
  titleFilesParams,
  titleOpen,
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
  voiceKeysOf,
} from '../services/sources/index.ts'
import { titleFiles as filesOfTorrent } from '../services/sources/files.ts'
import {
  episodeProgress,
  lastTitleProgress,
  markWatched,
} from '../services/sources/progress.ts'
import { seasonReleases } from '../services/sources/seasonRelease.ts'
import {
  openCandidate,
  WatchError,
  watchTitle,
} from '../services/sources/watch.ts'
import { getTorrent } from '../services/torrents/index.ts'
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

function toCandidate(release: RankedRelease, lastWatched: boolean) {
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
    channels: parsed.channels ?? null,
    subs: parsed.subs,
    voice: release.voice ?? null,
    voiceKeys: voiceKeysOf(release),
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
    lastWatched,
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
    seasonCandidate: sources.seasonCandidate ?? null,
    top: sources.ranking.top,
    candidates: sources.ranking.ranked.map(release =>
      toCandidate(release, release.id === sources.lastWatchedId),
    ),
    voices: sources.voices,
    query: {
      current: sources.query ?? null,
      suggestions: sources.querySuggestions,
    },
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
      const { season, episode, refresh, all, query } = request.query

      try {
        const sources = await getTitleSources(request.params.id, {
          season: season === undefined ? undefined : Number(season),
          episode: episode === undefined ? undefined : Number(episode),
          refresh: refresh === '1',
          allSeasons: all === '1',
          profileId: request.profileId,
          query,
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
        episodes: episodeProgress(request.profileId, request.params.id).map(
          row => ({
            season: row.season,
            episode: row.episode,
            position: row.position,
            duration: row.duration,
            watched: isWatched(row.position, row.duration),
          }),
        ),
        seasonReleases: seasonReleases(
          request.profileId,
          request.params.id,
        ).map(release => ({
          season: release.season,
          torrentId: release.torrent.id,
          quality: release.quality ?? null,
          voice: release.voice ?? null,
          episodes: release.episodes,
        })),
      }
    },
  )

  app.post(
    '/:id/open',
    {
      schema: {
        operationId: 'postTitleOpen',
        tags: ['Titles'],
        params: titleParams,
        body: openTitle,
        response: {
          200: titleOpen,
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
        result = await openCandidate(
          request.params.id,
          request.body.candidateId,
          request.profileId,
          request.body.query,
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

      return result
    },
  )

  app.get(
    '/:id/files/:torrentId',
    {
      schema: {
        operationId: 'getTitleFiles',
        tags: ['Titles'],
        params: titleFilesParams,
        response: {
          200: titleFiles,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      const ref = parseCatalogId(request.params.id)
      const torrent = getTorrent(request.params.torrentId)

      // Только раздачи этого тайтла: чужие файлы экран «Файлы» не показывает
      if (!ref || !torrent || torrent.titleId !== request.params.id)
        return reply.code(404).send({ message: 'Release not found' })

      if (torrent.status !== 'ready')
        return { status: 'resolving' as const, name: torrent.name, files: [] }

      return {
        status: 'ready' as const,
        name: torrent.name,
        files: filesOfTorrent(torrent, {
          profileId: request.profileId,
          titleId: request.params.id,
          kind: ref.type === 'movie' ? 'movie' : 'series',
        }).map(file => ({
          ...file,
          season: file.season ?? null,
          episode: file.episode ?? null,
        })),
      }
    },
  )

  app.put(
    '/:id/watched',
    {
      schema: {
        operationId: 'putTitleWatched',
        tags: ['Titles'],
        params: titleParams,
        body: markWatchedBody,
        response: {
          200: markWatchedBody,
          404: messageResponse,
          ...guardResponses,
        },
      },
    },
    async (request, reply) => {
      if (!parseCatalogId(request.params.id))
        return reply.code(404).send({ message: 'Title not found' })

      const { season, episode, watched } = request.body

      markWatched(
        {
          profileId: request.profileId,
          titleId: request.params.id,
          season,
          episode,
        },
        watched,
      )

      return { season, episode, watched }
    },
  )
}
