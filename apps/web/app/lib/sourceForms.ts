import * as z from 'zod'

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
