/**
 * Роутер моков демо: метод и шаблон пути (`/api/torrents/:id/pause`) →
 * обработчик. Тип ответа обработчика задаёт параметр `get<T>()` типом
 * сгенерированного клиента, поэтому изменение DTO на сервере ломает
 * typecheck мока.
 */

export interface DemoRequest<Body = unknown> {
  params: Record<string, string>
  query: URLSearchParams
  body: Body
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Handler = (req: DemoRequest<any>) => unknown

interface Route {
  method: Method
  pattern: RegExp
  keys: string[]
  handler: Handler
}

/** Ответ с ошибкой: тело приходит в ядро клиента как от настоящего сервера */
export class DemoError extends Error {
  readonly status: number
  readonly body: Record<string, unknown>

  constructor(status: number, body: Record<string, unknown> = {}) {
    super(`Demo response ${status}`)
    this.status = status
    this.body = body
  }
}

/** Статус ответа «в демо недоступно» */
export const UNAVAILABLE = 501

/** Действие, которое без сервера честно не показать */
export function unavailable(): never {
  throw new DemoError(UNAVAILABLE)
}

/** Ответ без тела (204) */
export const NO_CONTENT = Symbol('no content')

const routes: Route[] = []

function compile(path: string) {
  const keys: string[] = []
  const source = path
    .replace(/\/$/, '')
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':'))
        return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      keys.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')

  // Генератор пишет часть путей со слэшем в конце (`/api/about/`)
  return { pattern: new RegExp(`^${source}/?$`), keys }
}

type Result<Res> = Res | typeof NO_CONTENT

function define(method: Method) {
  return <Res = void, Body = unknown>(
    path: string,
    handler: (req: DemoRequest<Body>) => Result<Res> | Promise<Result<Res>>,
  ) => {
    routes.push({ method, ...compile(path), handler })
  }
}

export const get = define('GET')
export const post = define('POST')
export const put = define('PUT')
export const patch = define('PATCH')
export const del = define('DELETE')

export function match(method: string, path: string) {
  for (const route of routes) {
    if (route.method !== method.toUpperCase())
      continue

    const found = route.pattern.exec(path)
    if (!found)
      continue

    const params: Record<string, string> = {}
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(found[index + 1]!)
    })

    return { handler: route.handler, params }
  }

  return undefined
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function parseBody(body: BodyInit | null | undefined) {
  if (typeof body !== 'string')
    return body ?? undefined

  try {
    return JSON.parse(body)
  }
  catch {
    return body
  }
}

/**
 * Отвечает на запрос `/api/*` моком. Пути без мока и `unavailable()` — 501 с
 * текстом `unavailableMessage`: ядро клиента покажет его, как ошибку сервера.
 */
export async function handle(
  url: URL,
  init: RequestInit,
  unavailableMessage: string,
) {
  const found = match(init.method ?? 'GET', url.pathname)

  if (!found)
    return json({ message: unavailableMessage }, UNAVAILABLE)

  try {
    const result = await found.handler({
      params: found.params,
      query: url.searchParams,
      body: parseBody(init.body),
    })

    if (result === NO_CONTENT)
      return new Response(null, { status: 204 })

    return json(result ?? { ok: true })
  }
  catch (error) {
    if (error instanceof DemoError) {
      return json({ message: unavailableMessage, ...error.body }, error.status)
    }

    throw error
  }
}
