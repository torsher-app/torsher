import type { FastifyReply, FastifyRequest } from 'fastify'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../../app.ts'
import { formatEntry } from './files.ts'
import { LogRing } from './ring.ts'
import { RequestLogController } from './requestLog.ts'

function fakes() {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const request = {
    method: 'GET',
    url: '/api/stream/1/0',
    log,
  } as unknown as FastifyRequest
  const reply = { statusCode: 206, log } as unknown as FastifyReply

  return { log, request, reply }
}

describe('ошибки потока ответа', () => {
  it('клиент закрыл соединение — debug', () => {
    const { log, request, reply } = fakes()
    const error = Object.assign(new Error('Premature close'), {
      code: 'ERR_STREAM_PREMATURE_CLOSE',
    })

    new RequestLogController().streamError(error, request, reply)

    expect(log.debug).toHaveBeenCalledWith(
      { method: 'GET', url: '/api/stream/1/0', statusCode: 206 },
      'Stream closed by client',
    )
    expect(log.info).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })

  it('другая ошибка — warn, как у Fastify', () => {
    const { log, request, reply } = fakes()
    const error = new Error('read failed')

    new RequestLogController().streamError(error, request, reply)

    expect(log.warn).toHaveBeenCalledWith({ err: error }, expect.any(String))
    expect(log.debug).not.toHaveBeenCalled()
  })
})

it('indexes the response UUID in error and ordinary debug request logs', async () => {
  const ring = new LogRing()
  const lines: string[] = []
  const logger = pino(
    { level: 'debug' },
    {
      write(line: string) {
        lines.push(line)
        ring.push(line)
      },
    },
  )
  const app = createApp({
    loggerInstance: logger,
    logController: new RequestLogController(),
  })
  // This operation is deliberately outside the selective info summary list.
  app.get(
    '/request-log-failure',
    { schema: { operationId: 'getPlayback' } },
    async () => {
      throw new Error('request log fixture failure')
    },
  )
  app.get(
    '/request-log-success',
    { schema: { operationId: 'getPlaybackFiles' } },
    async () => ({ ok: true }),
  )
  try {
    for (const [url, status, levels] of [
      ['/request-log-failure', 500, ['error', 'debug']],
      ['/request-log-success', 200, ['debug']],
    ] as const) {
      const response = await app.inject({ url })
      expect(response.statusCode).toBe(status)
      const requestId = response.headers['x-torsher-request-id'] as string
      expect(requestId).toMatch(
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/,
      )
      expect(lines.some(line => line.includes(requestId))).toBe(true)
      const entries = ring.query({ q: requestId }).entries
      expect(entries.map(entry => entry.level).sort()).toEqual(
        [...levels].sort(),
      )
      expect(
        entries.every(entry => entry.context?.requestId === requestId),
      ).toBe(true)
      expect(entries.map(formatEntry).join('')).toContain(
        `requestId=${requestId}`,
      )
    }
  }
  finally {
    await app.close()
  }
})
