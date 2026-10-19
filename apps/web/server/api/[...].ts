import { joinURL } from 'ufo'

/**
 * Единственный мост клиент → backend.
 *
 * Браузер ходит только на /api/* того же origin, поэтому сессионные
 * cookie остаются same-origin и httpOnly: клиентскому коду не нужно
 * (и нельзя) читать токены.
 */
export default defineEventHandler((event) => {
  const { proxyUrl } = useRuntimeConfig()
  const path = event.path.replace(/^\/api/, '')

  return proxyRequest(event, joinURL(proxyUrl, path))
})
