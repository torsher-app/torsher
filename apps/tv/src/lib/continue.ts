import type {
  Continuation,
  ContinueRow,
  EpisodeFile,
  HomeRow,
} from '@torsher/api-client'

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
  continuation?: Continuation
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

export interface AutomaticPlayback {
  kind: 'continuation'
  current?: NonNullable<Continuation['baseline']>
}
export const automaticPlayback: AutomaticPlayback = { kind: 'continuation' }
export function automaticFromQuery(
  value: unknown,
  reference?: unknown,
): AutomaticPlayback | undefined {
  if (value !== '1')
    return undefined
  if (typeof reference !== 'string' || reference.length > 4096)
    return automaticPlayback
  try {
    const current = JSON.parse(reference)
    const file = current?.file
    const video = current?.video
    const validFile
      = file?.kind === 'library'
        ? typeof file.mediaFileId === 'string' && !!file.mediaFileId
        : file?.kind === 'torrent'
          && typeof file.torrentId === 'string'
          && !!file.torrentId
          && Number.isInteger(file.fileIndex)
          && file.fileIndex >= 0
    if (
      validFile
      && video?.basis === 'probe'
      && typeof video.width === 'number'
      && typeof video.height === 'number'
      && Number.isFinite(video.width)
      && Number.isFinite(video.height)
      && video.width > 0
      && video.height > 0
    ) {
      return { kind: 'continuation', current: { file, video } }
    }
  }
  catch {
    /* Old or malformed context does not change playback access. */
  }
  return automaticPlayback
}

function automaticQuery(automatic?: AutomaticPlayback) {
  return {
    automatic: automatic ? '1' : undefined,
    ...(automatic?.current && { reference: JSON.stringify(automatic.current) }),
  }
}

/** Плеер файла раздачи; тайтл и серия — чтобы позиция писалась по серии */
export function playerRoute(
  file: EpisodeFile,
  title?: { id: string, season?: number | null, episode?: number | null },
  voice?: string,
  automatic?: AutomaticPlayback,
): ScreenRoute {
  return {
    path: `/play/${file.torrentId}/${file.fileIndex}`,
    query: title && {
      title: title.id,
      season: title.season != null ? String(title.season) : undefined,
      episode: title.episode ? String(title.episode) : undefined,
      voice,
      ...automaticQuery(automatic),
    },
  }
}

/** Плеер с файлом библиотеки: тайтл и серия — для позиции и следующей серии */
export function libraryRoute(
  mediaFileId: string,
  title?: { id: string, season?: number | null, episode?: number | null },
  automatic?: AutomaticPlayback,
): ScreenRoute {
  return {
    path: `/play/library/${mediaFileId}`,
    query: title && {
      title: title.id,
      season: title.season != null ? String(title.season) : undefined,
      episode: title.episode ? String(title.episode) : undefined,
      ...automaticQuery(automatic),
    },
  }
}

/** Экран подготовки: ищет файл серии и уходит в плеер */
export function resolveRoute(
  titleId: string,
  season: number,
  episode: number,
  torrentId?: string,
  automatic?: AutomaticPlayback,
): ScreenRoute {
  return {
    path: `/title/${titleId}/play`,
    query: {
      season: String(season),
      episode: String(episode),
      torrent: torrentId,
      ...automaticQuery(automatic),
    },
  }
}

/** Both branches of a player episode switch must preserve automatic intent. */
export function automaticEpisodeRoute(
  title: { id: string, season: number, episode: number },
  file: EpisodeFile | null,
  previousTorrent: string | undefined,
  automatic: AutomaticPlayback,
): ScreenRoute {
  return file
    ? playerRoute(file, title, undefined, automatic)
    : resolveRoute(
        title.id,
        title.season,
        title.episode,
        previousTorrent,
        automatic,
      )
}

/** Явное намерение запуска относится только к выбранной серии. */
export function withStartPosition(
  route: ScreenRoute,
  fromStart: boolean,
): ScreenRoute {
  return fromStart
    ? { ...route, query: { ...route.query, start: '0' } }
    : route
}

/**
 * Куда ведёт «Продолжить»: файл уже известен — сразу плеер, иначе экран
 * подготовки ищет серию; фильм без файла — «Источники», а новый фильм
 * «Следить» — тоже экран подготовки: раздачу выбрал слежение
 */
export function resumeRoute(titleId: string, item: ResumeLike): ScreenRoute {
  const automatic = item.next && !item.position ? automaticPlayback : undefined
  if (item.file) {
    return playerRoute(
      item.file,
      {
        id: titleId,
        season: item.season,
        episode: item.episode,
      },
      undefined,
      automatic,
    )
  }

  if (item.season && item.episode) {
    return resolveRoute(
      titleId,
      item.season,
      item.episode,
      undefined,
      automatic,
    )
  }

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
