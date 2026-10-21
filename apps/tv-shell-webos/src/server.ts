export type CheckResult = 'ok' | 'timeout' | 'unreachable' | 'notTorsher'

export const CHECK_TIMEOUT_MS = 5000

const SCHEME = /^[a-z][\w+.-]*:\/\//i

/**
 * Адрес из поля ввода → базовый URL сервера без хвостового `/`. Без схемы —
 * `http://`: в домашней сети сервер обычно без TLS. Порт не подставляем,
 * сервер может стоять за обратным прокси на 80 или 443.
 */
export function normalizeAddress(input: string): string | null {
  const value = input.trim()
  if (!value)
    return null

  let url: URL
  try {
    url = new URL(SCHEME.test(value) ? value : `http://${value}`)
  }
  catch {
    return null
  }

  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname)
    return null

  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`
}

/** `http://` в подписи лишний, `https://` оставляем: он о чём-то говорит */
export function displayAddress(base: string) {
  return base.replace(/^http:\/\//, '')
}

export function healthUrl(base: string) {
  return `${base}/api/health`
}

/**
 * Витрина отдаётся с корня сервера; `platform=tv` включает режим ТВ.
 * `shell` — номер записи обёртки в истории: по нему «Сменить сервер»
 * в витрине возвращается сюда, даже если между ними был вход через панель.
 */
export function showcaseUrl(base: string, shellIndex: number) {
  return `${base}/?platform=tv&shell=${shellIndex}`
}

function isHealthBody(body: unknown) {
  return (
    typeof body === 'object'
    && body !== null
    && (body as { status?: unknown }).status === 'ok'
  )
}

/**
 * Сервер считается Torsher, если `/api/health` ответил 200 и `{ status: 'ok' }`.
 * Ответ другого сервиса на том же адресе — `notTorsher`, а не «недоступен»:
 * пользователю нужна другая подсказка.
 */
export async function checkServer(
  base: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = CHECK_TIMEOUT_MS,
): Promise<CheckResult> {
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetchImpl(healthUrl(base), {
      signal: controller.signal,
    })
    if (!response.ok)
      return 'notTorsher'

    const body: unknown = await response.json().catch(() => null)
    return isHealthBody(body) ? 'ok' : 'notTorsher'
  }
  catch {
    return timedOut ? 'timeout' : 'unreachable'
  }
  finally {
    clearTimeout(timer)
  }
}
