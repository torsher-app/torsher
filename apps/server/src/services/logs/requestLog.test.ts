import type { FastifyReply, FastifyRequest } from 'fastify'
import { describe, expect, it, vi } from 'vitest'
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
