// Открытые потоки по раздачам: что смотрят сейчас, вытеснять нельзя
const open = new Map<string, number>()

/** Отмечает открытый поток; вызвать возвращённую функцию при закрытии */
export function trackStream(torrentId: string) {
  open.set(torrentId, (open.get(torrentId) ?? 0) + 1)

  let released = false

  return () => {
    if (released)
      return

    released = true
    const left = (open.get(torrentId) ?? 1) - 1

    if (left > 0)
      open.set(torrentId, left)
    else open.delete(torrentId)
  }
}

export function isStreaming(torrentId: string) {
  return open.has(torrentId)
}
