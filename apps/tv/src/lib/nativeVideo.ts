/** Снимок нативного плеера: свойства `<video>` и события с прошлого снимка */
export interface PlayerSnapshot {
  time: number
  duration: number | null
  buffered: number
  paused: boolean
  ended: boolean
  rate: number
  readyState: number
  audio: { language: string | null, label: string | null, enabled: boolean }[]
  error: { code: number, message: string } | null
  events: string[]
}

// HTMLMediaElement.readyState
const HAVE_ENOUGH_DATA = 4

export const INITIAL_SNAPSHOT: PlayerSnapshot = {
  time: 0,
  duration: null,
  buffered: 0,
  paused: true,
  ended: false,
  rate: 1,
  readyState: 0,
  audio: [],
  error: null,
  events: [],
}

/** Только то, что плеер витрины читает у `<video>` */
export interface NativeVideoState {
  snapshot: PlayerSnapshot
  /** Когда пришёл снимок, `performance.now()` */
  receivedAt: number
  paused: boolean
  /** Позиция, которую попросили, пока плеер её не подтвердил */
  pendingSeek?: number
}

/**
 * Позиция сейчас: между снимками (раз в 250 мс) она досчитывается по часам,
 * как у `<video>`, иначе таймлайн шагал бы рывками.
 */
export function currentTimeOf(state: NativeVideoState, now: number) {
  if (state.pendingSeek !== undefined)
    return state.pendingSeek

  const { snapshot } = state
  const moving
    = !state.paused && !snapshot.ended && snapshot.readyState >= HAVE_ENOUGH_DATA
  const time = moving
    ? snapshot.time + ((now - state.receivedAt) / 1000) * snapshot.rate
    : snapshot.time

  return snapshot.duration === null ? time : Math.min(time, snapshot.duration)
}

/** Применить снимок: свойства обновляются до событий, как у `<video>` */
export function applySnapshot(
  state: NativeVideoState,
  snapshot: PlayerSnapshot,
  now: number,
) {
  state.snapshot = snapshot
  state.receivedAt = now

  for (const name of snapshot.events) {
    // Пауза и запуск меняются только событиями: снимок, ушедший до команды
    // play(), не должен вернуть паузу, которую зритель уже снял
    if (name === 'play' || name === 'playing')
      state.paused = false
    else if (name === 'pause' || name === 'emptied')
      state.paused = true

    if (name === 'seeking' || name === 'emptied')
      state.pendingSeek = undefined
  }
}
