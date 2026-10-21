import type {
  EngineUnavailableResponse,
  Playback,
  TorrentStats,
} from '@torsher/api-client'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { onScopeDispose, ref, shallowRef } from 'vue'
import type { PlaybackTitle } from '../lib/sources.ts'
import { api } from '../api.ts'

/**
 * Почему плеер не стартовал: `engine` — движок не установлен или запускается,
 * `notReady` — раздача ещё ждёт список файлов, `unsupported` — этот плеер не
 * открывает формат файла (remux и транскод появятся позже).
 */
export type PlayerError
  = | 'unauthorized'
    | 'notFound'
    | 'notReady'
    | 'engine'
    | 'unsupported'
    | 'unknown'

export type EngineKind = EngineUnavailableResponse['kind']

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
  const error = ref<PlayerError>()
  const engineKind = ref<EngineKind>()
  const stats = shallowRef<TorrentStats>()

  let statsTimer: ReturnType<typeof setTimeout> | undefined
  let stopped = false

  async function start() {
    status.value = 'loading'
    error.value = undefined

    try {
      playback.value = await api.playback.postPlayback({
        torrentId,
        fileIndex,
        title,
      })
      status.value = 'ready'
    }
    catch (err) {
      const outcome = await playerErrorOf(err)

      error.value = outcome.error
      engineKind.value
        = 'engineKind' in outcome ? outcome.engineKind : undefined
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

  onScopeDispose(stopStats)

  return {
    status,
    playback,
    error,
    engineKind,
    stats,
    start,
    fail,
    pollStats,
    stopStats,
    saveWatchState,
  }
}
