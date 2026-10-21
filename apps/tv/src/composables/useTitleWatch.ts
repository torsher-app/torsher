import type {
  EngineUnavailableResponse,
  WatchErrorResponse,
} from '@torsher/api-client'
import type { Ref } from 'vue'
import { getErrorBody, getErrorStatus } from '@torsher/api-client'
import { onScopeDispose, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api.ts'

// Метаданные magnet сервер ждёт до 5 минут; витрина опрашивает раздачу
const POLL_INTERVAL_MS = 1500
const POLL_LIMIT_MS = 5 * 60 * 1000

/**
 * Почему просмотр не начался: `noSources` — подходящих раздач нет,
 * `notPlayable` — раздачи не добавились или в них нет серии, `gone` —
 * выбранной раздачи больше нет в поиске, `engine` — движок недоступен.
 */
export type WatchError
  = 'noSources' | 'notPlayable' | 'gone' | 'engine' | 'unauthorized' | 'unknown'

/**
 * `searching` — сервер ищет раздачи серии, `preparing` — добавляет раздачу,
 * `waitingFiles` — ждём список файлов от пиров.
 */
export type WatchPhase
  = 'idle' | 'searching' | 'preparing' | 'waitingFiles' | 'error'

export interface EpisodeRef {
  season?: number
  episode?: number
}

async function watchErrorOf(err: unknown): Promise<WatchError> {
  switch (getErrorStatus(err)) {
    case 401:
      return 'unauthorized'
    case 422: {
      const body = await getErrorBody<Partial<WatchErrorResponse>>(err)

      if (body?.kind === 'no_sources')
        return 'noSources'

      return body?.kind === 'candidate_gone' ? 'gone' : 'notPlayable'
    }
    case 503: {
      const body = await getErrorBody<Partial<EngineUnavailableResponse>>(err)

      return body?.kind ? 'engine' : 'unknown'
    }
    default:
      return 'unknown'
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * «Смотреть» из карточки: сервер выбирает раздачу и файл серии, витрина
 * ждёт метаданные magnet, если нужно, и открывает плеер с контекстом тайтла.
 */
export function useTitleWatch(id: Ref<string>) {
  const router = useRouter()
  const phase = ref<WatchPhase>('idle')
  const error = ref<WatchError>()
  let run = 0

  // Новый запуск или уход с экрана отменяет прежний
  const isActive = (current: number) => current === run

  /** `true` — раздача готова, `false` — не дождались метаданных */
  async function waitForTorrent(torrentId: string, current: number) {
    const until = Date.now() + POLL_LIMIT_MS

    while (isActive(current) && Date.now() < until) {
      await sleep(POLL_INTERVAL_MS)

      if (current !== run)
        return false

      try {
        const torrent = await api.torrents.getTorrent(torrentId)

        if (torrent.status !== 'resolving')
          return torrent.status === 'ready'
      }
      catch {
        // Пропущенный опрос не страшен: спросим ещё раз
      }
    }

    return false
  }

  async function start(target: EpisodeRef, candidateId?: string) {
    const current = ++run
    let chosen = candidateId

    phase.value = 'searching'
    error.value = undefined

    try {
      // Сначала поиск отдельным запросом (из кэша сервера, если он свежий):
      // ответ «Смотреть» тогда не ждёт индексаторы и укладывается в таймаут клиента
      if (!candidateId) {
        await api.titles.getTitleSources(id.value, {
          season:
            target.season === undefined ? undefined : String(target.season),
          episode:
            target.episode === undefined ? undefined : String(target.episode),
        })

        if (current !== run)
          return
      }

      phase.value = 'preparing'

      for (;;) {
        const result = await api.titles.postTitleWatch(id.value, {
          season: target.season,
          episode: target.episode,
          candidateId: chosen,
        })

        if (current !== run)
          return

        if (result.status === 'ready' && result.fileIndex !== null) {
          phase.value = 'idle'
          router.push({
            path: `/play/${result.torrentId}/${result.fileIndex}`,
            query: {
              title: id.value,
              season:
                target.season === undefined ? undefined : String(target.season),
              episode:
                target.episode === undefined
                  ? undefined
                  : String(target.episode),
            },
          })

          return
        }

        chosen = result.candidateId
        phase.value = 'waitingFiles'

        const ready = await waitForTorrent(result.torrentId, current)

        if (current !== run)
          return

        if (!ready) {
          error.value = 'notPlayable'
          phase.value = 'error'

          return
        }

        phase.value = 'preparing'
      }
    }
    catch (err) {
      const kind = await watchErrorOf(err)

      if (current !== run)
        return

      error.value = kind
      phase.value = 'error'
    }
  }

  function cancel() {
    run += 1
    phase.value = 'idle'
    error.value = undefined
  }

  onScopeDispose(cancel)

  return { phase, error, start, cancel }
}
