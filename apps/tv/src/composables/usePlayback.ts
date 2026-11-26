import { diagnosticPlaybackMode } from '../diagnostics/player.ts'
import type { DiagnosticContext } from '../diagnostics/index.ts'
import {
  currentDiagnosticContext,
  diagnostic,
  diagnosticParams,
  diagnosticPoll,
  diagnosticRequest,
} from '../diagnostics/index.ts'
import type {
  CreatePlaybackInput,
  EngineUnavailableResponse,
  InsufficientStorageResponse,
  Playback,
  PlaybackErrorInput,
  TorrentStats,
  UpdateWatchStateInput,
  ViewingStartInput,
} from '@torsher/api-client'
import {
  correlationHeaders,
  getErrorBody,
  getErrorOutcome,
  getErrorRequestId,
  getErrorStatus,
} from '@torsher/api-client'
import { onScopeDispose, ref, shallowRef } from 'vue'
import type { PlaybackTitle } from '../lib/sources.ts'
import type { ViewingRestart } from '../lib/viewingRestart.ts'
import {
  playbackIdentity,
  restartScope,
  saveRestart,
} from '../lib/viewingRestart.ts'
import { api } from '../api.ts'
import {
  captureTitleViewer,
  isTitleViewer,
  noteTitleProgress,
} from '../titleActions.ts'
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

export type CheckpointSession = Pick<
  UpdateWatchStateInput,
  'sessionId' | 'appliedAudioStream' | 'viewing'
>
type CheckpointKind = NonNullable<CheckpointSession['viewing']>['kind']

// Один порядок для всех плееров этого запуска, включая A → B → A.
const progressClientId = playbackIdentity()
let progressSequence = 0

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
 * хватает места под файл, `unsupported` — плеер не открыл файл, `corrupt` —
 * раздача прислала куски с неверным хэшем, и повторы не помогли.
 */
export type PlayerError
  = | 'unauthorized'
    | 'notFound'
    | 'notReady'
    | 'engine'
    | 'storage'
    | 'unsupported'
    | 'corrupt'
    | 'unknown'

/** Подробности ошибки плеера для журнала сервера */
export interface PlayerFailure {
  /** `MediaError.code` элемента `<video>` */
  mediaError?: number
  /** `MediaError.message` или вид ошибки hls.js */
  detail?: string
  position?: number
}

// Эти ошибки экрана бывают у открытой сессии: о них сервер пишет в журнал
const REPORTED_ERRORS = new Set<string>(['unsupported', 'corrupt', 'unknown'])

function isReported(kind: string): kind is PlaybackErrorInput['error'] {
  return REPORTED_ERRORS.has(kind)
}

export type EngineKind = EngineUnavailableResponse['kind']

/**
 * Файл библиотеки лежит на диске сервера целиком: движок не участвует, весь
 * файл «впереди». Пиров нет, но буферизация и сторожа плеера считают его
 * готовым — подключённый «пир» означает «данные доступны».
 */
function localStats(size: number): TorrentStats {
  return {
    activity: 'downloading',
    peers: { connected: 1, found: 1, seeders: 0 },
    downloadSpeed: 0,
    uploadSpeed: 0,
    file: { size, downloaded: size, bufferedAhead: size },
    badPieces: 0,
  }
}
export type StorageShortage = Omit<InsufficientStorageResponse, 'message'>

async function playerErrorOf(err: unknown) {
  switch (getErrorStatus(err)) {
    case 401:
      return { error: 'unauthorized' as const }
    case 404:
      return { error: 'notFound' as const }
    case 409: {
      const body = await getErrorBody<{ kind?: string }>(err)
      return body?.kind === 'viewingAttemptConflict'
        ? { error: 'unknown' as const }
        : { error: 'notReady' as const }
    }
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
  = | { torrentId: string, fileIndex: number }
    | { mediaFileId: string }
    | { addonLaunchId: string | undefined }

/**
 * Запуск файла раздачи или библиотеки, статистика движка для буферизации и
 * OSD и сохранение позиции. Видео и его события живут в экране плеера.
 */
export function usePlayback(
  source: PlaybackSource,
  title?: PlaybackTitle,
  // Озвучка, которую слушали в прошлой раздаче: сервер возьмёт её дорожку
  voiceStudio?: string,
  context: DiagnosticContext = currentDiagnosticContext(),
  viewerProfileId?: string,
  cycleId?: string,
) {
  const viewer = captureTitleViewer()
  const addon = 'addonLaunchId' in source
  const torrent = 'torrentId' in source ? source : undefined
  const tracksViewing
    = !addon
      && !!title
      && (/^tmdb:movie:\d+$/.test(title.id)
        || (/^tmdb:tv:\d+$/.test(title.id)
          && title.season !== undefined
          && !!title.episode))
  const playerId = playbackIdentity()
  let pendingViewing: ViewingStartInput | undefined
  const sourceKey = JSON.stringify(
    'mediaFileId' in source
      ? ['library', source.mediaFileId]
      : torrent
        ? ['torrent', torrent.torrentId, torrent.fileIndex]
        : ['addon'],
  )
  let line = 0
  const diagnosticTarget = {
    ...(addon ? {} : source),
    titleId: title?.id,
    season: title?.season,
    episode: title?.episode,
  }
  let checkpointAt = -Infinity
  const library = 'mediaFileId' in source
  const status = ref<'loading' | 'ready' | 'error'>('loading')
  const playback = shallowRef<Playback>()
  // Сессия, пока сервер читает файл: экран показывает подготовку с названием
  const pending = shallowRef<Playback>()
  const error = ref<PlayerError>()
  const viewingConflict = ref(false)
  const engineKind = ref<EngineKind>()
  const storage = shallowRef<StorageShortage>()
  const stats = shallowRef<TorrentStats>()
  const statsFailed = ref(false)

  let statsTimer: ReturnType<typeof setTimeout> | undefined
  // Запрос прошлого круга, вернувшийся после перезапуска опроса, не ставит таймер
  let statsRun = 0
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined
  const statsAt = ref(0)
  let statsOffset: number | undefined

  let generation = 0
  // `playback` держит закрытую сессию: экран читает из неё адрес и позицию
  // до нового запуска, а повторный DELETE не нужен
  const closed = new Set<string>()

  function closeSession(id: string) {
    if (closed.has(id))
      return

    closed.add(id)
    const request = context.actionId
      ? api.playback.deletePlayback(id, diagnosticParams(context))
      : api.playback.deletePlayback(id)
    request.then(
      () =>
        diagnostic(
          {
            event: 'playback.closed',
            ...diagnosticTarget,
            session: id,
            outcome: 'accepted',
          },
          context,
          true,
        ),
      () =>
        diagnostic(
          {
            event: 'playback.closed',
            ...diagnosticTarget,
            session: id,
            outcome: 'unknown',
          },
          context,
          true,
        ),
    )
  }

  /** Закрыть сессию на сервере: перепаковка и её сегменты больше не нужны */
  function close() {
    generation++
    closeSessions()
  }

  function closeSessions() {
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
    const poll = diagnosticPoll(
      'probe',
      { ...diagnosticTarget, session: current.sessionId },
      context,
    )
    let pollOutcome: 'accepted' | 'failed' | 'cancelled' | 'timeout' = 'failed'
    try {
      const startedAt = Date.now()
      let result = current
      let failures = 0

      while (result.status === 'probing' && isCurrent()) {
        if (Date.now() - startedAt >= PROBE_LIMIT_MS) {
          pollOutcome = 'timeout'
          return 'lost'
        }

        pending.value = result
        await new Promise(resolve => setTimeout(resolve, PROBE_POLL_MS))

        if (!isCurrent())
          break

        try {
          result = await api.playback.getPlayback(
            result.sessionId,
            poll.params(),
          )
          failures = 0
        }
        catch (err) {
          if (getErrorStatus(err) === 404)
            return 'lost'

          if (++failures > PROBE_FAILURES)
            throw err
        }
      }

      pollOutcome = isCurrent() ? 'accepted' : 'cancelled'
      return result
    }
    finally {
      poll.finish(!isCurrent() ? 'cancelled' : pollOutcome)
    }
  }

  let initialAddonStart: Promise<StartOutcome> | undefined

  /**
   * Запуск файла. С `restart` — та же раздача с другой озвучкой или
   * субтитрами с позиции плеера. Прежняя сессия закрывается всегда, и при
   * повторе после ошибки тоже.
   */
  async function start(
    restart?: PlaybackRestart,
    viewingRestart?: ViewingRestart,
  ): Promise<StartOutcome> {
    const initialAddon = addon && !playback.value
    if (initialAddon && initialAddonStart)
      return initialAddonStart

    const run = generation + 1
    const previousSession = playback.value?.sessionId
    diagnostic(
      {
        event: previousSession ? 'playback.retry' : 'playback.requested',
        ...diagnosticTarget,
        generation: run,
        previousSession,
      },
      context,
    )
    const starting = startInternal(restart, viewingRestart)
    if (initialAddon)
      initialAddonStart = starting
    const outcome = await starting.finally(() => {
      if (initialAddonStart === starting)
        initialAddonStart = undefined
    })
    if (outcome === 'stale') {
      diagnostic(
        {
          event: 'operation.stale',
          generation: run,
          reason: 'superseded',
          applied: false,
        },
        context,
      )
    }
    else {
      diagnostic(
        {
          event:
            outcome === 'ready'
              ? 'playback.ready'
              : outcome === 'retry'
                ? 'playback.retry'
                : 'playback.error',
          ...diagnosticTarget,
          generation: run,
          session: playback.value?.sessionId,
          mode: diagnosticPlaybackMode(playback.value),
          outcome: outcome === 'ready' ? 'accepted' : 'failed',
        },
        context,
      )
    }
    return outcome
  }

  async function startInternal(
    restart?: PlaybackRestart,
    viewingRestart?: ViewingRestart,
  ): Promise<StartOutcome> {
    const run = ++generation

    status.value = 'loading'
    error.value = undefined
    viewingConflict.value = false
    const previousAddon
      = addon && playback.value && !closed.has(playback.value.sessionId)
        ? playback.value.sessionId
        : undefined
    if (previousAddon) {
      if (pending.value && pending.value.sessionId !== previousAddon)
        closeSession(pending.value.sessionId)
    }
    else {
      closeSessions()
    }

    let created: Playback | undefined

    try {
      if (!isTitleViewer(viewer))
        return 'stale'
      if (
        addon
        && (!viewerProfileId || (!source.addonLaunchId && !previousAddon))
      ) {
        status.value = 'error'
        error.value = 'notFound'
        return 'error'
      }
      if (cycleId && !tracksViewing)
        throw new Error('Cycle playback requires a catalog episode')
      if (tracksViewing && title) {
        const base = { playerId, clientId: progressClientId, cycleId }
        if (viewingRestart) {
          if (
            !viewerProfileId
            || viewingRestart.scope
            !== restartScope(viewerProfileId, title, cycleId)
            || (viewingRestart.sourceKey
              && viewingRestart.sourceKey !== sourceKey)
            || viewingRestart.consumed
          ) {
            throw new Error('Viewing restart is no longer available')
          }
          if (
            pendingViewing?.intent !== 'restart'
            || pendingViewing.requestId !== viewingRestart.requestId
          ) {
            const expectedGeneration
              = viewingRestart.expectedGeneration
                ?? playback.value?.viewing?.generation
                ?? (
                  await api.playback.getViewingAttempt({
                    titleId: title.id,
                    season: title.season,
                    episode: title.episode,
                    cycleId,
                    profileId: viewerProfileId,
                  })
                ).attempt?.generation
                ?? 0
            if (run !== generation || !isTitleViewer(viewer))
              return 'stale'
            viewingRestart = saveRestart({
              ...viewingRestart,
              sourceKey,
              expectedGeneration,
            })
            pendingViewing = {
              ...base,
              requestId: viewingRestart.requestId,
              intent: 'restart',
              expectedGeneration,
            }
          }
        }
        else if (pendingViewing?.intent !== 'join') {
          pendingViewing = {
            ...base,
            requestId: playbackIdentity(),
            intent: 'join',
            // A reconnect keeps its original generation even if another viewer restarted it.
            expectedGeneration: playback.value?.viewing?.generation,
          }
        }
      }
      created = await api.playback.postPlayback(
        {
          ...(previousAddon ? { addonSessionId: previousAddon } : source),
          ...(addon && { addonOperationId: playbackIdentity() }),
          addonSubtitles: true,
          title,
          device: deviceProfile(),
          language: i18n.global.locale.value as CreatePlaybackInput['language'],
          voiceStudio,
          viewing: pendingViewing,
          profileId: addon || pendingViewing ? viewerProfileId : undefined,
          ...restart,
          // До семантических предпочтений Off задавался отсутствием поля.
          subtitle:
            !addon
            && restart?.subtitle === null
            && playback.value?.preferenceMismatch === undefined
              ? undefined
              : restart?.subtitle,
        },
        diagnosticParams(context),
      )
      const ready = await waitProbe(created, () => run === generation)

      if (run !== generation || !isTitleViewer(viewer)) {
        closeSession(created.sessionId)
        return 'stale'
      }

      if (ready === 'lost') {
        closeSession(created.sessionId)
        pending.value = undefined
        error.value = 'unknown'
        if (addon) {
          status.value = 'error'
          return 'error'
        }
        return 'retry'
      }

      if (
        tracksViewing
        && (!ready.viewing
          || !ready.viewing.attemptId
          || !Number.isSafeInteger(ready.viewing.generation)
          || ready.viewing.generation < 1
          || !['open', 'completed'].includes(ready.viewing.state)
          || ready.viewing.current === false)
      ) {
        closeSession(ready.sessionId)
        pending.value = undefined
        error.value = 'unknown'
        status.value = 'error'
        return 'error'
      }
      pending.value = undefined
      if (viewingRestart && pendingViewing?.intent === 'restart') {
        saveRestart({
          ...viewingRestart,
          expectedGeneration: pendingViewing.expectedGeneration,
          sourceKey,
          consumed: true,
        })
      }
      pendingViewing = undefined
      if (previousAddon && previousAddon !== ready.sessionId)
        closeSession(previousAddon)
      line = 0
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

      if (!addon && action === 'retry')
        return 'retry'

      status.value = 'error'
      return 'error'
    }
  }

  /** Ошибка экрана; без `kind` — та, что запомнил последний запуск */
  function fail(kind?: PlayerError, failure: PlayerFailure = {}) {
    stopStats()
    error.value = kind ?? error.value ?? 'unknown'
    report(error.value, failure)
    close()
    status.value = 'error'
  }

  // Сессию закрываем после отчёта: закрытую сервер уже не знает
  function report(kind: PlayerError, failure: PlayerFailure) {
    const id = playback.value?.sessionId

    if (!id || closed.has(id) || !isReported(kind))
      return

    closed.add(id)
    api.playback
      .postPlaybackError(id, {
        error: kind,
        ...failure,
        detail: addon ? undefined : failure.detail?.slice(0, 300),
      })
      .catch(() => {})
      .finally(() => {
        const request = context.actionId
          ? api.playback.deletePlayback(id, diagnosticParams(context))
          : api.playback.deletePlayback(id)
        request.then(
          () =>
            diagnostic(
              {
                event: 'playback.closed',
                ...diagnosticTarget,
                session: id,
                outcome: 'accepted',
              },
              context,
              true,
            ),
          () =>
            diagnostic(
              {
                event: 'playback.closed',
                ...diagnosticTarget,
                session: id,
                outcome: 'unknown',
              },
              context,
              true,
            ),
        )
      })
  }

  /**
   * Свежая статистика у позиции чтения для решения об ошибке медиа: битые
   * куски и проверенное впереди. В опросе её может не быть ещё секунду-другую
   */
  async function freshStats(time: number) {
    if (library)
      return localStats(playback.value?.size ?? 0)
    if (!torrent)
      return undefined

    const run = statsRun
    const session = generation
    try {
      const result = await api.torrents.getTorrentStats(torrent.torrentId, {
        fileIndex: String(torrent.fileIndex),
        time: String(Math.max(0, time)),
      })
      return run === statsRun && session === generation ? result : undefined
    }
    catch {
      return undefined
    }
  }

  /** Статистика по кругу; интервал и позицию чтения спрашивает у экрана на каждом шаге */
  function pollStats(
    next: () => { time?: number, offset?: number, intervalMs: number },
  ) {
    stopStats()
    stats.value = undefined
    statsAt.value = 0
    statsOffset = undefined
    statsFailed.value = false
    if (!library && !torrent)
      return

    const run = statsRun
    const tick = async () => {
      const { time, offset, intervalMs } = next()
      const requestedOffset
        = offset === undefined ? undefined : Math.floor(offset)
      const session = generation

      try {
        const result = library
          ? localStats(playback.value?.size ?? 0)
          : await api.torrents.getTorrentStats(torrent!.torrentId, {
              fileIndex: String(torrent!.fileIndex),
              ...(time === undefined
                ? { offset: String(requestedOffset ?? 0) }
                : { time: String(Math.max(0, time)) }),
            })
        if (
          run === statsRun
          && session === generation
          && (time === undefined
            || Math.abs((next().time ?? Number.NaN) - time) <= 5)
        ) {
          stats.value = result
          statsAt.value = Date.now()
          statsOffset = library ? undefined : requestedOffset
          statsFailed.value = false
        }
      }
      catch {
        // Пропущенный шаг не ломает экран: остаются прежние цифры
        if (run === statsRun && session === generation)
          statsFailed.value = true
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
  function captureCheckpoint(
    kind: CheckpointKind,
    appliedAudioStream?: number | null,
  ): CheckpointSession {
    const current = playback.value
    if (kind === 'seek' || kind === 'source_switch')
      line++
    return {
      sessionId: current?.sessionId,
      appliedAudioStream,
      viewing: current?.viewing ? { playerId, line, kind } : undefined,
    }
  }

  function saveWatchState(
    position: number,
    duration: number,
    reason:
      'exit' | 'next' | 'source_switch' | 'pause' | 'checkpoint' = 'checkpoint',
    captured: DiagnosticContext = context,
    checkpoint?: CheckpointSession,
  ) {
    if (
      !Number.isFinite(position)
      || (tracksViewing && !checkpoint?.viewing)
      || (addon && !checkpoint?.sessionId)
    ) {
      return Promise.resolve()
    }
    const run = generation
    function rejectCurrentBinding() {
      if (
        (!addon && !checkpoint?.viewing)
        || !checkpoint?.sessionId
        || run !== generation
        || status.value !== 'ready'
        || playback.value?.sessionId !== checkpoint.sessionId
        || !isTitleViewer(viewer)
      ) {
        return
      }
      stopStats()
      close()
      error.value = 'unknown'
      status.value = 'error'
      viewingConflict.value = !addon
    }

    const trace
      = reason !== 'checkpoint' || Date.now() - checkpointAt >= 180_000
    if (trace && reason === 'checkpoint')
      checkpointAt = Date.now()
    const operation = diagnosticRequest({
      ...captured,
      saveReason: reason,
    }) ?? { ...captured, saveReason: reason }
    const details = {
      ...diagnosticTarget,
      position,
      duration: Number.isFinite(duration) && duration > 0 ? duration : null,
      reason,
    }
    if (trace && reason !== 'checkpoint') {
      diagnostic(
        { event: 'progress.requested', ...details, outcome: 'unknown' },
        operation,
        true,
      )
    }
    return api.watchState
      .putWatchState(
        {
          ...(addon ? { addonHttp: true as const } : source),
          event: { clientId: progressClientId, sequence: ++progressSequence },
          profileId: viewerProfileId,
          ...checkpoint,
          position,
          duration:
            Number.isFinite(duration) && duration > 0 ? duration : undefined,
          title,
        },
        operation.clientRequestId
          ? { headers: correlationHeaders(operation) }
          : {},
      )
      .then(
        (result) => {
          if (result?.accepted === false) {
            if (result.rejection === 'viewingConflict')
              rejectCurrentBinding()
            return
          }
          noteTitleProgress(viewer, title?.id)
          if (trace) {
            diagnostic(
              { event: 'progress.result', ...details, outcome: 'accepted' },
              operation,
              reason !== 'checkpoint',
            )
          }
        },
        (error) => {
          if (getErrorStatus(error) === 404)
            rejectCurrentBinding()
          diagnostic(
            {
              event: 'progress.result',
              ...details,
              outcome: getErrorOutcome(error),
              requestId: getErrorRequestId(error),
            },
            operation,
            true,
          )
        },
      )
  }

  onScopeDispose(() => {
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
    statsFailed,
    start,
    close,
    fail,
    freshStats,
    pollStats,
    stopStats,
    /** Когда статистика пришла в последний раз: молчит — сервер или движок не отвечают */
    statsReceivedAt: () => statsAt.value,
    statsOffset: () => statsOffset,
    saveWatchState,
    captureCheckpoint,
    viewingConflict,
  }
}
