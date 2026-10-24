import type {
  NotificationGroup,
  NotificationKind,
} from '../../dto/notifications.ts'

/**
 * Группа события для внешних каналов. Без группы событие остаётся только
 * в центре панели: «обновлено» владелец видит сам, а сообщение о сломанном
 * канале в этот же канал не дойдёт.
 */
export function groupOf(
  kind: NotificationKind | string,
): NotificationGroup | undefined {
  switch (kind) {
    case 'problem':
      return 'problems'
    case 'update_available':
      return 'updates'
    case 'download_completed':
      return 'downloads'
    case 'device_paired':
      return 'devices'
    default:
      return undefined
  }
}
