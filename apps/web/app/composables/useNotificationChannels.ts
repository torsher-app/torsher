import type {
  NotificationChannel,
  NotificationChannelBody,
  NotificationChannelConfigError,
  NotificationChannelTestBody,
  NotificationChannelTestResult,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

export type ChannelKind = NotificationChannel['kind']

const channels = shallowRef<NotificationChannel[]>([])
const kinds = shallowRef<ChannelKind[]>([])
const state = ref<LoadState>('idle')

async function load() {
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    const list = await withErrorMode('silent', () =>
      api.notifications.getNotificationChannels())

    channels.value = list.items
    kinds.value = list.kinds
    state.value = 'ready'
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

function replace(channel: NotificationChannel) {
  const known = channels.value.some(item => item.id === channel.id)

  channels.value = known
    ? channels.value.map(item => (item.id === channel.id ? channel : item))
    : [...channels.value, channel]
}

/** Поля, которые сервер не принял (422): форма подсвечивает их сама */
export async function channelConfigFields(err: unknown) {
  if (getErrorStatus(err) !== 422)
    return undefined

  return (await getErrorBody<NotificationChannelConfigError>(err))?.fields
}

async function save(body: NotificationChannelBody, id?: string) {
  const channel = id
    ? await api.notifications.updateNotificationChannel(id, body)
    : await api.notifications.createNotificationChannel(body)

  replace(channel)

  return channel
}

async function setEnabled(id: string, enabled: boolean) {
  replace(
    await api.notifications.setNotificationChannelEnabled(id, { enabled }),
  )
}

async function remove(id: string) {
  await api.notifications.deleteNotificationChannel(id)
  channels.value = channels.value.filter(item => item.id !== id)
}

/** Неудача отправки — не ошибка запроса: ответ говорит, что не так */
function test(id: string): Promise<NotificationChannelTestResult> {
  return api.notifications.testNotificationChannel(id)
}

function testDraft(body: NotificationChannelTestBody) {
  return withErrorMode('silent', () =>
    api.notifications.testNotificationChannelDraft(body))
}

function findTelegramChats(input: { token?: string, id?: string }) {
  return api.notifications.findTelegramChats(input)
}

export function useNotificationChannels() {
  return {
    channels: computed(() => channels.value),
    kinds: computed(() => kinds.value),
    state: readonly(state),
    load,
    save,
    setEnabled,
    remove,
    test,
    testDraft,
    findTelegramChats,
  }
}
