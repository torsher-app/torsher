import type { ContinueRow, EpisodeFile, HomeRow } from '@torsher/api-client'

/** Что продолжать: карточка ряда «Продолжить» и `resume` прогресса тайтла */
export interface ResumeLike {
  season: number | null
  episode: number | null
  position: number
  duration: number | null
  next: boolean
  file: EpisodeFile | null
  /** Новая серия «Следить»: её раздачу выбрал слежение */
  followNewEpisode?: boolean
}

/** «S2E5»; у фильма — пусто */
export function episodeCode(season: number | null, episode: number | null) {
  return season && episode ? `S${season}E${episode}` : ''
}

/** Доля просмотренного 0…1; у следующей серии и без длительности — 0 */
export function watchedShare(item: ResumeLike) {
  if (item.next || !item.duration)
    return 0

  return Math.min(1, Math.max(0, item.position / item.duration))
}

/** Сколько осталось смотреть, секунды; null — длительность неизвестна */
export function remainingSeconds(item: ResumeLike) {
  if (!item.duration)
    return null

  return Math.max(0, item.duration - item.position)
}

/** Часы и минуты с округлением вверх: «ещё 1 мин», а не «ещё 0 мин» */
export function hoursMinutes(seconds: number) {
  const total = Math.max(1, Math.ceil(seconds / 60))

  return { hours: Math.floor(total / 60), minutes: total % 60 }
}

export interface ScreenRoute {
  path: string
  query?: Record<string, string | undefined>
}

/** Плеер файла раздачи; тайтл и серия — чтобы позиция писалась по серии */
export function playerRoute(
  file: EpisodeFile,
  title?: { id: string, season?: number | null, episode?: number | null },
  voice?: string,
): ScreenRoute {
  return {
    path: `/play/${file.torrentId}/${file.fileIndex}`,
    query: title && {
      title: title.id,
      season: title.season ? String(title.season) : undefined,
      episode: title.episode ? String(title.episode) : undefined,
      voice,
    },
  }
}

/** Плеер с файлом библиотеки: тайтл и серия — для позиции и следующей серии */
export function libraryRoute(
  mediaFileId: string,
  title?: { id: string, season?: number | null, episode?: number | null },
): ScreenRoute {
  return {
    path: `/play/library/${mediaFileId}`,
    query: title && {
      title: title.id,
      season: title.season ? String(title.season) : undefined,
      episode: title.episode ? String(title.episode) : undefined,
    },
  }
}

/** Экран подготовки: ищет файл серии и уходит в плеер */
export function resolveRoute(
  titleId: string,
  season: number,
  episode: number,
  torrentId?: string,
): ScreenRoute {
  return {
    path: `/title/${titleId}/play`,
    query: {
      season: String(season),
      episode: String(episode),
      torrent: torrentId,
    },
  }
}

/**
 * Куда ведёт «Продолжить»: файл уже известен — сразу плеер, иначе экран
 * подготовки ищет серию; фильм без файла — «Источники», а новый фильм
 * «Следить» — тоже экран подготовки: раздачу выбрал слежение
 */
export function resumeRoute(titleId: string, item: ResumeLike): ScreenRoute {
  if (item.file) {
    return playerRoute(item.file, {
      id: titleId,
      season: item.season,
      episode: item.episode,
    })
  }

  if (item.season && item.episode)
    return resolveRoute(titleId, item.season, item.episode)

  if (item.followNewEpisode)
    return { path: `/title/${titleId}/play` }

  return { path: `/title/${titleId}/sources` }
}

/**
 * Ряды главной с обновлённым «Продолжить»: ряд первым, пустой убирается.
 * Ничего не поменялось — тот же массив, и экран ничего не перерисовывает.
 */
export function replaceContinueRow(rows: HomeRow[], row: ContinueRow) {
  const index = rows.findIndex(item => item.kind === 'continue')
  const others = rows.filter(item => item.kind !== 'continue')

  if (row.items.length === 0)
    return index === -1 ? rows : others

  if (index !== -1 && JSON.stringify(rows[index]) === JSON.stringify(row))
    return rows

  return [row, ...others]
}

/** Порядок тайтлов ряда: по нему ряд пересоздаётся, а не двигает карточки */
export function continueOrder(rows: HomeRow[]) {
  const row = rows.find(item => item.kind === 'continue')

  return row ? row.items.map(item => item.id).join(',') : ''
}
