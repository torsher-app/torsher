import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  mineBootstrap,
  mineBootstrapQuery,
  mineContinueQuery,
  mineCycle,
  mineCycleChange,
  mineCycleCreate,
  mineCycleParams,
  mineDiaryCreate,
  mineDiaryCreated,
  mineDiaryEntry,
  mineDiaryMonths,
  mineDiaryMonthsQuery,
  mineDiaryPage,
  mineDiaryPatch,
  mineDiaryQuery,
  mineEntryParams,
  mineExpectedProfile,
  mineOverview,
  mineOverviewQuery,
  minePersonalContinue,
  minePersonalError,
  minePersonalWatched,
  mineSeenUpdate,
  mineStartInput,
  mineStartResponse,
  mineTitleParams,
  mineTitlePatch,
  mineTitlePersonal,
  mineTitleRead,
  mineWatchedQuery,
} from '../dto/minePersonal.ts'
import {
  mineRecommendationExclusions,
  mineRecommendationExclusionsQuery,
  mineRecommendations,
  mineRecommendationsQuery,
} from '../dto/mineRecommendations.ts'
import {
  getMineRecommendationExclusions,
  getMineRecommendations,
} from '../services/mine/recommendations.ts'
import { changeCycle, createCycle } from '../services/mine/cycles.ts'
import {
  createManualEntry,
  deleteDiaryEntry,
  patchDiaryEntry,
} from '../services/mine/diaryWrites.ts'
import { getDiaryMonths, getDiaryPage } from '../services/mine/journal.ts'
import { getMineOverview } from '../services/mine/overview.ts'
import {
  getMineBootstrap,
  getMinePersonalContinue,
  getMinePersonalWatched,
  getMineTitlePersonal,
  patchMineTitle,
  putMineSeen,
  putMineStart,
} from '../services/mine/personal.ts'
import {
  capturedProfile,
  MinePersonalError,
} from '../services/mine/personalAccess.ts'

const errors = {
  400: z.union([messageResponse, minePersonalError]),
  401: messageResponse,
  404: minePersonalError,
  409: minePersonalError,
  503: minePersonalError,
}

const tags = ['Mine']

/** Inherits the viewer guard from the Mine routes. */
export const minePersonalRoutes: FastifyPluginAsyncZod = async (app) => {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof MinePersonalError)
      return reply.code(error.status).send({ kind: error.kind })
    throw error
  })

  app.get(
    '/bootstrap',
    {
      schema: {
        operationId: 'getMineBootstrap',
        tags,
        querystring: mineBootstrapQuery,
        response: { 200: mineBootstrap, ...errors },
      },
    },
    async request =>
      getMineBootstrap(
        capturedProfile(request, request.query.expectedProfileId),
      ),
  )

  app.put(
    '/start-section',
    {
      schema: {
        operationId: 'putMineStart',
        tags,
        body: mineStartInput,
        response: { 200: mineStartResponse, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, start } = request.body
      return putMineStart(capturedProfile(request, expectedProfileId), start)
    },
  )

  app.get(
    '/diary',
    {
      schema: {
        operationId: 'getMineDiary',
        tags,
        querystring: mineDiaryQuery,
        response: { 200: mineDiaryPage, ...errors },
      },
    },
    async (request) => {
      const profileId = capturedProfile(
        request,
        request.query.expectedProfileId,
      )()
      return getDiaryPage(profileId, request.query)
    },
  )

  app.get(
    '/diary/months',
    {
      schema: {
        operationId: 'getMineDiaryMonths',
        tags,
        querystring: mineDiaryMonthsQuery,
        response: { 200: mineDiaryMonths, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, language, ...filter } = request.query
      return getDiaryMonths({
        profileId: capturedProfile(request, expectedProfileId)(),
        language,
        filter,
      })
    },
  )

  app.post(
    '/diary',
    {
      schema: {
        operationId: 'postMineDiary',
        tags,
        body: mineDiaryCreate,
        response: { 200: mineDiaryCreated, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, language, ...input } = request.body
      return createManualEntry(
        capturedProfile(request, expectedProfileId),
        input,
        language,
      )
    },
  )

  app.patch(
    '/diary/:entryId',
    {
      schema: {
        operationId: 'patchMineDiaryEntry',
        tags,
        params: mineEntryParams,
        body: mineDiaryPatch,
        response: { 200: mineDiaryEntry, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, language, ...patch } = request.body
      return patchDiaryEntry(
        capturedProfile(request, expectedProfileId),
        request.params.entryId,
        patch,
        language,
      )
    },
  )

  app.delete(
    '/diary/:entryId',
    {
      schema: {
        operationId: 'deleteMineDiaryEntry',
        tags,
        params: mineEntryParams,
        querystring: mineExpectedProfile,
        response: { 204: z.null(), ...errors },
      },
    },
    async (request, reply) => {
      deleteDiaryEntry(
        capturedProfile(request, request.query.expectedProfileId),
        request.params.entryId,
      )
      return reply.code(204).send(null)
    },
  )

  app.get(
    '/overview',
    {
      schema: {
        operationId: 'getMineOverview',
        tags,
        querystring: mineOverviewQuery,
        response: { 200: mineOverview, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, language, period } = request.query
      return getMineOverview(
        capturedProfile(request, expectedProfileId)(),
        language,
        period,
      )
    },
  )

  app.get(
    '/title/:titleId',
    {
      schema: {
        operationId: 'getMineTitlePersonal',
        tags,
        querystring: mineTitleRead,
        params: mineTitleParams,
        response: { 200: mineTitlePersonal, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, language, season, episode } = request.query
      return getMineTitlePersonal(
        capturedProfile(request, expectedProfileId),
        request.params.titleId,
        language,
        { season, episode },
      )
    },
  )

  app.patch(
    '/title/:titleId',
    {
      schema: {
        operationId: 'patchMineTitlePersonal',
        tags,
        params: mineTitleParams,
        body: mineTitlePatch,
        response: { 200: mineTitlePersonal, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, language, ...patch } = request.body
      return patchMineTitle(
        capturedProfile(request, expectedProfileId),
        request.params.titleId,
        language,
        patch,
      )
    },
  )

  app.put(
    '/title/:titleId/seen',
    {
      schema: {
        operationId: 'putMineSeen',
        tags,
        params: mineTitleParams,
        body: mineSeenUpdate,
        response: { 200: mineTitlePersonal, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, language, watched, season, episode }
        = request.body
      return putMineSeen(
        capturedProfile(request, expectedProfileId),
        { ...request.params, season, episode },
        watched,
        language,
      )
    },
  )

  app.post(
    '/title/:titleId/cycles',
    {
      schema: {
        operationId: 'postMineCycle',
        tags,
        params: mineTitleParams,
        body: mineCycleCreate,
        response: { 200: mineCycle, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, ...input } = request.body
      return createCycle(
        capturedProfile(request, expectedProfileId),
        request.params.titleId,
        input,
      )
    },
  )

  app.patch(
    '/cycles/:cycleId',
    {
      schema: {
        operationId: 'patchMineCycle',
        tags,
        params: mineCycleParams,
        body: mineCycleChange,
        response: { 200: mineCycle, ...errors },
      },
    },
    async (request) => {
      const { expectedProfileId, action, language } = request.body
      return changeCycle(
        capturedProfile(request, expectedProfileId),
        request.params.cycleId,
        action,
        language,
      )
    },
  )

  app.get(
    '/continue',
    {
      schema: {
        operationId: 'getMinePersonalContinue',
        tags,
        querystring: mineContinueQuery,
        response: { 200: minePersonalContinue, ...errors },
      },
    },
    async request =>
      getMinePersonalContinue(
        capturedProfile(request, request.query.expectedProfileId),
        request.query,
      ),
  )

  app.get(
    '/watched',
    {
      schema: {
        operationId: 'getMinePersonalWatched',
        tags,
        querystring: mineWatchedQuery,
        response: { 200: minePersonalWatched, ...errors },
      },
    },
    async request =>
      getMinePersonalWatched(
        capturedProfile(request, request.query.expectedProfileId),
        request.query,
      ),
  )

  app.get(
    '/recommendations',
    {
      schema: {
        operationId: 'getMineRecommendations',
        tags,
        querystring: mineRecommendationsQuery,
        response: { 200: mineRecommendations, ...errors },
      },
    },
    async request =>
      getMineRecommendations(
        capturedProfile(request, request.query.expectedProfileId),
        request.query,
      ),
  )

  app.get(
    '/recommendation-exclusions',
    {
      schema: {
        operationId: 'getMineRecommendationExclusions',
        tags,
        querystring: mineRecommendationExclusionsQuery,
        response: { 200: mineRecommendationExclusions, ...errors },
      },
    },
    async request =>
      getMineRecommendationExclusions(
        capturedProfile(request, request.query.expectedProfileId),
        request.query,
      ),
  )
}
