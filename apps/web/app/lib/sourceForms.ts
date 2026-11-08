import * as z from 'zod'
import type { UpdateIndexerInput } from '@torsher/api-client'

/** Правила совпадают с DTO сервера: адрес только http(s), ключ до 500 символов */
export function httpUrlSchema(message: string) {
  return z
    .string()
    .trim()
    .max(2000, message)
    .refine((value) => {
      try {
        return ['http:', 'https:'].includes(new URL(value).protocol)
      }
      catch {
        return false
      }
    }, message)
}

/** Поле формы, к которому относится ошибка проверки источника на сервере */
export function fieldOfSourceError(kind: string): 'url' | 'apiKey' | null {
  if (kind === 'auth')
    return 'apiKey'

  if (
    [
      'timeout',
      'unreachable',
      'loopback',
      'mdns',
      'bad_response',
      'unsupported',
    ].includes(kind)
  ) {
    return 'url'
  }

  return null
}

/** Cookie сессии Torznab: те же ограничения, что у DTO сервера. */
export function isSessionCookie(value: string) {
  if (
    !value
    || value.length > 8192
    || value
      .split('')
      .some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  ) {
    return false
  }
  return value.split(';').every((part) => {
    const pair = part.trim()
    const split = pair.indexOf('=')
    const name = pair.slice(0, split)
    return (
      split > 0
      && /^[!#$%&'*+.^`|~\w-]+$/.test(name)
      && name.toLowerCase() !== 'cf_clearance'
      && /^(?:[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*|"[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*")$/.test(
        pair.slice(split + 1),
      )
    )
  })
}

/** Управляемый источник правит только Cookie; остальные поля задаёт менеджер. */
export function indexerUpdateBody(
  values: {
    name: string
    apiKey?: string
    sessionCookie?: string
    removeCookie: boolean
  },
  managed: boolean,
): UpdateIndexerInput {
  return {
    ...(!managed && { name: values.name, apiKey: values.apiKey }),
    sessionCookie:
      values.sessionCookie || (values.removeCookie ? null : undefined),
  }
}
