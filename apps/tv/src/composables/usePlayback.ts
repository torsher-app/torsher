import type {
  CreatePlaybackInput,
  EngineUnavailableResponse,
  InsufficientStorageResponse,
  Playback,
  TorrentStats,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { onScopeDispose, ref, shallowRef } from 'vue'
import type { PlaybackTitle } from '../lib/sources.ts'
import { api } from '../api.ts'
import { i18n } from '../i18n.ts'
import { browserMediaSupport, deviceProfileOf } from '../lib/deviceProfile.ts'
import { startErrorAction } from '../lib/player.ts'
import { nativeDeviceProfile } from '../platform/android.ts'
import { isWebos } from '../platform/webos.ts'

// Пока сервер читает файл, статус сессии спрашивается раз в секунду
const PROBE_POLL_MS = 1000
// Сервер закрывает сессию после 2 мин без обращений; `GET /playback/:id`
// продлевает её и держит раздачу от вытеснения
const HEARTBEAT_MS = 60_000
// Столько сбоев опроса пробы подряд терпим: GET сам повторяет только раз
const PROBE_FAILURES = 3
// Проба дольше — сервер завис на файле, сессию начинаем заново
const PROBE_LIMIT_MS = 180_000

/**
 * Чем кончился запуск: `retry` — сбой, который пройдёт сам (решает экран,
 * повторять ли), `error` — ошибка экрана, `stale` — запуск отменён новым.
 */
export type StartOutcome = 'ready' | 'retry' | 'error' | 'stale'

/** Смена озвучки или субтитров перезапуском: те же поля, что у `POST /playback` */
export type PlaybackRestart = Pick<
  CreatePlaybackInput,
  'audioStream' | 'subtitle' | 'startPosition'
>

let profile: CreatePlaybackInput['device'] | undefined

/**
 * Профиль плеера один на запуск витрины: возможности не меняются. В оболочке
 * Android TV играет её нативный плеер, и профиль собирает она.
 */
function deviceProfile() {
  profile
    ??= (nativeDeviceProfile() as CreatePlaybackInput['device'] | undefined)
      ?? deviceProfileOf(browserMediaSupport(isWebos()))
  return profile
}

/**
 * Почему плеер не стартовал: `engine` — движок не установлен или запускается,
 * `notReady` — раздача ещё ждёт список файлов, `storage` — на сервере не
 * хватает места под файл, `unsupported` — этот плеер не открывает формат файла
 * (remux и транскод появятся позже).
 */
export type PlayerError
  = | 'unauthorized'
    | 'notFound'
    | 'notReady'
    | 'engine'
    | 'storage'
    | 'unsupported'
    | 'unknown'

export type EngineKind = EngineUnavailableResponse['kind']

/**
 * Файл библиотеки лежит на диске сервера целиком: движок не участвует, весь
 * файл «впереди». Пиров нет, но буферизация и сторожа плеера считают его
 * готовым — подключённый «пир» означает «данные доступны».
 */
function localStats(size: number): TorrentStats {
  return {
    activity: 'downloading',
    peers: { connected: 1, found: 1 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    file: { size, downloaded: size, bufferedAhead: size },
  }
}
export type StorageShortage = Omit<InsufficientStorageResponse, 'message'>

async function playerErrorOf(err: unknown) {
  switch (getErrorStatus(err)) {
    case 401:
      return { error: 'unauthorized' as const }
    case 404:
      return { error: 'notFound' as const }
    case 409:
      return { error: 'notReady' as const }
    case 503: {
      const body = await getErrorBody<Partial<EngineUnavailableResponse>>(err)

      return { error: 'engine' as const, engineKind: body?.kind ?? 'starting' }
    }
    case 507: {
      const body
        = await getErrorBody<Partial<InsufficientStorageResponse>>(err)

      return {
        error: 'storage' as const,
        storage: {
          kind: body?.kind ?? 'no_space',
          needed: body?.needed ?? 0,
          available: body?.available ?? 0,
          free: body?.free ?? 0,
          minFree: body?.minFree ?? 0,
          cacheLimit: body?.cacheLimit ?? 0,
        },
      }
    }
    default:
      return { error: 'unknown' as const }
  }
}

/** Что играем: файл раздачи или файл библиотеки с диска сервера */
export type PlaybackSource
  = { torrentId: string, fileIndex: number } | { mediaFileId: string }

/**
 * Запуск файла раздачи или библиотеки, статистика движка для буферизации и
 * OSD и сохранение позиции. Видео и его события живут в экране плеера.
 */
export function usePlayback(
  source: PlaybackSource,
  title?: PlaybackTitle,
  // Озвучка, которую слушали в прошлой раздаче: сервер возьмёт её дорожку
  voiceStudio?: string,
) {
  const library = 'mediaFileId' in source
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const playback = shallowRef<Playback>()
  // Сессия, пока сервер читает файл: экран показывает подготовку с названием
  const pending = shallowRef<Playback>()
  const error = ref<PlayerError>()
  const engineKind = ref<EngineKind>()
  const storage = shallowRef<StorageShortage>()
  const stats = shallowRef<TorrentStats>()

  let statsTimer: ReturnType<typeof setTimeout> | undefined
  // Запрос прошлого круга, вернувшийся после перезапуска опроса, не ставит таймер
  let statsRun = 0
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  let statsAt = 0

  let generation = 0
  // `playback` держит закрытую сессию: экран читает из неё адрес и позицию
  // до нового запуска, а повторный DELETE не нужен
  const closed = new Set<string>()

  function closeSession(id: string) {
    if (closed.has(id))
      return

    closed.add(id)
    api.playback.deletePlayback(id).catch(() => {})
  }

  /** Закрыть сессию на сервере: перепаковка и её сегменты больше не нужны */
  function close() {
    stopHeartbeat()

    for (const id of [playback.value?.sessionId, pending.value?.sessionId]) {
      if (id)
        closeSession(id)
    }
  }

  // 404 тут не ошибка экрана: сессию закрыли, а видео доигрывает буфер
  function startHeartbeat(id: string) {
    stopHeartbeat()
    heartbeatTimer = setInterval(() => {
      api.playback.getPlayback(id).catch(() => {})
    }, HEARTBEAT_MS)
  }

  function stopHeartbeat() {
    clearInterval(heartbeatTimer)
    heartbeatTimer = undefined
  }

  /**
   * Ждём пробу файла на сервере; `isCurrent` — запуск ещё не отменён.
   * `lost` — сессия пропала (сервер перезапустился) или проба не кончилась
   * за отведённое время.
   */
  async function waitProbe(
    current: Playback,
    isCurrent: () => boolean,
  ): Promise<Playback | 'lost'> {
    const startedAt = Date.now()
    let result = current
    let failures = 0

    while (result.status === 'probing' && isCurrent()) {
      if (Date.now() - startedAt >= PROBE_LIMIT_MS)
        return 'lost'

      pending.value = result
      await new Promise(resolve => setTimeout(resolve, PROBE_POLL_MS))

      if (!isCurrent())
        break

      try {
        result = await api.playback.getPlayback(result.sessionId)
        failures = 0
      }
      catch (err) {
        if (getErrorStatus(err) === 404)
          return 'lost'

        if (++failures > PROBE_FAILURES)
          throw err
      }
    }

    return result
  }

  /**
   * Запуск файла. С `restart` — та же раздача с другой озвучкой или
   * субтитрами с позиции плеера. Прежняя сессия закрывается всегда, и при
   * повторе после ошибки тоже.
   */
  async function start(restart?: PlaybackRestart): Promise<StartOutcome> {
    const run = ++generation

    status.value = 'loading'
    error.value = undefined
    close()

    let created: Playback | undefined

    try {
      created = await api.playback.postPlayback({
        ...source,
        title,
        device: deviceProfile(),
        language: i18n.global.locale.value as CreatePlaybackInput['language'],
        voiceStudio,
        ...restart,
      })
      const ready = await waitProbe(created, () => run === generation)

      if (run !== generation) {
        closeSession(created.sessionId)
        return 'stale'
      }

      if (ready === 'lost') {
        closeSession(created.sessionId)
        pending.value = undefined
        error.value = 'unknown'
        return 'retry'
      }

      pending.value = undefined
      playback.value = ready
      status.value = 'ready'
      startHeartbeat(ready.sessionId)
      return 'ready'
    }
    catch (err) {
      // Проба оборвалась: созданная сессия больше ничьей не станет
      if (created)
        closeSession(created.sessionId)

      if (run !== generation)
        return 'stale'

      pending.value = undefined
      const outcome = await playerErrorOf(err)

      if (run !== generation)
        return 'stale'

      error.value = outcome.error
      engineKind.value
        = 'engineKind' in outcome ? outcome.engineKind : undefined
      storage.value = 'storage' in outcome ? outcome.storage : undefined

      // Ошибка запомнена: её покажет `fail()`, если повторы не помогут
      const action = startErrorAction({
        status: getErrorStatus(err),
        name: err instanceof Error ? err.name : undefined,
        engineKind: engineKind.value,
      })

      if (action === 'retry')
        return 'retry'

      status.value = 'error'
      return 'error'
    }
  }

  /** Ошибка экрана; без `kind` — та, что запомнил последний запуск */
  function fail(kind?: PlayerError) {
    stopStats()
    close()
    error.value = kind ?? error.value ?? 'unknown'
    status.value = 'error'
  }

  /** Статистика по кругу; интервал и позицию чтения спрашивает у экрана на каждом шаге */
  function pollStats(next: () => { offset: number, intervalMs: number }) {
    stopStats()

    const run = statsRun
    const tick = async () => {
      const { offset, intervalMs } = next()

      try {
        stats.value = library
          ? localStats(playback.value?.size ?? 0)
          : await api.torrents.getTorrentStats(source.torrentId, {
              fileIndex: String(source.fileIndex),
              offset: String(Math.floor(offset)),
            })
        statsAt = Date.now()
      }
      catch {
        // Пропущенный шаг не ломает экран: остаются прежние цифры
      }

      if (run === statsRun)
        statsTimer = setTimeout(tick, intervalMs)
    }

    void tick()
  }

  function stopStats() {
    statsRun++
    clearTimeout(statsTimer)
  }

  /** Позиция не критична: не сохранилась — сохранится в следующий раз */
  /** Ошибка сохранения молча пропускается; промис — чтобы дождаться записи */
  function saveWatchState(position: number, duration: number) {
    if (!Number.isFinite(position))
      return Promise.resolve()

    return api.watchState
      .putWatchState({
        ...source,
        position,
        duration:
          Number.isFinite(duration) && duration > 0 ? duration : undefined,
        title,
      })
      .then(
        () => {},
        () => {},
      )
  }

  onScopeDispose(() => {
    generation++
    stopStats()
    close()
  })

  return {
    status,
    playback,
    pending,
    error,
    engineKind,
    storage,
    stats,
    start,
    close,
    fail,
    pollStats,
    stopStats,
    /** Когда статистика пришла в последний раз: молчит — сервер или движок не отвечают */
    statsReceivedAt: () => statsAt,
    saveWatchState,
  }
}
