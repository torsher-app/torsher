import type { TitleFile } from '@torsher/api-client'

// Пиры присылают метаданные раздачи не сразу: файлы спрашиваем по кругу
export const FILES_POLL_INTERVAL_MS = 2000
export const FILES_POLL_LIMIT_MS = 90_000

/**
 * Куда встаёт фокус в «Файлах»: на серию, с которой пришли (история). Иначе —
 * последняя по порядку серия с прогрессом, а досмотренная — следующая за ней;
 * сезон, выбранный в «Источниках», сужает поиск до себя. Без прогресса — первая
 * серия сезона или первый файл.
 */
export function focusedFile(
  files: Pick<TitleFile, 'season' | 'episode' | 'position' | 'watched'>[],
  want?: { season?: number, episode?: number },
) {
  const inSeason = (file: Pick<TitleFile, 'season'>) =>
    want?.season === undefined || file.season === want.season

  if (want?.episode !== undefined) {
    const found = files.findIndex(
      file => inSeason(file) && file.episode === want.episode,
    )

    if (found !== -1)
      return found
  }

  let last = -1

  files.forEach((file, index) => {
    if (inSeason(file) && file.position > 0)
      last = index
  })

  if (last !== -1) {
    const next = last + 1

    return files[last]!.watched && next < files.length && inSeason(files[next]!)
      ? next
      : last
  }

  return Math.max(0, files.findIndex(inSeason))
}

/** Доля просмотренного для полосы прогресса: 0…1 */
export function progressOf(
  file: Pick<TitleFile, 'position' | 'duration' | 'watched'>,
) {
  if (file.watched)
    return 1

  return file.duration ? Math.min(1, file.position / file.duration) : 0
}
