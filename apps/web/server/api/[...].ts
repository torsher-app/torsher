import { joinURL } from 'ufo'

/**
 * Мост клиент → backend в разработке. В продакшене панель отдаёт сам
 * сервер, и /api/* — его собственные роуты.
 *
 * Браузер ходит только на /api/* того же origin, поэтому сессионные
 * cookie остаются same-origin и httpOnly: клиентскому коду не нужно
 * (и нельзя) читать токены.
 */
export default defineEventHandler((event) => {
  const { proxyUrl } = useRuntimeConfig()

  return proxyRequest(event, joinURL(proxyUrl, event.path))
})
