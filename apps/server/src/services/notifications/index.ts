import type { NewNotification, Notification } from './inbox.ts'
import { logFor } from '../logs/index.ts'
import { deliver } from './delivery.ts'
import { addNotification } from './inbox.ts'

export { groupOf } from './catalog.ts'
export {
  listNotifications,
  markNotificationsRead,
  purgeNotifications,
  unreadNotifications,
} from './inbox.ts'

/** Событие в центр панели и в каналы, которые его выбрали */
export function notify(
  input: NewNotification,
  options: { external?: boolean } = {},
) {
  const row = addNotification(input)

  if (options.external !== false) {
    try {
      deliver({ row, resolved: false })
    }
    catch (err) {
      logFor('notifications').error({ err }, 'Notification delivery failed')
    }
  }

  return row
}

/** Проблема прошла: «решено» уходит туда же, куда ушло «появилась» */
export function notifyResolved(row: Notification) {
  try {
    deliver({ row, resolved: true })
  }
  catch (err) {
    logFor('notifications').error({ err }, 'Notification delivery failed')
  }
}
