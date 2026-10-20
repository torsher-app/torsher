/** Почему экран не смог загрузить данные — от этого зависит текст и действие. */
export type LoadError
  = 'unauthorized' | 'notConfigured' | 'unavailable' | 'notFound' | 'unknown'

export function toLoadError(status: number | undefined): LoadError {
  switch (status) {
    case 401:
      return 'unauthorized'
    case 404:
      return 'notFound'
    case 502:
      return 'unavailable'
    case 503:
      return 'notConfigured'
    default:
      return 'unknown'
  }
}
