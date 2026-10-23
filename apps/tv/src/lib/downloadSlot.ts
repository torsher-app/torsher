import type { TitleDownload } from '@torsher/api-client'

export type ActiveDownload = TitleDownload['downloads'][number]

/**
 * Что в слоте загрузки ряда кнопок: `start` — «Скачать фильм / сезон N»,
 * `active` — закачка выбранного объёма (качается, раскладывается, не
 * разложится), `none` — качать нечего, кнопки нет. Заголовок кнопки — всегда
 * действие; «в библиотеке» — во второй строке «Смотреть» и значках.
 */
export type DownloadSlot
  = | { kind: 'start' }
    | { kind: 'active', download: ActiveDownload }
    | { kind: 'none' }

const PHASE_ORDER: Record<ActiveDownload['phase'], number> = {
  downloading: 0,
  placing: 1,
  unmatched: 2,
}

export function downloadSlot(input: {
  series: boolean
  // Выбранный сезон сериала
  season?: number
  downloads: ActiveDownload[]
  // Фильм: его файл в библиотеке
  movieInLibrary: boolean
  // Сериал: серий выбранного сезона в библиотеке и вышло всего
  seasonInLibrary: number
  seasonAired: number
}): DownloadSlot {
  // Закачка другого сезона кнопку выбранного не трогает; раздача без сезонов
  // в именах покрывает любой
  const own = input.downloads
    .filter(
      item =>
        !input.series
        || item.seasons.length === 0
        || (input.season !== undefined && item.seasons.includes(input.season)),
    )
    .sort((a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase])

  if (own[0])
    return { kind: 'active', download: own[0] }

  const complete = input.series
    ? input.seasonAired > 0 && input.seasonInLibrary >= input.seasonAired
    : input.movieInLibrary

  return complete ? { kind: 'none' } : { kind: 'start' }
}
