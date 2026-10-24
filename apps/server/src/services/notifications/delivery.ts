import type { Language } from '@torsher/i18n'
import type { NotificationChannel } from '../../db/schema.ts'
import type { Notification } from './inbox.ts'
import type { RenderedMessage } from './render.ts'
import { setTimeout as sleep } from 'node:timers/promises'
import { logFor } from '../logs/index.ts'
import { groupOf } from './catalog.ts'
import { providerOf } from './channels/index.ts'
import {
  decryptConfig,
  getChannel,
  listChannels,
  recordDelivery,
} from './channels/store.ts'
import { DeliveryError } from './channels/types.ts'
import { addNotification } from './inbox.ts'
import { renderNotification, renderOverflow } from './render.ts'

const HOUR_MS = 60 * 60 * 1000

export const deliveryTiming = {
  // Повторы после сбоя сети или сервиса: 30 с, 2 мин, 10 мин
  retryDelaysMs: [30_000, 120_000, 600_000],
  // Не больше сообщений в час на канал; сверх — одна сводка в конце часа
  hourlyLimit: 20,
  hourMs: HOUR_MS,
}

// Неверный токен или чат повтор не исправит
const RETRYABLE = new Set(['unavailable', 'rate_limited', 'invalid_response'])

export interface OutgoingEvent {
  row: Notification
  resolved: boolean
}

interface ChannelQueue {
  jobs: RenderedMessage[]
  running: boolean
  sent: number[]
  overflow: number
  overflowTimer?: NodeJS.Timeout
}

const queues = new Map<string, ChannelQueue>()

export function wantsEvent(channel: NotificationChannel, event: OutgoingEvent) {
  const group = groupOf(event.row.kind)

  if (!channel.enabled || !group || !channel.events.includes(group))
    return false

  if (event.row.kind !== 'problem')
    return true

  if (event.row.severity === 'warning' && !channel.includeWarnings)
    return false

  return !event.resolved || channel.notifyResolved
}

function queueOf(id: string) {
  let queue = queues.get(id)

  if (!queue) {
    queue = { jobs: [], running: false, sent: [], overflow: 0 }
    queues.set(id, queue)
  }

  return queue
}

export async function sendTo(
  channel: NotificationChannel,
  message: RenderedMessage,
) {
  const provider = providerOf(channel.kind)

  if (!provider) {
    throw new DeliveryError(
      'invalid_config',
      `Unknown channel kind: ${channel.kind}`,
    )
  }

  await provider.send(message, decryptConfig(provider, channel.config))
}

function announceFailure(channel: NotificationChannel) {
  // Один раз на серию сбоев: следующая ошибка того же канала тишину не нарушает
  if (channel.lastError)
    return

  addNotification({
    kind: 'channel_failing',
    severity: 'warning',
    section: 'notifications',
    params: { name: channel.name },
  })
}

async function attempt(id: string, message: RenderedMessage) {
  for (let index = 0; ; index++) {
    // Канал могли выключить или удалить, пока сообщение ждало повтора
    const channel = getChannel(id)

    if (!channel || !channel.enabled)
      return

    try {
      await sendTo(channel, message)
      recordDelivery(id, { ok: true })

      return
    }
    catch (err) {
      const kind = err instanceof DeliveryError ? err.kind : 'unavailable'
      const delay = deliveryTiming.retryDelaysMs[index]

      if (delay !== undefined && RETRYABLE.has(kind)) {
        const retryAfter
          = err instanceof DeliveryError ? err.retryAfterMs : undefined

        await sleep(Math.max(delay, retryAfter ?? 0), undefined, {
          ref: false,
        })
        continue
      }

      logFor('notifications').warn(
        {
          channelId: id,
          kind: channel.kind,
          error: kind,
          status: err instanceof DeliveryError ? err.status : undefined,
        },
        'Notification was not delivered',
      )
      announceFailure(channel)
      recordDelivery(id, { ok: false, kind })

      return
    }
  }
}

function scheduleOverflow(id: string, queue: ChannelQueue, now: number) {
  if (queue.overflowTimer)
    return

  const wait = Math.max(
    0,
    (queue.sent[0] ?? now) + deliveryTiming.hourMs - now,
  )

  queue.overflowTimer = setTimeout(() => {
    queue.overflowTimer = undefined

    const channel = getChannel(id)
    const count = queue.overflow

    queue.overflow = 0

    if (channel && count > 0) {
      queue.jobs.push(
        renderOverflow(count, channel.language as Language, channel.panelUrl),
      )
      void drain(id)
    }
  }, wait)
  queue.overflowTimer.unref()
}

async function drain(id: string) {
  const queue = queueOf(id)

  if (queue.running)
    return

  queue.running = true

  try {
    for (
      let message = queue.jobs.shift();
      message;
      message = queue.jobs.shift()
    ) {
      const now = Date.now()

      queue.sent = queue.sent.filter(at => now - at < deliveryTiming.hourMs)

      if (
        message.event !== 'overflow'
        && queue.sent.length >= deliveryTiming.hourlyLimit
      ) {
        queue.overflow += 1
        scheduleOverflow(id, queue, now)
        continue
      }

      queue.sent.push(now)
      await attempt(id, message)
    }
  }
  finally {
    queue.running = false
  }
}

/** Событие — в каждый включённый канал, который его выбрал, на языке канала */
export function deliver(event: OutgoingEvent) {
  for (const channel of listChannels()) {
    if (!wantsEvent(channel, event))
      continue

    queueOf(channel.id).jobs.push(
      renderNotification(event.row, {
        resolved: event.resolved,
        language: channel.language as Language,
        panelUrl: channel.panelUrl,
      }),
    )
    void drain(channel.id).catch(err =>
      logFor('notifications').error({ err }, 'Notification delivery failed'),
    )
  }
}

/** Дождаться очередей — для тестов и остановки */
export async function idleDelivery() {
  while (
    [...queues.values()].some(queue => queue.running || queue.jobs.length)
  )
    await sleep(5)
}

export function resetDelivery() {
  for (const queue of queues.values()) clearTimeout(queue.overflowTimer)

  queues.clear()
}
