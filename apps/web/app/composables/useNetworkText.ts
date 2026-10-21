import type { NetHost, NetRoute } from '@torsher/api-client'
import type { HostStatusView } from '~/lib/netStatus'
import { useI18n } from 'vue-i18n'

type RouteSummary = Pick<NetRoute, 'via' | 'dns' | 'match' | 'envProxy'> & {
  proxy?: string | null
}

/** Тексты «Сети»: способ и DNS маршрута, статус и причина у хоста */
export function useNetworkText() {
  const { t } = useI18n()

  /** «Напрямую · DoH Quad9», «SOCKS5 10.0.0.2:1080»: DNS у прокси не показываем — имена разрешает он */
  function routeText(route: RouteSummary) {
    if (route.envProxy)
      return t('panel.settings.network.via.env')

    const via = t(`panel.settings.network.via.${route.via}`)

    if (route.via !== 'direct')
      return route.proxy ? `${via} ${route.proxy}` : via

    return `${via} · ${t(`panel.settings.network.dns.${route.dns}`)}`
  }

  function statusLabel(view: HostStatusView) {
    if (view.state === 'ok' && view.spoofed)
      return t('panel.settings.network.status.spoofedRouted')

    return t(`panel.settings.network.status.${view.state}`)
  }

  /** Причина в строке хоста вместо маршрута: что случилось и что сделать */
  function reason(host: NetHost, view: HostStatusView) {
    if (view.state === 'checking' || view.state === 'pending')
      return ''

    if (view.spoofed) {
      return t(
        view.state === 'ok'
          ? 'panel.settings.network.reasons.spoofedRouted'
          : 'panel.settings.network.reasons.spoofed',
      )
    }

    if (view.state === 'ok')
      return ''

    return t(`panel.settings.network.reasons.${view.state}`, {
      code: host.httpStatus ?? '',
    })
  }

  return { routeText, statusLabel, reason }
}
