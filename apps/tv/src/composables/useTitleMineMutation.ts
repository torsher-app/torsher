import type { TitleMine, UpdateTitleMineInput } from '@torsher/api-client'
import { api } from '../api.ts'
import {
  isTitleViewer,
  knownTitleMine,
  noteTitleMine,
  rememberTitleMine,
  setTitleMineWriting,
} from '../titleActions.ts'

type OptimisticMine = (current: TitleMine) => TitleMine
interface Mutation {
  change: (current: TitleMine | undefined) => Promise<TitleMine | undefined>
  optimistic?: OptimisticMine
  confirmed: boolean
  resolve: () => void
  reject: (error: unknown) => void
}
interface TitleWrites {
  viewer: number
  base: TitleMine | undefined
  pending: Mutation[]
}

const writes = new Map<string, TitleWrites>()

/** Абсолютная оценка не требует предварительного GET; инверсии требуют mine. */
export function patchTitleMine(
  id: string,
  viewer: number,
  body: UpdateTitleMineInput,
  language: string,
) {
  if (!knownTitleMine(id) && body.rating === undefined)
    return Promise.resolve()
  return mutateTitleMine(
    id,
    viewer,
    () => api.titles.patchTitleMine(id, body, { language }),
    current => ({
      ...current,
      ...(body.watchlist !== undefined && { watchlist: body.watchlist }),
      ...(body.favorite !== undefined && { favorite: body.favorite }),
      ...(body.rating !== undefined && { rating: body.rating }),
    }),
  )
}

/** Меню и карточка пишут один тайтл последовательно, сохраняя порядок на сервере. */
export function mutateTitleMine(
  id: string,
  viewer: number,
  change: Mutation['change'],
  optimistic?: OptimisticMine,
  confirmed = true,
) {
  if (!isTitleViewer(viewer))
    return Promise.resolve()

  let queue = writes.get(id)
  if (!queue || queue.viewer !== viewer) {
    queue = { viewer, base: knownTitleMine(id), pending: [] }
    writes.set(id, queue)
  }
  const current = queue
  const running = current.pending.length > 0
  const result = new Promise<void>((resolve, reject) => {
    current.pending.push({ change, optimistic, confirmed, resolve, reject })
  })
  setTitleMineWriting(id, true, viewer)
  project(id, current)
  if (!running)
    void drain(id, current)
  return result
}

/** Отказ первой записи не откатывает оптимистичные правки, стоящие после неё. */
function project(id: string, queue: TitleWrites, confirmed = false) {
  if (!isTitleViewer(queue.viewer))
    return
  let value = queue.base
  for (const mutation of queue.pending) {
    if (value && mutation.optimistic)
      value = mutation.optimistic(value)
  }
  if (value) {
    if (confirmed)
      noteTitleMine(id, value, queue.viewer)
    else rememberTitleMine(id, value, queue.viewer)
  }
}

async function drain(id: string, queue: TitleWrites) {
  while (queue.pending.length) {
    const mutation = queue.pending[0]!
    // Cookie профиля мог смениться, пока операция ждала предшествующую.
    if (!isTitleViewer(queue.viewer)) {
      queue.pending.shift()
      mutation.resolve()
      continue
    }
    try {
      const fresh = await mutation.change(queue.base)
      queue.pending.shift()
      if (fresh)
        queue.base = fresh
      project(id, queue, mutation.confirmed)
      mutation.resolve()
    }
    catch (error) {
      queue.pending.shift()
      project(id, queue)
      mutation.reject(error)
    }
  }
  if (writes.get(id) === queue) {
    writes.delete(id)
    setTitleMineWriting(id, false, queue.viewer)
  }
}
