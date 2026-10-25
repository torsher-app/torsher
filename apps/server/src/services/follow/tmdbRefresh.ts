import type { Follow } from '../../db/schema.ts'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../../db/index.ts'
import { follows } from '../../db/schema.ts'
import { logFor } from '../logs/index.ts'
import { getSetting, setSetting } from '../settings/index.ts'
import {
  cachedTvAiring,
  changedTvIds,
  refreshTvSchedule,
} from '../tmdb/index.ts'
import { parseCatalogId } from '../tmdb/mappers.ts'
import { localDay } from './wanted.ts'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const CHANGES_EVERY_MS = DAY_MS
// Принудительно — не чаще, чем Sonarr обновляет сериал
const FORCED_EVERY_MS = 12 * HOUR_MS
const SOON_DAYS = 2
const RECENT_DAYS = 14
// `/tv/changes` принимает период не длиннее 14 дней
const CHANGES_MAX_DAYS = 14
// За сутки у TMDB меняются тысячи сериалов, по 100 на страницу
const CHANGES_MAX_PAGES = 50
// Сбой TMDB не повторяется на каждом тике
const RETRY_MS = HOUR_MS
const STATE_KEY = 'followTmdb'

interface RefreshState {
  /** Конец последнего удачного прохода `/tv/changes`, ISO */
  changesCheckedAt?: string
}

let changesFailedAt = 0

/** Серия выходит в ближайшие двое суток или вышла за последние 14 дней */
export function isNearAir(
  airing: { last?: { airDate?: string }, next?: { airDate?: string } },
  now = new Date(),
) {
  const soon = localDay(new Date(now.getTime() + SOON_DAYS * DAY_MS))
  const since = localDay(new Date(now.getTime() - RECENT_DAYS * DAY_MS))
  const next = airing.next?.airDate
  const last = airing.last?.airDate

  return (!!next && next <= soon) || (!!last && last >= since)
}

function utcDay(time: number) {
  return new Date(time).toISOString().slice(0, 10)
}

/**
 * Каталожные ID сериалов «Следить», изменившихся в TMDB с прошлого прохода.
 * Проход — раз в сутки; первый только запоминает время: свежие слежения
 * и так включены на свежих деталях.
 */
async function changedTitles(series: Follow[], now: Date) {
  const state = getSetting<RefreshState>(STATE_KEY) ?? {}
  const checkedAt = state.changesCheckedAt
    ? Date.parse(state.changesCheckedAt)
    : undefined
  const changed = new Set<string>()

  if (checkedAt !== undefined && now.getTime() - checkedAt < CHANGES_EVERY_MS)
    return changed

  if (now.getTime() - changesFailedAt < RETRY_MS)
    return changed

  if (checkedAt !== undefined) {
    const from = Math.max(checkedAt, now.getTime() - CHANGES_MAX_DAYS * DAY_MS)
    let ids: Set<number> | undefined

    try {
      ids = await changedTvIds(
        utcDay(from),
        utcDay(now.getTime()),
        CHANGES_MAX_PAGES,
      )
    }
    catch (err) {
      changesFailedAt = now.getTime()
      logFor('catalog').warn({ err }, 'TMDB changes unavailable')

      return changed
    }

    for (const follow of series) {
      const ref = parseCatalogId(follow.titleId)

      if (ref && (!ids || ids.has(ref.tmdbId)))
        changed.add(follow.titleId)
    }
  }

  setSetting(STATE_KEY, { ...state, changesCheckedAt: now.toISOString() })

  return changed
}

/**
 * Расписание сериалов «Следить» свежее общего кэша деталей (7 дней): раз в
 * сутки — детали изменившихся в TMDB, а тайтлы с серией в ближайшие двое суток
 * или за последние 14 дней — детали и сезоны текущих серий раз в 12 ч. Это
 * тот же кэш с тем же пределом хранения: запись лишь обновляется раньше срока.
 */
export async function refreshFollowSchedules(now = new Date()) {
  const series = getDb()
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.kind, 'series'),
        inArray(follows.state, ['active', 'paused']),
      ),
    )
    .all()

  if (!series.length)
    return

  const changed = await changedTitles(series, now)

  for (const follow of series) {
    const due
      = !follow.scheduleRefreshedAt
        || now.getTime() - follow.scheduleRefreshedAt.getTime() >= FORCED_EVERY_MS
    let forced = false

    // Деталей в кэше нет — расписание неизвестно, его надо загрузить
    if (due) {
      const airing = cachedTvAiring(follow.titleId)

      forced = !airing || isNearAir(airing, now)
    }

    if (!forced && !changed.has(follow.titleId))
      continue

    try {
      await refreshTvSchedule(follow.titleId, { seasons: forced })
    }
    catch (err) {
      logFor('catalog').warn(
        { titleId: follow.titleId, err },
        'Follow schedule refresh failed',
      )
      continue
    }

    if (forced) {
      getDb()
        .update(follows)
        .set({ scheduleRefreshedAt: now })
        .where(eq(follows.id, follow.id))
        .run()
    }
  }
}
