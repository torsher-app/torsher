import type { LogEntry } from '@torsher/api-client'
import type { Component } from 'vue'
import type { BadgeVariants } from '@/components/ui/badge'
import type { StatusTone } from '~/lib/indexerStatus'
import { CircleAlertIcon, CircleXIcon } from '@lucide/vue'

export type LogLevel = LogEntry['level']
export type LogSource = LogEntry['source']

/** Фильтр уровня в адресе: «Все» — обычные записи, остальное — минимальный уровень */
export type LogsLevelFilter = 'all' | 'warn' | 'error'

export const LEVEL_FILTERS: LogsLevelFilter[] = ['all', 'warn', 'error']

export interface LogLevelView {
  /** Нет иконки — приглушённая точка: info и debug не должны бросаться в глаза */
  icon?: Component
  tone: StatusTone
  badge: NonNullable<BadgeVariants['variant']>
}

export function logLevelView(level: LogLevel): LogLevelView {
  switch (level) {
    case 'error':
      return { icon: CircleXIcon, tone: 'destructive', badge: 'destructive' }
    case 'warn':
      return { icon: CircleAlertIcon, tone: 'warning', badge: 'warning' }
    default:
      return { tone: 'muted', badge: 'outline' }
  }
}

// Record, а не массив: новый источник на сервере ломает typecheck, пока у него нет подписи
export const logSourceLabels: Record<LogSource, string> = {
  server: 'panel.logs.sources.server',
  engine: 'panel.logs.sources.engine',
  playback: 'panel.logs.sources.playback',
  storage: 'panel.logs.sources.storage',
  sources: 'panel.logs.sources.sources',
  catalog: 'panel.logs.sources.catalog',
  network: 'panel.logs.sources.network',
  notifications: 'panel.logs.sources.notifications',
  auth: 'panel.logs.sources.auth',
  backups: 'panel.logs.sources.backups',
}

export const LOG_SOURCES = Object.keys(logSourceLabels) as LogSource[]

/** Поля записи с id: по значению панель собирает все записи одного случая */
export const LOG_ID_KEYS = new Set([
  'infoHash',
  'torrentId',
  'session',
  'libraryId',
  'titleId',
  'indexerId',
  'deviceId',
])

export function isLogSource(value: unknown): value is LogSource {
  return LOG_SOURCES.includes(value as LogSource)
}

function contextValue(value: string | number | boolean) {
  const text = String(value)

  return /[\s"=]/.test(text) || text === '' ? JSON.stringify(text) : text
}

/** Запись текстом в том же виде, что строка скачанного журнала */
export function formatLogEntry(
  entry: Pick<
    LogEntry,
    'time' | 'level' | 'source' | 'message' | 'details' | 'context'
  >,
) {
  let line = `${entry.time} ${entry.level.toUpperCase().padEnd(5)} ${entry.source.padEnd(7)} ${entry.message}`

  for (const [key, value] of Object.entries(entry.context ?? {}))
    line += ` ${key}=${contextValue(value)}`

  if (entry.details) {
    const details = entry.details
      .split('\n')
      .map(row => `    ${row}`)
      .join('\n')

    line += `\n${details}`
  }

  return `${line}\n`
}

/** Ключ дня в местном времени: группы журнала делятся по календарю браузера */
export function dayKeyOf(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${date.getFullYear()}-${month}-${day}`
}

/** «14:03:27»: в строке журнала важны секунды */
export function formatLogTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso))
}

/** Полная дата с секундами — для подсказки и карточки */
export function formatLogDateTime(iso: string, locale: string) {
  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    dateStyle: 'long',
    timeStyle: 'medium',
  }).format(new Date(iso))
}

/** «20 октября», с годом — только если он не текущий */
export function formatLogDay(date: Date, locale: string, now: Date) {
  return new Intl.DateTimeFormat(locale.replace('_', '-'), {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
}

/** Имя скачанного файла — по дате у пользователя, а не на сервере */
export function logFileName(now = new Date()) {
  return `torsher-${dayKeyOf(now)}.log`
}
