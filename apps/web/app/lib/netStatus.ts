import type { NetHost } from '@torsher/api-client'
import type { Component } from 'vue'
import type { StatusTone } from './indexerStatus'
import type { BadgeVariants } from '@/components/ui/badge'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleIcon,
  CircleXIcon,
  ClockIcon,
  Loader2Icon,
} from '@lucide/vue'

export type HostState
  = 'ok' | 'pending' | 'checking' | NonNullable<NetHost['status']>

export interface HostStatusView {
  state: HostState
  tone: StatusTone
  icon: Component
  badge: NonNullable<BadgeVariants['variant']>
  /** Системный DNS подменён: в строке — причина вместо маршрута */
  spoofed: boolean
}

/**
 * Одно место, где результат проверки хоста превращается в иконку и цвет.
 * Рабочий хост с подменой DNS — предупреждение: работает только благодаря
 * маршруту, без него витрина опустеет.
 */
export function hostStatusView(
  host: Pick<NetHost, 'status' | 'checking' | 'dnsSpoofed'>,
): HostStatusView {
  const spoofed = host.dnsSpoofed

  if (host.checking) {
    return {
      state: 'checking',
      tone: 'info',
      icon: Loader2Icon,
      badge: 'info',
      spoofed,
    }
  }

  if (!host.status) {
    return {
      state: 'pending',
      tone: 'muted',
      icon: CircleIcon,
      badge: 'outline',
      spoofed,
    }
  }

  if (host.status === 'ok') {
    return spoofed
      ? {
          state: 'ok',
          tone: 'warning',
          icon: CircleAlertIcon,
          badge: 'warning',
          spoofed,
        }
      : {
          state: 'ok',
          tone: 'success',
          icon: CircleCheckIcon,
          badge: 'success',
          spoofed,
        }
  }

  if (host.status === 'timeout') {
    return {
      state: 'timeout',
      tone: 'warning',
      icon: ClockIcon,
      badge: 'warning',
      spoofed,
    }
  }

  return {
    state: host.status,
    tone: 'destructive',
    icon: CircleXIcon,
    badge: 'destructive',
    spoofed,
  }
}

/** Хост не отвечает; подменённый DNS при рабочем маршруте — предупреждение, а не проблема */
export function hostNeedsAttention(host: NetHost) {
  return Boolean(host.status && host.status !== 'ok')
}
