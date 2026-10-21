import type { Indexer } from '@torsher/api-client'
import type { Component } from 'vue'
import type { BadgeVariants } from '@/components/ui/badge'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleIcon,
  CircleXIcon,
  ClockIcon,
  Loader2Icon,
} from '@lucide/vue'

type CheckStatus = NonNullable<Indexer['checkStatus']>

export type IndexerState
  = | 'ok'
    | 'pending'
    | 'checking'
    | 'disabled'
    | 'missing'
    | Exclude<CheckStatus, 'ok'>

export type StatusTone
  = 'success' | 'warning' | 'info' | 'destructive' | 'muted'

export interface IndexerStatusView {
  state: IndexerState
  tone: StatusTone
  icon: Component
  badge: NonNullable<BadgeVariants['variant']>
  /** Ошибка или пропажа: индексатор попадает в группу «Требуют внимания» */
  needsAttention: boolean
}

const ERROR_STATUSES = new Set<CheckStatus>([
  'auth',
  'unreachable',
  'bad_response',
  'remote',
])

export const toneText: Record<StatusTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  info: 'text-info',
  destructive: 'text-destructive',
  muted: 'text-muted-foreground',
}

/**
 * Одно место, где статус индексатора превращается в иконку, цвет и бейдж.
 * Порядок важен: выключенный не требует внимания, идущая проверка важнее
 * прошлого результата, ошибка важнее пропажи из менеджера.
 */
export function indexerStatusView(
  indexer: Pick<Indexer, 'enabled' | 'checkStatus' | 'missing'>,
  isChecking = false,
): IndexerStatusView {
  if (!indexer.enabled) {
    return view('disabled', 'muted', CircleDashedIcon, 'outline')
  }

  if (isChecking)
    return view('checking', 'info', Loader2Icon, 'info')

  const status = indexer.checkStatus

  if (status === 'timeout')
    return view('timeout', 'warning', ClockIcon, 'warning', true)

  if (status && ERROR_STATUSES.has(status))
    return view(status, 'destructive', CircleXIcon, 'destructive', true)

  if (indexer.missing)
    return view('missing', 'warning', CircleAlertIcon, 'warning', true)

  if (status === null)
    return view('pending', 'muted', CircleIcon, 'outline')

  return view('ok', 'success', CircleCheckIcon, 'success')
}

export function needsAttention(
  indexer: Pick<Indexer, 'enabled' | 'checkStatus' | 'missing'>,
) {
  return indexerStatusView(indexer).needsAttention
}

function view(
  state: IndexerState,
  tone: StatusTone,
  icon: Component,
  badge: IndexerStatusView['badge'],
  attention = false,
): IndexerStatusView {
  return { state, tone, icon, badge, needsAttention: attention }
}
