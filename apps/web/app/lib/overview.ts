import type { AttentionItem } from '@torsher/api-client'
import type { RouteLocationRaw } from 'vue-router'

/** Куда ведёт причина из «Требует внимания»: туда, где она чинится */
export const attentionLinks: Record<
  AttentionItem['section'],
  RouteLocationRaw
> = {
  downloads: '/downloads',
  storage: '/settings/storage',
  sources: { path: '/sources', query: { filter: 'attention' } },
  network: '/settings/network',
  metadata: '/settings/metadata',
}

/** «Работает 3 дня»: одна самая крупная единица, точность тут не нужна */
export function uptimeOf(startedAt: string, now = Date.now()) {
  const minutes = Math.max(
    0,
    Math.floor((now - new Date(startedAt).getTime()) / 60_000),
  )

  if (minutes < 60)
    return { unit: 'minutes' as const, value: minutes }

  const hours = Math.floor(minutes / 60)

  return hours < 24
    ? { unit: 'hours' as const, value: hours }
    : { unit: 'days' as const, value: Math.floor(hours / 24) }
}
