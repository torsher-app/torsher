import type { AttentionItem } from '../../dto/overview.ts'
import type {
  NotificationItem,
  NotificationKind,
  NotificationParams,
  NotificationSection,
} from '../../dto/notifications.ts'
import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notInArray,
  or,
} from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { notifications } from '../../db/schema.ts'

export type Notification = typeof notifications.$inferSelect

const KEEP_DAYS = 90
const KEEP_ROWS = 1000

export interface NewNotification {
  kind: NotificationKind
  problem?: AttentionItem['kind']
  severity: Notification['severity']
  section?: NotificationSection
  params: NotificationParams
}

export function addNotification(input: NewNotification, now = new Date()) {
  return getDb()
    .insert(notifications)
    .values({ ...input, createdAt: now })
    .returning()
    .get()
}

export function getNotification(id: string) {
  return getDb()
    .select()
    .from(notifications)
    .where(eq(notifications.id, id))
    .get()
}

/** Открытые проблемы: по ним монитор помнит состояние после перезапуска */
export function openProblems() {
  return getDb()
    .select()
    .from(notifications)
    .where(
      and(eq(notifications.kind, 'problem'), isNull(notifications.resolvedAt)),
    )
    .all()
}

/** Решённые проблемы, чьё внешнее «решено» не ушло: монитор доводит их после перезапуска */
export function pendingResolutions(since: Date) {
  return getDb()
    .select()
    .from(notifications)
    .where(
      and(
        eq(notifications.kind, 'problem'),
        gte(notifications.resolvedAt, since),
        isNull(notifications.resolutionSentAt),
      ),
    )
    .all()
}

export function markResolutionSent(id: string, now = new Date()) {
  getDb()
    .update(notifications)
    .set({ resolutionSentAt: now })
    .where(eq(notifications.id, id))
    .run()
}

export function resolveNotification(id: string, now = new Date()) {
  getDb()
    .update(notifications)
    .set({ resolvedAt: now })
    .where(eq(notifications.id, id))
    .run()
}

/** Проблема вернулась вскоре после решения — та же строка снова открыта и не прочитана */
export function reopenNotification(id: string, params: NotificationParams) {
  getDb()
    .update(notifications)
    .set({ resolvedAt: null, resolutionSentAt: null, readAt: null, params })
    .where(eq(notifications.id, id))
    .run()
}

export function updateNotificationParams(
  id: string,
  params: NotificationParams,
) {
  getDb()
    .update(notifications)
    .set({ params })
    .where(eq(notifications.id, id))
    .run()
}

export function toNotificationItem(row: Notification): NotificationItem {
  return {
    id: row.id,
    kind: row.kind as NotificationKind,
    problem: (row.problem ?? undefined) as NotificationItem['problem'],
    severity: row.severity,
    section: (row.section ?? undefined) as NotificationItem['section'],
    params: row.params as NotificationParams,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
  }
}

export function unreadNotifications() {
  return (
    getDb()
      .select({ value: count() })
      .from(notifications)
      .where(isNull(notifications.readAt))
      .get()
      ?.value ?? 0
  )
}

/** Лента «свежее сверху»; курсор — последняя показанная строка */
export function listNotifications(options: { before?: string, limit: number }) {
  const cursor = options.before ? getNotification(options.before) : undefined
  const rows = getDb()
    .select()
    .from(notifications)
    .where(
      cursor
        ? or(
            lt(notifications.createdAt, cursor.createdAt),
            and(
              eq(notifications.createdAt, cursor.createdAt),
              lt(notifications.id, cursor.id),
            ),
          )
        : undefined,
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(options.limit + 1)
    .all()
  const page = rows.slice(0, options.limit)

  return {
    items: page.map(toNotificationItem),
    nextCursor: rows.length > options.limit ? page.at(-1)?.id : undefined,
    unread: unreadNotifications(),
  }
}

export function markNotificationsRead(ids: string[] | 'all', now = new Date()) {
  getDb()
    .update(notifications)
    .set({ readAt: now })
    .where(
      ids === 'all'
        ? isNull(notifications.readAt)
        : and(isNull(notifications.readAt), inArray(notifications.id, ids)),
    )
    .run()
}

/**
 * Центр — не архив: 90 дней и не больше 1000 строк. Открытые проблемы
 * не удаляются, пока не решены.
 */
export function purgeNotifications(now = Date.now()) {
  const db = getDb()
  const closed = or(
    isNotNull(notifications.resolvedAt),
    ne(notifications.kind, 'problem'),
  )

  db.delete(notifications)
    .where(
      and(
        lt(
          notifications.createdAt,
          new Date(now - KEEP_DAYS * 24 * 60 * 60 * 1000),
        ),
        closed,
      ),
    )
    .run()

  const keep = db
    .select({ id: notifications.id })
    .from(notifications)
    .orderBy(desc(notifications.createdAt))
    .limit(KEEP_ROWS)
    .all()
    .map(row => row.id)

  if (keep.length === KEEP_ROWS) {
    db.delete(notifications)
      .where(and(notInArray(notifications.id, keep), closed))
      .run()
  }
}
