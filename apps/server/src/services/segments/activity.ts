// Shared by sessions and direct streams, including external players.
let active = 0
const listeners = new Set<() => void>()
export function playbackActive() {
  return active > 0
}
export function onPlaybackActivity(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function trackPlayback() {
  active++
  listeners.forEach(listener => listener())
  let released = false
  return () => {
    if (released)
      return
    released = true
    active--
    listeners.forEach(listener => listener())
  }
}
