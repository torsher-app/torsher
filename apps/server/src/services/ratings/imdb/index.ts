import type { Rating, RatingProvider } from '../index.ts'
import { existsSync } from 'node:fs'
import { logFor } from '../../logs/index.ts'
import {
  cancelImdbRefresh,
  isImdbRefreshDue,
  isImdbRefreshRunning,
  refreshImdbRatings,
} from './refresh.ts'
import {
  clearImdbState,
  isImdbEnabled,
  readImdbState,
  setImdbEnabled,
} from './state.ts'
import { imdbStorePath, lookupImdbRatings, removeImdbStore } from './store.ts'

export { refreshImdbRatings } from './refresh.ts'

/** Оценка из локальной выгрузки: без сети, синхронно по файлу */
export const imdbRatings: RatingProvider = {
  id: 'imdb',
  label: 'IMDb',
  enabled: isImdbEnabled,
  needsImdbId: true,
  async ratingsFor(refs) {
    const ids = refs.flatMap(ref => (ref.imdbId ? [ref.imdbId] : []))
    const ratings = lookupImdbRatings(ids)
    const found = new Map<string, Rating>()

    for (const ref of refs) {
      const rating = ref.imdbId ? ratings.get(ref.imdbId) : undefined

      if (rating)
        found.set(ref.key, rating)
    }

    return found
  },
}

export type ImdbStatusState = 'off' | 'empty' | 'updating' | 'ready' | 'error'

export function imdbStatus() {
  const enabled = isImdbEnabled()
  const state = readImdbState()
  const hasData = Boolean(state.count) && existsSync(imdbStorePath())
  let status: ImdbStatusState

  if (!enabled)
    status = 'off'
  else if (isImdbRefreshRunning())
    status = 'updating'
  else if (hasData)
    status = 'ready'
  else if (state.error)
    status = 'error'
  else status = 'empty'

  return {
    enabled,
    state: status,
    updatedAt: hasData ? state.updatedAt : undefined,
    checkedAt: state.checkedAt,
    count: hasData ? state.count : undefined,
    error: state.error,
  }
}

function startRefresh() {
  refreshImdbRatings().catch(err =>
    logFor('catalog').error({ err }, 'IMDb ratings update failed'),
  )
}

/** Включение сразу запускает загрузку; выключение обрывает её и удаляет файл */
export async function setImdbRatingsEnabled(enabled: boolean) {
  setImdbEnabled(enabled)

  if (enabled) {
    startRefresh()
    return
  }

  await cancelImdbRefresh()
  removeImdbStore()
  clearImdbState()
}

/** Обновление по кнопке: идущее не дублируется */
export function refreshImdbNow() {
  if (isImdbEnabled())
    startRefresh()
}

const CHECK_MS = 60 * 60 * 1000

/** Проверка при старте и раз в час; сама загрузка — раз в сутки или после ошибки */
export function startImdbSchedule() {
  const tick = () => {
    if (isImdbRefreshDue())
      startRefresh()
  }

  tick()
  setInterval(tick, CHECK_MS).unref()
}
