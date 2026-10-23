import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { messageResponse } from '../dto/common.ts'
import { continueRow, homeQuery, homeResponse } from '../dto/home.ts'
import { canManageLibrary, requireViewer } from '../middleware/auth.ts'
import {
  libraryFileRows,
  libraryHomeRows,
  unmatchedHomeRow,
} from '../services/library/home.ts'
import { withPosterRatings } from '../services/mine/index.ts'
import { personalHomeRows } from '../services/mine/home.ts'
import { getContinueRow } from '../services/sources/continue.ts'
import { getHomeRows, TmdbError } from '../services/tmdb/index.ts'
import { sendTmdbError } from './catalog.ts'

export const homeRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    '',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getHome',
        tags: ['Catalog'],
        querystring: homeQuery,
        response: {
          200: homeResponse,
          400: messageResponse,
          401: messageResponse,
          502: messageResponse,
          503: messageResponse,
        },
      },
    },
    async (request, reply) => {
      const { mode, language } = request.query
      const { profileId } = request
      // «Продолжить» и личные ряды (только на главной) собираются вместе с TMDB
      // и стоят перед ним; упавший свой ряд главную не роняет
      const [catalog, resume, unmatched, library, personal]
        = await Promise.allSettled([
          mode === 'library' ? [] : getHomeRows(mode, language),
          getContinueRow(profileId, mode, language),
          unmatchedHomeRow(mode, language, canManageLibrary(request)),
          libraryHomeRows(mode, language, profileId),
          mode === 'all' ? personalHomeRows(profileId, language) : [],
        ])
      // «Моя библиотека» — сразу после «Продолжить»: своё важнее каталога
      const own = [
        ...(resume.status === 'fulfilled' && resume.value.items.length > 0
          ? [resume.value]
          : []),
        ...(unmatched.status === 'fulfilled' ? unmatched.value : []),
        ...[
          ...(library.status === 'fulfilled' ? library.value : []),
          ...(personal.status === 'fulfilled' ? personal.value : []),
        ].map(row => ({
          ...row,
          items: withPosterRatings(row.items, profileId),
        })),
        // Домашнее видео и «Без описания» — после тайтлов библиотеки
        ...libraryFileRows(mode, profileId),
      ]

      if (catalog.status === 'fulfilled') {
        return {
          rows: [
            ...own,
            ...catalog.value.map(row => ({
              ...row,
              items: withPosterRatings(row.items, profileId),
            })),
          ],
        }
      }

      // Без сети главная показывает хотя бы свои ряды из кэша; без ключа
      // TMDB каталога нет совсем — это настройка, а не сбой
      const err: unknown = catalog.reason
      const config = err instanceof TmdbError && err.kind === 'config'

      if (own.length > 0 && !config)
        return { rows: own }

      return sendTmdbError(reply, err)
    },
  )

  app.get(
    '/continue',
    {
      onRequest: requireViewer,
      schema: {
        operationId: 'getHomeContinue',
        tags: ['Catalog'],
        querystring: homeQuery,
        response: {
          200: continueRow,
          400: messageResponse,
          401: messageResponse,
        },
      },
    },
    async (request) => {
      const { mode, language } = request.query

      return getContinueRow(request.profileId, mode, language)
    },
  )
}
