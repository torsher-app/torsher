import type { BackupItem, RestoreWarning } from '@torsher/api-client'
import type { Component } from 'vue'
import {
  ArchiveRestoreIcon,
  CalendarClockIcon,
  DatabaseBackupIcon,
  FileUpIcon,
  HandIcon,
  PackageCheckIcon,
} from '@lucide/vue'
import { formatBytes } from '~/lib/format'

type Translate = (
  key: string,
  params?: Record<string, unknown>,
  plural?: number,
) => string

export const backupReasonIcons: Record<BackupItem['reason'], Component> = {
  'scheduled': CalendarClockIcon,
  'manual': HandIcon,
  'pre-update': PackageCheckIcon,
  'pre-restore': ArchiveRestoreIcon,
  'pre-import': DatabaseBackupIcon,
  'uploaded': FileUpIcon,
}

function tagOf(locale: string) {
  return locale.replace('_', '-')
}

/** Календарный день в поясе: «сегодня» на сервере в UTC и у владельца — разные дни */
function dayKey(date: Date, locale: string, timeZone?: string) {
  return new Intl.DateTimeFormat(tagOf(locale), {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

/** «24 окт., 04:00»; год — только у прошлых лет */
export function formatDayTime(
  iso: string,
  locale: string,
  timeZone?: string,
  now = new Date(),
) {
  const date = new Date(iso)
  const sameYear
    = new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(
      date,
    )
    === new Intl.DateTimeFormat('en', { timeZone, year: 'numeric' }).format(now)

  return new Intl.DateTimeFormat(tagOf(locale), {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: sameYear ? undefined : 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

/** «сегодня в 04:00», «завтра в 04:00», «вчера в 04:00», иначе «24 окт., 04:00» */
export function formatWhen(
  t: Translate,
  iso: string,
  locale: string,
  options: { timeZone?: string, now?: Date } = {},
) {
  const { timeZone, now = new Date() } = options
  const date = new Date(iso)
  const time = new Intl.DateTimeFormat(tagOf(locale), {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  const day = dayKey(date, locale, timeZone)
  const shift = (days: number) =>
    dayKey(new Date(now.getTime() + days * 86_400_000), locale, timeZone)

  if (day === shift(0))
    return t('panel.backups.when.today', { time })

  if (day === shift(1))
    return t('panel.backups.when.tomorrow', { time })

  if (day === shift(-1))
    return t('panel.backups.when.yesterday', { time })

  return formatDayTime(iso, locale, timeZone, now)
}

/** Первая буква заглавная: «Сегодня в 04:00» в начале строки */
export function capitalize(text: string, locale: string) {
  return text.charAt(0).toLocaleUpperCase(tagOf(locale)) + text.slice(1)
}

export interface BackupProblem {
  kind: string
  params?: Record<string, string | number>
}

/** Причина отказа копии или восстановления человеческой фразой */
export function backupErrorText(
  t: Translate,
  locale: string,
  problem: BackupProblem,
) {
  const { need, free } = problem.params ?? {}

  if (problem.kind === 'no_space') {
    return typeof need === 'number' && typeof free === 'number'
      ? t('panel.backups.errors.no_space', {
          need: formatBytes(need, locale),
          free: formatBytes(free, locale),
        })
      : t('panel.backups.errors.no_space_short')
  }

  const key = `panel.backups.errors.${problem.kind}`
  const text = t(key)

  return text === key ? t('panel.backups.errors.unknown') : text
}

const RECONCILED_PARTS = ['removedFromEngine', 'deleted', 'paused'] as const

/** Предупреждение итога восстановления; сверка раздач без изменений — `null` */
export function restoreWarningText(t: Translate, warning: RestoreWarning) {
  if (warning.kind === 'torrents_reconciled') {
    const parts = RECONCILED_PARTS.filter(
      part => Number(warning.params?.[part] ?? 0) > 0,
    ).map(part =>
      t(`panel.backups.result.reconciled.${part}`, {
        n: warning.params?.[part],
      }),
    )

    return parts.length
      ? t('panel.backups.result.reconciled.text', { parts: parts.join(', ') })
      : null
  }

  const key = `panel.backups.result.warnings.${warning.kind}`
  const text = t(key, warning.params ?? {})

  return text === key ? null : text
}
