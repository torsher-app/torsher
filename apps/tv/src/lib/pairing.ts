import type { PairingStatus } from '@torsher/api-client'

// Сервер пускает 60 опросов в минуту с адреса: раз в 3 с остаётся запас
export const POLL_MS = 3000
// Сервер не ответил или просит подождать: код на экране остаётся, опрос реже
export const POLL_BACKOFF_MS = 10_000

/** Код читается тройками: так его легче переписать с экрана */
export function formatCode(code: string) {
  const half = Math.ceil(code.length / 2)

  return `${code.slice(0, half)} ${code.slice(half)}`
}

/**
 * Адрес панели того же сервера без протокола: `192.168.1.10:8080/panel`.
 * Считается от витрины, так он верен и за обратным прокси с подпутём.
 */
export function panelAddress(location: Pick<Location, 'href'>) {
  const url = new URL('panel/', location.href)

  return `${url.host}${url.pathname.replace(/\/$/, '')}`
}

export type PollStep
  = { kind: 'wait', ms: number } | { kind: 'restart' } | { kind: 'approved' }

/**
 * Что делать после опроса: ответ сервера или HTTP-статус ошибки
 * (`undefined` — сервер не ответил). Истёкший и забытый сервером код
 * меняется на новый без участия человека.
 */
export function pollStep(
  result: Pick<PairingStatus, 'status'> | { error: number | undefined },
): PollStep {
  if ('error' in result) {
    return result.error === 404
      ? { kind: 'restart' }
      : { kind: 'wait', ms: POLL_BACKOFF_MS }
  }

  switch (result.status) {
    case 'approved':
      return { kind: 'approved' }
    case 'expired':
      return { kind: 'restart' }
    default:
      return { kind: 'wait', ms: POLL_MS }
  }
}
