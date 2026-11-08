import { restoreHeld } from '../libraryMaintenance/restore.ts'
import {
  acquireMaintenanceLease,
  MaintenanceBusyError,
} from '../libraryMaintenance/admission.ts'
import { logFor } from '../logs/index.ts'
import { followErrorFacts, followFailureIdentity } from './logDiagnostics.ts'
import { liveTorrents } from '../torrents/index.ts'
import { purgeBlocklist } from './blocklist.ts'
import { feedPass } from './feed.ts'
import { continueGrabs } from './grab.ts'
import { purgeHistory } from './history.ts'
import { followById } from './index.ts'
import { settlePicks } from './pick.ts'
import { announceLibrary, announceReady, announceUpgraded } from './notify.ts'
import {
  activeFollows,
  completeMovie,
  grabPending,
  markDownloaded,
} from './pass.ts'
import { isQuietAfterStart, searchPass, startFollowSearch } from './search.ts'
import { checkStalled, hasActiveGrabs } from './stalled.ts'
import { refreshFollowSchedules } from './tmdbRefresh.ts'
import { continueRefreshes } from './topics.ts'
import { purgeTrackerEpisodes } from './trackerEpisodes.ts'
import { settleUpgrades } from './upgrade.ts'

// Что и когда делать, лежит в таблицах слежения; тик только решает, что пора
const TICK_MS = 30_000
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000

let timer: NodeJS.Timeout | undefined
let running: Promise<void> | undefined
let purgedAt = 0

/**
 * Автоматика по действующим слежениям: зависшие закачки, magnet дождался
 * метаданных, кончилось окно или освободилось место, файл лёг в библиотеку
 * или заменён апгрейдом, серия выбрана в режиме «Только уведомлять» (и о них
 * уведомления), фильм больше нечем заменить,
 * лента индексаторов, целевой поиск. Без действующих слежений никуда не ходит.
 * Незаконченная подмена темы продолжается всегда: это не поиск, а раздача,
 * которую нельзя оставить забытой.
 */
export async function followAutomation(now = new Date()) {
  if (restoreHeld())
    return
  if (now.getTime() - purgedAt >= PURGE_EVERY_MS) {
    purgedAt = now.getTime()
    purgeHistory(now)
    purgeBlocklist(now)
    await purgeTrackerEpisodes()
  }

  await continueRefreshes(now)

  const releases: Array<() => void> = []
  const active = activeFollows().filter((follow) => {
    try {
      releases.push(
        acquireMaintenanceLease({ titleId: follow.titleId, producer: true }),
      )
      return true
    }
    catch (error) {
      if (error instanceof MaintenanceBusyError)
        return false
      throw error
    }
  })
  try {
    // Без слежений автоматика никуда не ходит; после старта сервера — пауза
    if (!active.length || isQuietAfterStart(now))
      return

    const activeOf = (id: string) => active.find(follow => follow.id === id)

    if (hasActiveGrabs())
      await checkStalled(await liveTorrents(), followById, now.getTime())

    await continueGrabs(activeOf, now)

    for (const follow of active) {
      await grabPending(follow, now)
      await announceUpgraded(follow, settleUpgrades(follow, now))
      markDownloaded(follow, now)
      await announceLibrary(follow, now)
      settlePicks(follow)
      await announceReady(follow, now)
      await completeMovie(follow, now)
    }

    if (restoreHeld())
      return
    await feedPass(active, now)
    if (restoreHeld())
      return
    await searchPass(active, now)
  }
  finally {
    for (const release of releases) release()
  }
}

/** Один проход планировщика; во время прохода новый не начинается */
export function followTick(now = new Date()) {
  running ??= refreshFollowSchedules(now)
    .then(() => followAutomation(now))
    .catch(err =>
      logFor('catalog').warn(
        {
          event: 'follow.tick_failed',
          origin: 'server',
          ...followFailureIdentity(err),
          ...followErrorFacts(err),
        },
        'Follow tick failed',
      ),
    )
    .finally(() => {
      running = undefined
    })

  return running
}

/**
 * Решение вне тика (ответ владельца) — после прохода и под его замком: иначе
 * тот же кандидат захватили бы дважды.
 */
export async function underFollowLock<T>(work: () => Promise<T>): Promise<T> {
  // Пока ждали, замок мог взять другой ждущий
  for (let busy = running; busy; busy = running) await busy

  const result = work()
  const held = result.then(
    () => {},
    () => {},
  )

  running = held
  void held.then(() => {
    if (running === held)
      running = undefined
  })

  return result
}

export function startFollowScheduler() {
  startFollowSearch()
  timer = setInterval(() => void followTick(), TICK_MS)
  timer.unref()
}

export function stopFollowScheduler() {
  clearInterval(timer)
  timer = undefined
}
