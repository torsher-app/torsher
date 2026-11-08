// Раздачи, которые прямо сейчас переезжают в другой каталог: движок их не
// держит, и добавлять их туда заново нельзя — файлы на полпути
const moving = new Set<string>()
const mutations = new Map<string, Promise<unknown>>()

/** Add, move и forget одной строки вместе с обновлением её каталога в DB. */
export function withTorrentStorageMutation<T>(
  id: string,
  work: () => Promise<T>,
): Promise<T> {
  const previous = mutations.get(id) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(work)
  mutations.set(id, task)
  void task
    .finally(() => {
      if (mutations.get(id) === task)
        mutations.delete(id)
    })
    .catch(() => {})
  return task
}

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
