import type { ApiClientOptions, ErrorMode } from './client.ts'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createApiClient,
  getErrorBody,
  getErrorMessage,
  getErrorStatus,
} from './client.ts'

const fetchMock = vi.fn<typeof fetch>()

function json(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function setup(mode: ErrorMode = 'silent') {
  const options = {
    baseUrl: '/api',
    getErrorMode: () => mode,
    onSessionExpired: vi.fn(),
    onError: vi.fn(),
    onFatal: vi.fn(),
  } satisfies ApiClientOptions

  return { api: createApiClient(options), options }
}

function requestedUrls() {
  return fetchMock.mock.calls.map(
    ([url, init]) => `${init?.method} ${String(url)}`,
  )
}

function catchError(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('Запрос должен был упасть')
    },
    (error: unknown) => error,
  )
}

/** `fetch`, который отвечает только отменой своего сигнала */
function hangingFetch(): typeof fetch {
  return (_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(new DOMException('The operation was aborted', 'AbortError'))
      })
    })
}

const signin = { email: 'user@example.com', password: 'secret-password' }

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  fetchMock.mockReset()
})

describe('успешный ответ', () => {
  it('возвращает данные и шлёт cookie', async () => {
    fetchMock.mockResolvedValue(json(200, { id: 'u1' }))
    const { api } = setup()

    await expect(api.users.getUsersMe()).resolves.toEqual({ id: 'u1' })
    expect(requestedUrls()).toEqual(['GET /api/users/me'])
    expect(fetchMock.mock.calls[0]![1]?.credentials).toBe('include')
  })
})

describe('refresh при 401', () => {
  it('один refresh на параллельные 401, исходные запросы повторяются', async () => {
    let isRefreshed = false

    fetchMock.mockImplementation(async (url) => {
      if (String(url) === '/api/auth/refresh') {
        await new Promise(resolve => setTimeout(resolve, 10))
        isRefreshed = true

        return json(200)
      }

      return isRefreshed ? json(200, { id: 'u1' }) : json(401)
    })
    const { api, options } = setup()

    await expect(
      Promise.all([api.users.getUsersMe(), api.users.getUsersMe()]),
    ).resolves.toEqual([{ id: 'u1' }, { id: 'u1' }])
    expect(
      requestedUrls().filter(url => url.includes('/auth/refresh')),
    ).toEqual(['POST /api/auth/refresh'])
    expect(fetchMock).toHaveBeenCalledTimes(5)
    expect(options.onSessionExpired).not.toHaveBeenCalled()
  })

  it('провал refresh завершает сессию без тоста', async () => {
    fetchMock.mockImplementation(async () => json(401))
    const { api, options } = setup('toast')

    const error = await catchError(api.users.getUsersMe())

    expect(getErrorStatus(error)).toBe(401)
    expect(options.onSessionExpired).toHaveBeenCalledOnce()
    expect(options.onError).not.toHaveBeenCalled()
    expect(options.onFatal).not.toHaveBeenCalled()
  })

  it('повторный 401 после refresh — обычная ошибка', async () => {
    fetchMock.mockImplementation(async url =>
      String(url) === '/api/auth/refresh'
        ? json(200)
        : json(401, { message: 'No access' }),
    )
    const { api, options } = setup('toast')

    const error = await catchError(api.users.getUsersMe())

    expect(getErrorStatus(error)).toBe(401)
    expect(requestedUrls()).toEqual([
      'GET /api/users/me',
      'POST /api/auth/refresh',
      'GET /api/users/me',
    ])
    expect(options.onError).toHaveBeenCalledWith('No access', 401)
  })

  it('401 от самого refresh не запускает refresh', async () => {
    fetchMock.mockResolvedValue(json(401))
    const { api, options } = setup()

    const error = await catchError(api.auth.postAuthRefresh())

    expect(getErrorStatus(error)).toBe(401)
    expect(requestedUrls()).toEqual(['POST /api/auth/refresh'])
    expect(options.onSessionExpired).not.toHaveBeenCalled()
  })
})

describe('режимы ошибок', () => {
  it('toast — сообщение и статус в onError', async () => {
    fetchMock.mockResolvedValue(json(400, { message: 'Invalid email' }))
    const { api, options } = setup('toast')

    await catchError(api.auth.postAuthSignin(signin))

    expect(options.onError).toHaveBeenCalledWith('Invalid email', 400)
    expect(options.onFatal).not.toHaveBeenCalled()
  })

  it('global — статус в onFatal', async () => {
    fetchMock.mockResolvedValue(json(404))
    const { api, options } = setup('global')

    await catchError(api.users.getUsersMe())

    expect(options.onFatal).toHaveBeenCalledWith(404)
    expect(options.onError).not.toHaveBeenCalled()
  })

  it('silent — без колбэков', async () => {
    fetchMock.mockResolvedValue(json(404))
    const { api, options } = setup('silent')

    const error = await catchError(api.users.getUsersMe())

    expect(getErrorStatus(error)).toBe(404)
    expect(options.onError).not.toHaveBeenCalled()
    expect(options.onFatal).not.toHaveBeenCalled()
  })
})

describe('повтор', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('запрос GET с 503 повторяется один раз', async () => {
    fetchMock
      .mockResolvedValueOnce(json(503))
      .mockResolvedValueOnce(json(200, { id: 'u1' }))
    const { api } = setup()

    const promise = api.users.getUsersMe()
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual({ id: 'u1' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('запрос GET повторяется не больше одного раза', async () => {
    fetchMock.mockResolvedValue(json(503))
    const { api } = setup()

    const promise = catchError(api.users.getUsersMe())
    await vi.runAllTimersAsync()

    expect(getErrorStatus(await promise)).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('запрос POST с 503 не повторяется', async () => {
    fetchMock.mockResolvedValue(json(503))
    const { api } = setup()

    const promise = catchError(api.auth.postAuthSignin(signin))
    await vi.runAllTimersAsync()

    expect(getErrorStatus(await promise)).toBe(503)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('запрос GET при сетевой ошибке повторяется, затем падает без статуса', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const { api } = setup()

    const promise = catchError(api.users.getUsersMe())
    await vi.runAllTimersAsync()

    const error = await promise

    expect(error).toBeInstanceOf(TypeError)
    expect(getErrorStatus(error)).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

describe('таймаут и отмена', () => {
  it('таймаут 10 с без повтора', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(hangingFetch())
    const { api } = setup()

    const promise = catchError(api.users.getUsersMe())
    await vi.advanceTimersByTimeAsync(10_000)

    const error = await promise

    expect(error).toMatchObject({ name: 'TimeoutError' })
    expect(getErrorStatus(error)).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('отмена сигнала вызывающего кода отменяет запрос', async () => {
    fetchMock.mockImplementation(hangingFetch())
    const { api } = setup()
    const controller = new AbortController()

    const promise = catchError(
      api.users.getUsersMe({ signal: controller.signal }),
    )
    controller.abort()

    const error = await promise

    expect(error).toMatchObject({ name: 'AbortError' })
    expect(fetchMock.mock.calls[0]![1]?.signal?.aborted).toBe(true)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('уже отменённый сигнал не уходит в сеть живым', async () => {
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.signal?.aborted)
        throw new DOMException('The operation was aborted', 'AbortError')

      return json(200)
    })
    const { api } = setup()
    const controller = new AbortController()
    controller.abort()

    const error = await catchError(
      api.users.getUsersMe({ signal: controller.signal }),
    )

    expect(error).toMatchObject({ name: 'AbortError' })
  })
})

describe('getErrorMessage', () => {
  it('берёт message из тела ответа', async () => {
    fetchMock.mockResolvedValue(json(409, { message: 'Email already taken' }))
    const { api } = setup()

    const error = await catchError(
      api.auth.postAuthSignup({ ...signin, name: 'User' }),
    )

    await expect(getErrorMessage(error)).resolves.toBe('Email already taken')
  })

  it('фолбэк для тела не в JSON и для ошибок без ответа', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }))
    const { api } = setup()

    const error = await catchError(api.auth.postAuthSignin(signin))

    await expect(getErrorMessage(error)).resolves.toBe('Something went wrong')
    await expect(
      getErrorMessage(new TypeError('Failed to fetch')),
    ).resolves.toBe('Something went wrong')
  })
})

describe('getErrorBody', () => {
  it('отдаёт тело ошибки и не мешает прочитать сообщение', async () => {
    fetchMock.mockResolvedValue(
      json(422, { message: 'Source rejected the API key', kind: 'auth' }),
    )
    const { api } = setup()

    const error = await catchError(api.auth.postAuthSignin(signin))

    await expect(getErrorBody(error)).resolves.toEqual({
      message: 'Source rejected the API key',
      kind: 'auth',
    })
    await expect(getErrorMessage(error)).resolves.toBe(
      'Source rejected the API key',
    )
  })

  it('undefined для тела не в JSON и для ошибок без ответа', async () => {
    fetchMock.mockResolvedValue(new Response('Bad Gateway', { status: 502 }))
    const { api } = setup()

    const error = await catchError(api.auth.postAuthSignin(signin))

    await expect(getErrorBody(error)).resolves.toBeUndefined()
    await expect(
      getErrorBody(new TypeError('Failed')),
    ).resolves.toBeUndefined()
  })
})
