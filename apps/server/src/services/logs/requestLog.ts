import type { FastifyReply, FastifyRequest } from 'fastify'
import { LogController } from 'fastify'

function requestFields(request: FastifyRequest, reply: FastifyReply) {
  return {
    method: request.method,
    url: request.url,
    statusCode: reply.statusCode,
  }
}

/**
 * Запросы — на debug: панель опрашивает разделы раз в несколько секунд, а
 * плеер тянет сегменты, и на info журнал состоял бы из них. Ошибка, которую
 * обработчик не поймал (5xx), — на error со стеком. Ответ 5xx, который сервер
 * отдаёт сам (движок перезапускается и т. п.), идёт обычной записью запроса.
 */
export class RequestLogController extends LogController {
  override incomingRequest() {}

  override requestCompleted(
    error: Error | null | undefined,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    request.log.debug(
      {
        ...requestFields(request, reply),
        ms: Math.round(reply.elapsedTime),
        ...(error ? { err: error } : {}),
      },
      'Request completed',
    )
  }

  override defaultErrorLog(
    error: Error,
    request: FastifyRequest,
    reply: FastifyReply,
  ) {
    if (reply.statusCode >= 500) {
      request.log.error(
        { ...requestFields(request, reply), err: error },
        error?.message,
      )
    }
    else {
      request.log.debug(requestFields(request, reply), error?.message)
    }
  }

  // Плеер закрывает соединение на каждой перемотке: это не ошибка ответа
  override streamError(
    error: Error,
    request: FastifyRequest,
    reply: FastifyReply,
    metadata?: Record<string, unknown>,
  ) {
    if (
      (error as NodeJS.ErrnoException).code === 'ERR_STREAM_PREMATURE_CLOSE'
    ) {
      request.log.debug(
        requestFields(request, reply),
        'Stream closed by client',
      )
      return
    }

    super.streamError(error, request, reply, metadata)
  }

  override routeNotFound(request: FastifyRequest) {
    request.log.debug(
      { method: request.method, url: request.url },
      'Route not found',
    )
  }
}
