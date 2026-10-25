import type { Language } from '@torsher/i18n'
import type { NotificationItem } from '@torsher/api-client'
import type { RouteLocationRaw } from 'vue-router'
import { followNotificationText, isFollowNotification } from '@torsher/i18n'
import { attentionText } from '~/lib/attentionText'
import { attentionLinks } from '~/lib/overview'

type Translate = (
  key: string,
  params?: Record<string, unknown>,
  plural?: number,
) => string

/** Куда ведёт уведомление: туда, где его разбирают */
export function notificationLink(
  item: NotificationItem,
): RouteLocationRaw | undefined {
  switch (item.section) {
    case undefined:
      return undefined
    case 'about':
      return '/settings/about'
    case 'people':
      return '/people'
    case 'notifications':
      return '/settings/notifications'
    default:
      return attentionLinks[item.section]
  }
}

/** Заголовок строки центра: у проблемы — текст из «Требует внимания» */
export function notificationTitle(
  t: Translate,
  locale: string,
  item: NotificationItem,
) {
  if (item.kind === 'problem' && item.problem) {
    return attentionText(t, locale, {
      kind: item.problem,
      params: item.params,
    })
  }

  if (isFollowNotification(item.kind)) {
    return followNotificationText(t, locale as Language, item.kind, item.params)
      .title
  }

  return t(`notifications.events.${item.kind}.title`, { ...item.params })
}

/** Вторая строка — у событий, кроме проблем: у тех текст уже в заголовке */
export function notificationText(
  t: Translate,
  locale: string,
  item: NotificationItem,
) {
  if (item.kind === 'problem')
    return ''

  if (isFollowNotification(item.kind)) {
    return followNotificationText(t, locale as Language, item.kind, item.params)
      .text
  }

  return t(`notifications.events.${item.kind}.text`, { ...item.params })
}
