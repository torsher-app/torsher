import { logFor } from '../logs/index.ts'
import { refreshFollowSchedules } from './tmdbRefresh.ts'

// Что и когда делать, лежит в таблицах слежения; тик только решает, что пора
const TICK_MS = 30_000

let timer: NodeJS.Timeout | undefined
let running: Promise<void> | undefined

/** Один проход планировщика; во время прохода новый не начинается */
function followTick(now = new Date()) {
  running ??= refreshFollowSchedules(now)
    .catch(err => logFor('catalog').warn({ err }, 'Follow tick failed'))
    .finally(() => {
      running = undefined
    })

  return running
}

export function startFollowScheduler() {
  timer = setInterval(() => void followTick(), TICK_MS)
  timer.unref()
}

export function stopFollowScheduler() {
  clearInterval(timer)
  timer = undefined
}
