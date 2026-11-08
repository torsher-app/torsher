import { requireOwner, requireViewer } from '../middleware/auth.ts'
import { localTitleImages } from '../services/library/images.ts'
import type { FastifyReply } from 'fastify'
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import {
  catalogBackdropsResponse,
  catalogDiscoverQuery,
  catalogDiscoverResponse,
  catalogGenresQuery,
  catalogGenresResponse,
  catalogPersonParams,
  catalogSearchQuery,
  catalogSearchResponse,
  catalogSeasonParams,
  catalogTitleParams,
  catalogTitleQuery,
  catalogTrendingResponse,
  personDetails,
  seasonDetails,
  titleDetails,
  titleExtras,
} from '../dto/catalog.ts'
import { messageResponse } from '../dto/common.ts'
import {
  seasonEpisodeStates,
  waitTargets,
} from '../services/follow/episodes.ts'
import { followOf, isFollowing } from '../services/follow/index.ts'
import { titleFollowBrief } from '../services/follow/views.ts'
import { episodeKey } from '../services/follow/wanted.ts'
import { hasSearchableIndexers } from '../services/indexers/index.ts'
import { withPosterRatings } from '../services/mine/index.ts'
import { watchedTitles } from '../services/sources/progress.ts'
import {
  discoverTitles,
  getGenres,
  getPerson,
  getSeason,
  getTitle,
  getTitleExtras,
  getTrending,
  getTrendingBackdrops,
  searchCatalog,
  TmdbError,
} from '../services/tmdb/index.ts'
import {
  allowedTitleIds,
  filterTitles,
  hasAgeLimit,
  requireTitleAccess,
} from '../services/profiles/access.ts'

const errorResponses = {
  401: messageResponse,
  502: messageResponse,
  503: messageResponse,
}

const TMDB_ERROR_STATUS = {
  config: 503,
  not_found: 404,
  unavailable: 502,
} as const

export function sendTmdbError(reply: FastifyReply, err: unknown) {
  if (!(err instanceof TmdbError))
    throw err

  return reply.code(TMDB_ERROR_STATUS[err.kind]).send({ message: err.message })
}

export const catalogRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '/search',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogSearch',
        tags: ['Catalog'],
        querystring: catalogSearchQuery,
        response: {
          200: catalogSearchResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { query, language } = request.query

      try {
        const result = await searchCatalog(query, language)

        return {
          ...result,
          items: withPosterRatings(
            await filterTitles(
              request.profileId,
              result.items,
              item => item.id,
            ),
            request.profileId,
          ),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/titles/:id',
    {
      onRequest: requireViewer,
      preHandler: requireTitleAccess,
      schema: {
        operationId: 'getCatalogTitle',
        tags: ['Catalog'],
        params: catalogTitleParams,
        querystring: catalogTitleQuery,
        response: {
          200: titleDetails,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const details = await getTitle(
          request.params.id,
          request.query.language,
        )

        if (!details)
          return reply.code(404).send({ message: 'Title not found' })

        return {
          ...details,
          follow: titleFollowBrief(details.id, request.profileId),
          hasSources: hasSearchableIndexers(),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/titles/:id/seasons/:number',
    {
      onRequest: requireViewer,
      preHandler: requireTitleAccess,
      schema: {
        operationId: 'getCatalogSeason',
        tags: ['Catalog'],
        params: catalogSeasonParams,
        querystring: catalogTitleQuery,
        response: {
          200: seasonDetails,
          400: messageResponse,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { id, number } = request.params

      try {
        const cachedSeason = await getSeason(
          id,
          Number(number),
          request.query.language,
        )

        if (!cachedSeason)
          return reply.code(404).send({ message: 'Season not found' })

        const localImage = localTitleImages(request.profileId, id)
        const season = {
          ...cachedSeason,
          episodes: cachedSeason.episodes.map(episode => ({
            ...episode,
            still:
              episode.still ?? localImage(cachedSeason.number, episode.number),
          })),
        }

        const follow = followOf(id)

        if (!isFollowing(follow))
          return season

        const states = seasonEpisodeStates(follow, season)
        const waits = waitTargets(follow.id)

        return {
          ...season,
          episodes: season.episodes.map((episode) => {
            const state = states.get(episode.number)?.state

            return {
              ...episode,
              follow: state,
              followWait:
                state === 'waiting'
                  ? waits.get(
                      episodeKey({
                        season: season.number,
                        episode: episode.number,
                      }),
                    )
                  : undefined,
            }
          }),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/titles/:id/extras',
    {
      onRequest: requireViewer,
      preHandler: requireTitleAccess,
      schema: {
        operationId: 'getCatalogTitleExtras',
        tags: ['Catalog'],
        params: catalogTitleParams,
        querystring: catalogTitleQuery,
        response: {
          200: titleExtras,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { profileId } = request

      try {
        const extras = await getTitleExtras(
          request.params.id,
          request.query.language,
          ids => watchedTitles(profileId, ids),
        )

        if (!extras)
          return reply.code(404).send({ message: 'Title not found' })

        const allowed = await allowedTitleIds(
          profileId,
          [...extras.similar, ...extras.franchise].map(item => item.id),
        )

        return {
          ...extras,
          similar: withPosterRatings(
            extras.similar.filter(item => allowed.has(item.id)),
            profileId,
          ),
          franchise: withPosterRatings(
            extras.franchise.filter(item => allowed.has(item.id)),
            profileId,
          ),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/people/:id',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogPerson',
        tags: ['Catalog'],
        params: catalogPersonParams,
        querystring: catalogTitleQuery,
        response: {
          200: personDetails,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      const { profileId } = request

      try {
        const person = await getPerson(
          request.params.id,
          request.query.language,
          ids => watchedTitles(profileId, ids),
        )

        if (!person)
          return reply.code(404).send({ message: 'Person not found' })

        const allowed = await allowedTitleIds(
          profileId,
          person.credits.flatMap(group => group.items.map(item => item.id)),
        )

        return {
          ...person,
          credits: person.credits.map(group => ({
            ...group,
            items: withPosterRatings(
              group.items.filter(item => allowed.has(item.id)),
              profileId,
            ),
          })),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/discover',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogDiscover',
        tags: ['Catalog'],
        querystring: catalogDiscoverQuery,
        response: {
          200: catalogDiscoverResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const page = await discoverTitles(request.query)

        if (!page) {
          return reply
            .code(400)
            .send({ message: 'Networks apply only to series' })
        }

        return {
          ...page,
          totalIsApproximate: hasAgeLimit(request.profileId),
          items: withPosterRatings(
            await filterTitles(
              request.profileId,
              page.items,
              item => item.id,
            ),
            request.profileId,
          ),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/genres',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogGenres',
        tags: ['Catalog'],
        querystring: catalogGenresQuery,
        response: {
          200: catalogGenresResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          items: await getGenres(request.query.type, request.query.language),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/trending',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogTrending',
        tags: ['Catalog'],
        querystring: catalogTitleQuery,
        response: {
          200: catalogTrendingResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          items: withPosterRatings(
            await filterTitles(
              request.profileId,
              await getTrending(request.query.language),
              item => item.id,
            ),
            request.profileId,
          ),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/backdrops',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getCatalogBackdrops',
        tags: ['Catalog'],
        querystring: catalogTitleQuery,
        response: {
          200: catalogBackdropsResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return {
          items: await filterTitles(
            request.profileId,
            await getTrendingBackdrops(request.query.language),
            item => item.id,
          ),
        }
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )

  app.get(
    '/admin/search',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getAdminCatalogSearch',
        tags: ['Catalog'],
        querystring: catalogSearchQuery,
        response: {
          200: catalogSearchResponse,
          400: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        return await searchCatalog(request.query.query, request.query.language)
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )
  app.get(
    '/admin/titles/:id',
    {
      onRequest: requireOwner,
      schema: {
        operationId: 'getAdminCatalogTitle',
        tags: ['Catalog'],
        params: catalogTitleParams,
        querystring: catalogTitleQuery,
        response: {
          200: titleDetails,
          404: messageResponse,
          ...errorResponses,
        },
      },
    },
    async (request, reply) => {
      try {
        const title = await getTitle(request.params.id, request.query.language)
        return title ?? reply.code(404).send({ message: 'Title not found' })
      }
      catch (err) {
        return sendTmdbError(reply, err)
      }
    },
  )
}
