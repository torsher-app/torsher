import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod'
import { z } from 'zod'
import { messageResponse } from '../dto/common.ts'
import {
  internetSpeedtest,
  localSpeedtest,
  speedtestDownloadQuery,
  speedtestId,
  speedtestStart,
} from '../dto/speedtest.ts'
import {
  requireByRoute,
  requireSameOrigin,
  streamSubjectOf,
} from '../middleware/auth.ts'
import {
  cancel,
  download,
  heartbeat,
  internetStatus,
  latency,
  shutdownSpeedtests,
  SpeedtestError,
  startInternet,
  startLocal,
} from '../services/speedtest/index.ts'
import { createRateLimiter } from '../utils/rateLimit.ts'

export const speedtestLimiter = createRateLimiter({
  limit: 3,
  windowMs: 60_000,
})
const errors = {
  401: messageResponse,
  403: messageResponse,
  404: messageResponse,
  409: messageResponse,
  429: messageResponse,
}
export const speedtestRoutes: FastifyPluginAsyncZod = async (app) => {
  app.addHook('onRequest', requireByRoute)
  app.addHook('onRequest', requireSameOrigin)
  app.addHook('preClose', shutdownSpeedtests)
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof SpeedtestError)
      return reply.code(error.status).send({ message: error.message })
    throw error
  })
  app.post(
    '/local',
    {
      config: { viewer: true },
      schema: {
        operationId: 'postLocalSpeedtest',
        tags: ['Speedtest'],
        body: speedtestStart,
        response: { 201: localSpeedtest, ...errors },
      },
    },
    async (request, reply) => {
      const subject = streamSubjectOf(request)
      if (request.deviceId && speedtestLimiter.isLimited(subject)) {
        return reply
          .code(429)
          .header('Retry-After', speedtestLimiter.retryAfter(subject))
          .send({ message: 'rate_limited' })
      }
      const started = startLocal(subject)
      if (request.deviceId)
        speedtestLimiter.hit(subject)
      return reply.code(201).send(started)
    },
  )
  app.get(
    '/local/:id/latency',
    {
      config: { viewer: true },
      schema: {
        operationId: 'getLocalSpeedtestLatency',
        tags: ['Speedtest'],
        params: speedtestId,
        response: { 200: messageResponse, ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store, no-transform')
      reply.header('X-Torsher-Speedtest-Id', request.params.id)
      return latency(request.params.id, streamSubjectOf(request))
    },
  )
  app.get(
    '/local/:id/download',
    {
      exposeHeadRoute: false,
      config: { viewer: true },
      schema: {
        operationId: 'getLocalSpeedtestDownload',
        querystring: speedtestDownloadQuery,
        tags: ['Speedtest'],
        params: speedtestId,
        produces: ['application/octet-stream'],
        response: { 200: z.string().meta({ format: 'binary' }), ...errors },
      },
    },
    async (request, reply) => {
      const transfer = download(
        request.params.id,
        streamSubjectOf(request),
        request.query,
        () => {
          reply.raw.destroy()
        },
      )
      reply
        .header('Cache-Control', 'no-store, no-transform')
        .header('X-Accel-Buffering', 'no')
        .header('X-Torsher-Speedtest-Seq', request.query.seq)
        .header('X-Torsher-Speedtest-Bytes', request.query.bytes)
        .header('X-Torsher-Speedtest-Id', request.params.id)
        .type('application/octet-stream')
      let responseFinished = false
      reply.raw.once('finish', () => {
        responseFinished = true
        transfer.complete()
      })
      reply.raw.once('close', () => {
        if (!responseFinished && !reply.raw.writableFinished)
          transfer.disconnect()
        else transfer.complete()
      })
      return reply.send(transfer.stream as unknown as string)
    },
  )
  app.delete(
    '/local/:id',
    {
      config: { viewer: true },
      schema: {
        operationId: 'deleteLocalSpeedtest',
        tags: ['Speedtest'],
        params: speedtestId,
        response: { 200: messageResponse, ...errors },
      },
    },
    request => cancel(request.params.id, streamSubjectOf(request), 'local'),
  )
  app.post(
    '/internet',
    {
      config: { viewer: true },
      schema: {
        operationId: 'postInternetSpeedtest',
        tags: ['Speedtest'],
        body: speedtestStart,
        response: { 201: internetSpeedtest, ...errors },
      },
    },
    async (request, reply) => {
      const subject = streamSubjectOf(request)
      if (request.deviceId && speedtestLimiter.isLimited(subject)) {
        return reply
          .code(429)
          .header('Retry-After', speedtestLimiter.retryAfter(subject))
          .send({ message: 'rate_limited' })
      }
      const started = startInternet(subject)
      if (request.deviceId)
        speedtestLimiter.hit(subject)
      return reply.code(201).send(started)
    },
  )
  app.get(
    '/internet/:id',
    {
      config: { viewer: true },
      schema: {
        operationId: 'getInternetSpeedtest',
        tags: ['Speedtest'],
        params: speedtestId,
        response: { 200: internetSpeedtest, ...errors },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store')
      return internetStatus(request.params.id, streamSubjectOf(request))
    },
  )
  app.post(
    '/internet/:id/heartbeat',
    {
      config: { viewer: true },
      schema: {
        operationId: 'postInternetSpeedtestHeartbeat',
        tags: ['Speedtest'],
        body: speedtestStart,
        params: speedtestId,
        response: { 200: messageResponse, ...errors },
      },
    },
    async request => heartbeat(request.params.id, streamSubjectOf(request)),
  )
  app.delete(
    '/internet/:id',
    {
      config: { viewer: true },
      schema: {
        operationId: 'deleteInternetSpeedtest',
        tags: ['Speedtest'],
        params: speedtestId,
        response: { 200: messageResponse, ...errors },
      },
    },
    request =>
      cancel(request.params.id, streamSubjectOf(request), 'internet'),
  )
}
