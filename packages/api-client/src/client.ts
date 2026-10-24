import { Api } from './generated'

export type ErrorMode = 'global' | 'toast' | 'silent'

export interface ApiClientOptions {
  /**
   * Адрес сервера. По умолчанию — тот же origin: витрину и панель отдаёт сам
   * сервер, а в разработке их dev-серверы проксируют `/api`
   */
  baseUrl?: string
  /** Как показывать ошибку текущего запроса */
  getErrorMode: () => ErrorMode
  /** Refresh не удался — сессия мертва */
  onSessionExpired: () => void | Promise<void>
  /** Ошибка в режиме toast */
  onError: (message: string, status: number) => void
  /** Ошибка в режиме global — страница ошибки */
  onFatal: (status: number) => void
}

const REFRESH_PATH = '/api/auth/refresh'
const UNAUTHORIZED = 401
const TIMEOUT_MS = 10_000
const RETRY_DELAY_MS = 300
// Повторяем только идемпотентные запросы: вход или изменение профиля
// не должны уйти на сервер дважды
const RETRY_METHODS = ['GET', 'HEAD']
const RETRY_STATUSES = [408, 429, 500, 502, 503, 504]
const FALLBACK_MESSAGE = 'Something went wrong'

/** Сервер ответил неуспешным статусом */
class HttpError extends Error {
  readonly response: Response
  readonly status: number

  constructor(response: Response) {
    super(`Request failed with status ${response.status}`)
    this.name = 'HttpError'
    this.response = response
    this.status = response.status
  }
}

class TimeoutError extends Error {
  constructor() {
    super(`Request timed out after ${TIMEOUT_MS} ms`)
    this.name = 'TimeoutError'
  }
}

/**
 * Ядро API-клиента на нативном `fetch`: ничего не знает про Nuxt, поэтому
 * подходит любому Vue-приложению монорепо. Всё, что зависит от фреймворка,
 * приходит колбэками из приложения. Использует только API, которые есть в
 * Chromium 68: на нём работает витрина на старых ТВ.
 */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? ''

  let refreshPromise: Promise<void> | null = null

  // Один refresh на все параллельные 401: остальные ждут тот же промис.
  // Идёт мимо `request`, иначе 401 от самого refresh запустил бы его снова
  function refreshSession() {
    refreshPromise ??= send(`${baseUrl}${REFRESH_PATH}`, { method: 'POST' })
      .then((response) => {
        if (!response.ok)
          throw new HttpError(response)
      })
      .finally(() => {
        refreshPromise = null
      })

    return refreshPromise
  }

  async function request(url: string, init: RequestInit) {
    // Режим берём при старте запроса: `withErrorMode` возвращает прежний,
    // когда закончится его запрос, и параллельный тихий запрос иначе
    // показал бы ошибку тостом
    const mode = options.getErrorMode()
    let response = await sendWithRetry(url, init)

    if (response.status === UNAUTHORIZED && !url.includes(REFRESH_PATH)) {
      try {
        await refreshSession()
      }
      catch {
        await options.onSessionExpired()

        throw new HttpError(response)
      }

      // Повтор исходного запроса уже с новой cookie
      response = await sendWithRetry(url, init)
    }

    if (response.ok)
      return response

    await reportError(response, mode)

    throw new HttpError(response)
  }

  async function reportError(response: Response, mode: ErrorMode) {
    if (mode === 'toast')
      options.onError(await readErrorMessage(response), response.status)
    else if (mode === 'global')
      options.onFatal(response.status)
  }

  return new Api({
    baseUrl,
    // Сгенерированный клиент всегда передаёт URL строкой
    customFetch: (input, init = {}) => request(String(input), init),
  })
}

async function sendWithRetry(url: string, init: RequestInit) {
  const isRetryable = RETRY_METHODS.includes(
    (init.method ?? 'GET').toUpperCase(),
  )

  try {
    const response = await send(url, init)

    if (!isRetryable || !RETRY_STATUSES.includes(response.status))
      return response
  }
  catch (error) {
    // `fetch` отклоняет сетевой сбой `TypeError`; отмену и таймаут не повторяем
    if (!isRetryable || !(error instanceof TypeError))
      throw error
  }

  await delay(RETRY_DELAY_MS)

  return send(url, init)
}

/**
 * Одна попытка с таймаутом. `AbortSignal.any` и `AbortSignal.timeout` на
 * Chromium 68 нет, поэтому сигнал вызывающего кода и таймер отменяют
 * собственный контроллер попытки.
 */
function send(url: string, init: RequestInit) {
  const controller = new AbortController()
  const outerSignal = init.signal
  let isTimedOut = false

  const abort = () => controller.abort()

  if (outerSignal?.aborted)
    abort()

  outerSignal?.addEventListener('abort', abort)

  const timer = setTimeout(() => {
    isTimedOut = true
    abort()
  }, TIMEOUT_MS)

  return fetch(url, {
    ...init,
    credentials: 'include',
    signal: controller.signal,
  })
    .catch((error: unknown) => {
      throw isTimedOut ? new TimeoutError() : error
    })
    .finally(() => {
      clearTimeout(timer)
      outerSignal?.removeEventListener('abort', abort)
    })
}

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.clone().json()) as { message?: string }

    return body.message ?? FALLBACK_MESSAGE
  }
  catch {
    return FALLBACK_MESSAGE
  }
}

/** Достаёт сообщение из ошибки запроса, чтобы показать его в форме */
export async function getErrorMessage(err: unknown) {
  if (err instanceof HttpError)
    return readErrorMessage(err.response)

  return FALLBACK_MESSAGE
}

/**
 * Тело ошибки запроса как JSON, когда сообщения мало: например, вид ошибки
 * проверки источника. `undefined` — ответа не было или тело не JSON.
 */
export async function getErrorBody<T>(err: unknown): Promise<T | undefined> {
  if (!(err instanceof HttpError))
    return undefined

  try {
    return (await err.response.clone().json()) as T
  }
  catch {
    return undefined
  }
}

/** HTTP-статус ошибки запроса; `undefined` — ответа от сервера не было */
export function getErrorStatus(err: unknown) {
  return err instanceof HttpError ? err.status : undefined
}
