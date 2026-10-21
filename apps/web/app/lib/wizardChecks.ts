import type { Component } from 'vue'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
  InfoIcon,
  Loader2Icon,
} from '@lucide/vue'

/** `info` — сведение без оценки, `pending` — проверка ещё идёт */
export type CheckStatus = 'ok' | 'warning' | 'error' | 'info' | 'pending'

export interface WizardCheck {
  id: string
  status: CheckStatus
  title: string
  /** Подробность: путь, адрес, цифры */
  text?: string
  /** Технический текст (путь, адрес) — моноширинным */
  mono?: boolean
  /** «Как исправить»: раскрывается под строкой */
  fix?: string
}

export const checkIcons: Record<
  CheckStatus,
  { icon: Component, class: string }
> = {
  ok: { icon: CircleCheckIcon, class: 'text-success' },
  warning: { icon: CircleAlertIcon, class: 'text-warning' },
  error: { icon: CircleXIcon, class: 'text-destructive' },
  info: { icon: InfoIcon, class: 'text-info' },
  pending: { icon: Loader2Icon, class: 'animate-spin text-muted-foreground' },
}

/** Худший итог списка: по нему «Дальше» называет последствие */
export function worstStatus(checks: WizardCheck[]): CheckStatus {
  for (const status of ['error', 'pending', 'warning'] as const) {
    if (checks.some(check => check.status === status))
      return status
  }

  return 'ok'
}
