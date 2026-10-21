import type {
  CreateTorrentInput,
  EngineUnavailableResponse,
  Torrent,
  TorrentList,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { api } from '~/services/api'

export type EngineState = TorrentList['engine']
export type TorrentErrorKind
  = EngineUnavailableResponse['kind'] | 'invalid' | 'timeout' | 'unknown'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Метаданные magnet сервер ждёт в фоне до 5 минут: пока есть такие раздачи,
// список перечитывается сам
const POLL_INTERVAL_MS = 2000
const POLL_LIMIT_MS = 6 * 60 * 1000

const torrents = shallowRef<Torrent[]>([])
const engine = ref<EngineState>('ready')
const state = ref<LoadState>('idle')

let pollTimer: ReturnType<typeof setTimeout> | undefined
let pollStartedAt = 0

/** Причина ошибки запроса для текста панели: движок, неверный ввод, таймаут */
export async function torrentErrorKind(
  err: unknown,
): Promise<TorrentErrorKind> {
  const status = getErrorStatus(err)

  if (status === 503) {
    const body = await getErrorBody<Partial<EngineUnavailableResponse>>(err)

    return body?.kind ?? 'starting'
  }

  if (status === 400)
    return 'invalid'

  if (status === 504)
    return 'timeout'

  return 'unknown'
}

function replaceTorrent(updated: Torrent) {
  const exists = torrents.value.some(item => item.id === updated.id)

  torrents.value = exists
    ? torrents.value.map(item => (item.id === updated.id ? updated : item))
    : [updated, ...torrents.value]
}

async function fetchAll() {
  const list = await api.torrents.getTorrents()

  torrents.value = list.items
  engine.value = list.engine
}

function hasResolving() {
  return torrents.value.some(item => item.status === 'resolving')
}

function stopPolling() {
  clearTimeout(pollTimer)
  pollTimer = undefined
}

function schedulePoll() {
  if (pollTimer || !hasResolving())
    return

  pollStartedAt = Date.now()

  const tick = async () => {
    try {
      await withErrorMode('silent', fetchAll)
    }
    catch {
      // Сеть моргнула: следующий тик попробует снова
    }

    if (hasResolving() && Date.now() - pollStartedAt < POLL_LIMIT_MS)
      pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
    else pollTimer = undefined
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

async function load() {
  state.value = 'loading'

  try {
    await withErrorMode('silent', fetchAll)
    state.value = 'ready'
    schedulePoll()
  }
  catch {
    state.value = 'error'
  }
}

/** Ошибку добавления показывает форма: запрос в `silent` */
async function addTorrent(body: CreateTorrentInput) {
  const added = await withErrorMode('silent', () =>
    api.torrents.postTorrent(body))
  const existed = torrents.value.some(item => item.id === added.id)

  replaceTorrent(added)
  schedulePoll()

  return { torrent: added, existed }
}

async function retryTorrent(id: string) {
  const retried = await withErrorMode('silent', () =>
    api.torrents.postTorrentRetry(id))

  replaceTorrent(retried)
  schedulePoll()

  return retried
}

/** Ошибку удаления показывает диалог: запрос в `silent` */
async function deleteTorrent(id: string) {
  await withErrorMode('silent', () => api.torrents.deleteTorrent(id))
  torrents.value = torrents.value.filter(item => item.id !== id)
}

export function useTorrents() {
  return {
    torrents: computed(() => torrents.value),
    engine: readonly(engine),
    state: readonly(state),
    isEmpty: computed(() => torrents.value.length === 0),
    load,
    addTorrent,
    retryTorrent,
    deleteTorrent,
    stopPolling,
  }
}
