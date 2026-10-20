import ky, { HTTPError } from 'ky'
import { Api } from './generated'

export type ErrorMode = 'global' | 'toast' | 'silent'

export interface ApiClientOptions {
  /** Все запросы идут на Nitro-прокси того же origin */
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

const REFRESH_PATH = '/auth/refresh'
const UNAUTHORIZED = 401

/**
 * Ядро API-клиента: ничего не знает про Nuxt, поэтому подходит любому
 * Vue-приложению монорепо. Всё, что зависит от фреймворка, приходит
 * колбэками из приложения.
 */
export function createApiClient(options: ApiClientOptions) {
  const baseUrl = options.baseUrl ?? '/api'

  // Клиент без хуков: им обновляем сессию. Иначе 401 от самого
  // /auth/refresh снова попал бы в хук и запустил refresh рекурсивно
  const rawFetch = ky.create({ credentials: 'include' })

  let refreshPromise: Promise<unknown> | null = null

  // Один refresh на все параллельные 401: остальные ждут тот же промис
  function refreshSession() {
    refreshPromise ??= rawFetch
      .post(`${baseUrl}${REFRESH_PATH}`)
      .finally(() => {
        refreshPromise = null
      })

    return refreshPromise
  }

  const customFetch = ky.create({
    credentials: 'include',
    retry: {
      limit: 1,
      methods: ['get', 'post', 'patch', 'put', 'delete'],
    },
    hooks: {
      afterResponse: [
        async ({ request, response, retryCount }) => {
          if (response.ok)
            return response

          const isRefreshable
            = response.status === UNAUTHORIZED
              && !request.url.includes(REFRESH_PATH)
              && retryCount === 0

          if (isRefreshable) {
            try {
              await refreshSession()

              // ky сам повторит исходный запрос — уже с новой cookie
              return ky.retry()
            }
            catch {
              await options.onSessionExpired()

              return response
            }
          }

          const mode = options.getErrorMode()

          if (mode === 'silent')
            return response

          if (mode === 'toast') {
            options.onError(await readErrorMessage(response), response.status)

            return response
          }

          options.onFatal(response.status)

          return response
        },
      ],
    },
  })

  return new Api({
    baseUrl,
    customFetch: customFetch as unknown as typeof fetch,
  })
}

async function readErrorMessage(response: Response) {
  try {
    const body = (await response.clone().json()) as { message?: string }

    return body.message ?? 'Something went wrong'
  }
  catch {
    return 'Something went wrong'
  }
}

/** Достаёт сообщение из ошибки ky, чтобы показать его в форме */
export async function getErrorMessage(err: unknown) {
  if (err instanceof HTTPError)
    return readErrorMessage(err.response)

  return 'Something went wrong'
}

/** HTTP-статус ошибки запроса; `undefined` — ответа от сервера не было */
export function getErrorStatus(err: unknown) {
  return err instanceof HTTPError ? err.response.status : undefined
}
