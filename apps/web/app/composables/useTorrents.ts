import type {
  CreateTorrentInput,
  EngineUnavailableResponse,
  SeedRule,
  Torrent,
  TorrentList,
} from '@torsher/api-client'
import type { DownloadGroup } from '~/lib/downloadStatus'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { downloadViewOf } from '~/lib/downloadStatus'
import { api } from '~/services/api'

export type EngineState = TorrentList['engine']
export type TorrentErrorKind
  = | EngineUnavailableResponse['kind']
    | 'invalid'
    | 'timeout'
    | 'notReady'
    | 'unknown'

type LoadState = 'idle' | 'loading' | 'error' | 'ready'

// Цифры загрузок живые: пока раздел открыт, список перечитывается сам
const POLL_INTERVAL_MS = 2000

const torrents = shallowRef<Torrent[]>([])
const engine = ref<EngineState>('ready')
const totals = ref<TorrentList['totals']>({ downloadSpeed: 0, uploadSpeed: 0 })
const cache = ref<TorrentList['cache']>({ used: 0, limit: 0 })
const state = ref<LoadState>('idle')

let pollTimer: ReturnType<typeof setTimeout> | undefined
let loadedOnce: Promise<void> | undefined

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

  if (status === 409)
    return 'notReady'

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
  totals.value = list.totals
  cache.value = list.cache
}

function stopPolling() {
  clearTimeout(pollTimer)
  pollTimer = undefined
}

function startPolling() {
  stopPolling()

  const tick = async () => {
    try {
      await withErrorMode('silent', fetchAll)
    }
    catch {
      // Сеть моргнула: следующий тик попробует снова
    }

    pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
  }

  pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
}

/** Раздел загрузок: первая загрузка и живой опрос до ухода со страницы */
async function load() {
  // Показанное остаётся на экране, пока идёт новый запрос, и ошибка его не прячет
  if (state.value !== 'ready')
    state.value = 'loading'

  try {
    await withErrorMode('silent', fetchAll)
    state.value = 'ready'
    startPolling()
  }
  catch {
    if (state.value === 'loading')
      state.value = 'error'
  }
}

/** Сайдбару нужен список один раз: точка «идут загрузки» и счётчик проблем */
function ensureLoaded() {
  loadedOnce ??= withErrorMode('silent', fetchAll).catch(() => {
    loadedOnce = undefined
  })

  return loadedOnce
}

/** Ошибку добавления показывает форма: запрос в `silent` */
async function addTorrent(body: CreateTorrentInput) {
  const added = await withErrorMode('silent', () =>
    api.torrents.postTorrent(body))
  const existed = torrents.value.some(item => item.id === added.id)

  replaceTorrent(added)

  return { torrent: added, existed }
}

async function retryTorrent(id: string) {
  const retried = await withErrorMode('silent', () =>
    api.torrents.postTorrentRetry(id))

  replaceTorrent(retried)

  return retried
}

/** Ошибку удаления показывает диалог: запрос в `silent` */
async function deleteTorrent(id: string, withFiles: boolean) {
  await withErrorMode('silent', () =>
    api.torrents.deleteTorrent(id, { files: withFiles ? 'delete' : 'keep' }))
  torrents.value = torrents.value.filter(item => item.id !== id)
}

/** Действия строки и карточки: ошибку показывает вызывающий код тостом */
async function downloadFiles(id: string, files: number[]) {
  const updated = await withErrorMode('silent', () =>
    api.torrents.postTorrentDownload(id, { files }))

  replaceTorrent(updated)

  return updated
}

/** «Качать первым»: файлы выбора, которые качаются раньше порядка серий */
async function setFirstFiles(id: string, files: number[]) {
  const updated = await withErrorMode('silent', () =>
    api.torrents.putTorrentFirst(id, { files }))

  replaceTorrent(updated)

  return updated
}

async function setPaused(id: string, paused: boolean) {
  const updated = await withErrorMode('silent', () =>
    paused
      ? api.torrents.postTorrentPause(id)
      : api.torrents.postTorrentResume(id))

  replaceTorrent(updated)

  return updated
}

async function setKept(id: string, kept: boolean) {
  const updated = await withErrorMode('silent', () =>
    api.torrents.putTorrentRetention(id, {
      retention: kept ? 'keep' : 'cache',
    }))

  replaceTorrent(updated)

  return updated
}

/** «Исправить совпадение»: ошибку показывает диалог, запрос в `silent` */
async function setTitle(id: string, titleId: string | null) {
  const updated = await withErrorMode('silent', () =>
    api.torrents.putTorrentTitle(id, { titleId }))

  replaceTorrent(updated)

  return updated
}

/** Своё правило раздачи загрузки; `null` — как в настройках. Ошибку показывает API-клиент */
async function setSeedRule(id: string, rule: SeedRule | null) {
  const updated = await api.torrents.putTorrentSeeding(id, { rule })

  replaceTorrent(updated)

  return updated
}

/** Ошибку показывает диалог: запрос в `silent` */
async function removeFromLibrary(id: string) {
  const updated = await withErrorMode('silent', () =>
    api.torrents.deleteTorrentLibrary(id))

  replaceTorrent(updated)

  return updated
}

/**
 * Перезапуск движка: сервер отвечает сразу, а процесс поднимается сам —
 * состояние «запускается» ставим тут же, дальше его уточняет опрос
 */
async function restartEngine() {
  await api.engine.restartEngine()
  engine.value = 'starting'
}

export function useTorrents() {
  return {
    torrents: computed(() => torrents.value),
    engine: readonly(engine),
    totals: readonly(totals),
    cache: readonly(cache),
    state: readonly(state),
    isEmpty: computed(() => torrents.value.length === 0),
    // Для сайдбара: что-то качается сейчас и сколько раздач требуют внимания
    isDownloading: computed(() =>
      torrents.value.some(item =>
        ['downloading', 'stalled'].includes(item.state),
      ),
    ),
    attentionCount: computed(
      () =>
        torrents.value.filter(item => downloadViewOf(item).attention).length,
    ),
    load,
    ensureLoaded,
    addTorrent,
    retryTorrent,
    deleteTorrent,
    downloadFiles,
    setFirstFiles,
    setPaused,
    setKept,
    removeFromLibrary,
    setTitle,
    setSeedRule,
    restartEngine,
    stopPolling,
  }
}

export type DownloadsFilter = 'all' | 'active' | 'paused' | 'seeding' | 'cache'

const FILTERS: DownloadsFilter[] = [
  'all',
  'active',
  'paused',
  'seeding',
  'cache',
]
const GROUP_ORDER: DownloadGroup[] = [
  'attention',
  'active',
  'paused',
  'seeding',
  'complete',
  'idle',
]

function matchesFilter(torrent: Torrent, filter: DownloadsFilter) {
  const { group } = downloadViewOf(torrent)

  switch (filter) {
    case 'active':
      return group === 'active'
    case 'paused':
      return group === 'paused'
    case 'seeding':
      return group === 'seeding'
    case 'cache':
      return torrent.retention === 'cache' && torrent.sizeOnDisk > 0
    default:
      return true
  }
}

/** Фильтр и поиск — в `route.query`, группы по состоянию */
export function useDownloadsList() {
  const route = useRoute()
  const router = useRouter()

  function setQuery(patch: Record<string, string | undefined>) {
    router.replace({ query: { ...route.query, ...patch } })
  }

  const filter = computed<DownloadsFilter>({
    get: () => {
      const value = route.query.filter

      return FILTERS.includes(value as DownloadsFilter)
        ? (value as DownloadsFilter)
        : 'all'
    },
    set: value => setQuery({ filter: value === 'all' ? undefined : value }),
  })

  const search = computed({
    get: () => (typeof route.query.q === 'string' ? route.query.q : ''),
    set: value => setQuery({ q: value || undefined }),
  })

  const counts = computed(
    () =>
      Object.fromEntries(
        FILTERS.map(item => [
          item,
          torrents.value.filter(torrent => matchesFilter(torrent, item))
            .length,
        ]),
      ) as Record<DownloadsFilter, number>,
  )

  const groups = computed(() => {
    const needle = search.value.trim().toLowerCase()
    const shown = torrents.value.filter(
      torrent =>
        matchesFilter(torrent, filter.value)
        && (!needle || torrent.name.toLowerCase().includes(needle)),
    )

    return GROUP_ORDER.map(key => ({
      key,
      items: shown.filter(torrent => downloadViewOf(torrent).group === key),
    })).filter(group => group.items.length > 0)
  })

  function resetFilters() {
    setQuery({ filter: undefined, q: undefined })
  }

  return { filters: FILTERS, filter, search, counts, groups, resetFilters }
}
