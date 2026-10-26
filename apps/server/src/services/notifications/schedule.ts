import type { AttentionItem } from '../../dto/overview.ts'
import type { ReleaseInfo } from '../updates/index.ts'
import { performance } from 'node:perf_hooks'
import { checkIndexers, listIndexers } from '../indexers/index.ts'
import { logFor } from '../logs/index.ts'
import { startCheck, waitForCheck } from '../net/check.ts'
import { serverAttention } from '../overview/index.ts'
import { liveTorrents } from '../torrents/index.ts'
import { isNewerVersion } from '../updates/version.ts'
import { createDownloadWatcher } from './downloads.ts'
import { notify } from './index.ts'
import { purgeNotifications } from './inbox.ts'
import { createProblemMonitor } from './monitor.ts'

type ProblemKind = AttentionItem['kind']

const MONITOR_MS = 60 * 1000

/**
 * Перепроверка источника появившейся проблемы: индексаторы с ошибкой или
 * хосты. Промис завершается, когда свежий результат уже записан.
 */
export async function recheckProblem(kind: ProblemKind) {
  // Пропажу подтверждает только синхронизация с менеджером, а проверка
  // пропавшего падает всегда: его перепроверять незачем
  if (kind === 'indexer_error' || kind === 'indexer_missing') {
    const ids = listIndexers()
      .filter(
        indexer =>
          indexer.enabled
          && !indexer.missing
          && indexer.checkStatus
          && indexer.checkStatus !== 'ok',
      )
      .map(indexer => indexer.id)

    if (ids.length) {
      await checkIndexers(ids, err =>
        logFor('sources').warn({ err }, 'Indexer check failed'))
    }

    return
  }

  if (kind === 'host_unreachable' || kind === 'dns_spoofing') {
    // Идущая проверка могла начаться до сбоя или уже пройти этот хост:
    // её результат не считается, нужна своя
    await waitForCheck()
    startCheck()
    await waitForCheck()
  }
}

/**
 * Монитор «Требует внимания» и закачек раз в минуту. Старт процесса —
 * от `timeOrigin`: льготный период считается с запуска, а не с модуля.
 */
export function startNotificationMonitor() {
  const problems = createProblemMonitor({
    startedAt: performance.timeOrigin,
    recheck: recheckProblem,
  })
  const downloads = createDownloadWatcher()
  let running = false

  async function tick() {
    if (running)
      return

    running = true

    try {
      // Время до сбора «Требует внимания»: перепроверка, закончившаяся
      // позже, в этом списке ещё не видна
      const now = Date.now()
      const live = await liveTorrents()

      downloads.tick(live)
      problems.tick(await serverAttention(live), now)
    }
    catch (err) {
      logFor('notifications').error({ err }, 'Notification monitor failed')
    }
    finally {
      running = false
    }
  }

  setInterval(() => void tick(), MONITOR_MS).unref()
}

/**
 * Индексаторы сами не проверяются: без фоновой проверки «индексатор упал»
 * «Обзор» узнал бы, только когда владелец нажмёт «Проверить».
 */
export function checkEnabledIndexers() {
  const ids = listIndexers()
    .filter(indexer => indexer.enabled && !indexer.missing)
    .map(indexer => indexer.id)

  return checkIndexers(ids, err =>
    logFor('sources').warn({ err }, 'Indexer check failed'))
}

export function announceUpdate(release: ReleaseInfo) {
  notify({
    kind: 'update_available',
    severity: 'info',
    section: 'about',
    params: { version: release.version },
  })
}

/** Сервер стартовал с новой версией: только центр, владелец обновлял сам */
export function announceServerUpdated(from: string, version: string) {
  // Откат на прежнюю версию — не обновление
  if (!isNewerVersion(version, from))
    return

  notify(
    {
      kind: 'server_updated',
      severity: 'info',
      section: 'about',
      params: { from, version },
    },
    { external: false },
  )
}

export function purgeOldNotifications() {
  try {
    purgeNotifications()
  }
  catch (err) {
    logFor('notifications').error({ err }, 'Notification cleanup failed')
  }
}
