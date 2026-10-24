// Раздачи, которые прямо сейчас переезжают в другой каталог: движок их не
// держит, и добавлять их туда заново нельзя — файлы на полпути
const moving = new Set<string>()

export function markMoving(torrentId: string) {
  moving.add(torrentId)
}

export function unmarkMoving(torrentId: string) {
  moving.delete(torrentId)
}

export function isMovingTorrent(torrentId: string) {
  return moving.has(torrentId)
}

export function anyMoving() {
  return moving.size > 0
}
