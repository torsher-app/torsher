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
import { isWebos } from '../platform/webos.ts'

// Пока сервер читает файл, статус сессии спрашивается раз в секунду
const PROBE_POLL_MS = 1000

/** Смена озвучки или субтитров перезапуском: те же поля, что у `POST /playback` */
export type PlaybackRestart = Pick<
  CreatePlaybackInput,
  'audioStream' | 'subtitle' | 'startPosition'
>

let profile: CreatePlaybackInput['device'] | undefined

/** Профиль плеера один на запуск витрины: возможности браузера не меняются */
function deviceProfile() {
  profile ??= deviceProfileOf(browserMediaSupport(isWebos()))
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

/**
 * Запуск файла раздачи, статистика движка для буферизации и OSD и сохранение
 * позиции. Видео и его события живут в экране плеера.
 */
export function usePlayback(
  torrentId: string,
  fileIndex: number,
  title?: PlaybackTitle,
) {
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const playback = shallowRef<Playback>()
  // Сессия, пока сервер читает файл: экран показывает подготовку с названием
  const pending = shallowRef<Playback>()
  const error = ref<PlayerError>()
  const engineKind = ref<EngineKind>()
  const storage = shallowRef<StorageShortage>()
  const stats = shallowRef<TorrentStats>()

  let statsTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  let generation = 0

  /** Закрыть сессию на сервере: перепаковка и её сегменты больше не нужны */
  function close() {
    const id = playback.value?.sessionId

    if (id)
      api.playback.deletePlayback(id).catch(() => {})
  }

  /** Ждём пробу файла на сервере; `isCurrent` — запуск ещё не отменён */
  async function waitProbe(current: Playback, isCurrent: () => boolean) {
    let result = current

    while (result.status === 'probing' && isCurrent()) {
      pending.value = result
      await new Promise(resolve => setTimeout(resolve, PROBE_POLL_MS))

      if (!isCurrent())
        break

      result = await api.playback.getPlayback(result.sessionId)
    }

    return result
  }

  /**
   * Запуск файла. С `restart` — та же раздача с другой озвучкой или
   * субтитрами с позиции плеера: прежняя сессия закрывается.
   */
  async function start(restart?: PlaybackRestart) {
    const run = ++generation

    status.value = 'loading'
    error.value = undefined

    if (restart)
      close()

    try {
      const created = await api.playback.postPlayback({
        torrentId,
        fileIndex,
        title,
        device: deviceProfile(),
        language: i18n.global.locale.value as CreatePlaybackInput['language'],
        ...restart,
      })
      const ready = await waitProbe(created, () => run === generation)

      if (run !== generation)
        return

      pending.value = undefined
      playback.value = ready
      status.value = 'ready'
    }
    catch (err) {
      if (run !== generation)
        return

      pending.value = undefined
      const outcome = await playerErrorOf(err)

      error.value = outcome.error
      engineKind.value
        = 'engineKind' in outcome ? outcome.engineKind : undefined
      storage.value = 'storage' in outcome ? outcome.storage : undefined
      status.value = 'error'
    }
  }

  function fail(kind: PlayerError) {
    error.value = kind
    status.value = 'error'
  }

  /** Статистика по кругу; интервал и позицию чтения спрашивает у экрана на каждом шаге */
  function pollStats(next: () => { offset: number, intervalMs: number }) {
    stopStats()
    stopped = false

    const tick = async () => {
      const { offset, intervalMs } = next()

      try {
        stats.value = await api.torrents.getTorrentStats(torrentId, {
          fileIndex: String(fileIndex),
          offset: String(Math.floor(offset)),
        })
      }
      catch {
        // Пропущенный шаг не ломает экран: остаются прежние цифры
      }

      if (!stopped)
        statsTimer = setTimeout(tick, intervalMs)
    }

    void tick()
  }

  function stopStats() {
    stopped = true
    clearTimeout(statsTimer)
  }

  /** Позиция не критична: не сохранилась — сохранится в следующий раз */
  function saveWatchState(position: number, duration: number) {
    if (!Number.isFinite(position))
      return

    api.watchState
      .putWatchState({
        torrentId,
        fileIndex,
        position,
        duration:
          Number.isFinite(duration) && duration > 0 ? duration : undefined,
        title,
      })
      .catch(() => {})
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
    saveWatchState,
  }
}
