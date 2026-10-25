import { logFor } from '../logs/index.ts'
import { liveTorrents } from '../torrents/index.ts'
import { purgeBlocklist } from './blocklist.ts'
import { feedPass } from './feed.ts'
import { continueGrabs } from './grab.ts'
import { purgeHistory } from './history.ts'
import { followById } from './index.ts'
import { activeFollows, grabPending, markDownloaded } from './pass.ts'
import { isQuietAfterStart, searchPass, startFollowSearch } from './search.ts'
import { checkStalled, hasActiveGrabs } from './stalled.ts'
import { refreshFollowSchedules } from './tmdbRefresh.ts'
import { continueRefreshes } from './topics.ts'

// Что и когда делать, лежит в таблицах слежения; тик только решает, что пора
const TICK_MS = 30_000
const PURGE_EVERY_MS = 24 * 60 * 60 * 1000

let timer: NodeJS.Timeout | undefined
let running: Promise<void> | undefined
let purgedAt = 0

/**
 * Автоматика по действующим слежениям: зависшие закачки, magnet дождался
 * метаданных, кончилось окно или освободилось место, файл лёг в библиотеку,
 * лента индексаторов, целевой поиск. Без действующих слежений никуда не ходит.
 * Незаконченная подмена темы продолжается всегда: это не поиск, а раздача,
 * которую нельзя оставить забытой.
 */
export async function followAutomation(now = new Date()) {
  if (now.getTime() - purgedAt >= PURGE_EVERY_MS) {
    purgedAt = now.getTime()
    purgeHistory(now)
    purgeBlocklist(now)
  }

  await continueRefreshes(now)

  const active = activeFollows()

  // Без слежений автоматика никуда не ходит; после старта сервера — пауза
  if (!active.length || isQuietAfterStart(now))
    return

  const activeOf = (id: string) => active.find(follow => follow.id === id)

  if (hasActiveGrabs())
    await checkStalled(await liveTorrents(), followById, now.getTime())

  await continueGrabs(activeOf, now)

  for (const follow of active) {
    await grabPending(follow, now)
    markDownloaded(follow, now)
  }

  await feedPass(activeFollows(), now)
  await searchPass(activeFollows(), now)
}

/** Один проход планировщика; во время прохода новый не начинается */
function followTick(now = new Date()) {
  running ??= refreshFollowSchedules(now)
    .then(() => followAutomation(now))
    .catch(err => logFor('catalog').warn({ err }, 'Follow tick failed'))
    .finally(() => {
      running = undefined
    })

  return running
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
