import type { LibraryFile } from '@torsher/api-client'

/** Серия, которую содержит файл: у файла с несколькими сериями — любая из них */
export function libraryFilesFor(
  files: LibraryFile[],
  target: { season?: number | null, episode?: number | null },
) {
  const { season, episode } = target

  // API нормализует сезон 0 спецвыпусков в null; undefined — цель не задана.
  if (season === undefined || !episode)
    return []

  return files.filter(
    file =>
      (file.season ?? 0) === (season ?? 0)
      && file.episode !== null
      && episode >= file.episode
      && episode <= (file.episodeTo ?? file.episode),
  )
}

/** Для значков наличия; воспроизведение выбирает из всех libraryFilesFor. */
export function libraryFileFor(files: LibraryFile[], target: LibraryEpisode) {
  return libraryFilesFor(files, target)[0]
}

export interface LibraryEpisode {
  season?: number | null
  episode?: number | null
}

/** Все версии одной цели. Fallback выбирает серию, а не конкретную версию. */
export function libraryChoices(
  files: LibraryFile[],
  series: boolean,
  next?: LibraryEpisode | null,
  fallback = false,
): { files: LibraryFile[], target: LibraryEpisode } {
  if (!series)
    return { files: files.filter(file => file.season === null), target: {} }

  const matches = next ? libraryFilesFor(files, next) : []

  if (matches.length || !fallback)
    return { files: matches, target: next ?? {} }

  const first = firstLibraryFile(files)
  const target = first ? { season: first.season, episode: first.episode } : {}

  return { files: libraryFilesFor(files, target), target }
}

/** Первый по порядку файл библиотеки: самая ранняя серия, у фильма — его файл */
export function firstLibraryFile(files: LibraryFile[]) {
  return [...files].sort(
    (a, b) =>
      (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0),
  )[0]
}

/**
 * Файл библиотеки для «Смотреть»: фильм — его файл; сериал — файл серии,
 * которую играть (её выбирает прогресс, а не библиотека). Этой серии в
 * библиотеке нет — `undefined`: флоу просмотра обычный.
 */
export function libraryTarget(
  files: LibraryFile[],
  series: boolean,
  next?: { season?: number | null, episode?: number | null } | null,
) {
  if (files.length === 0)
    return undefined

  if (!series)
    return files.find(file => file.season === null) ?? files[0]

  return next ? libraryFileFor(files, next) : undefined
}

/** Общие источники могут выбрать первую серию; явная цель никогда не меняется. */
export function sourceLibraryChoice(
  files: LibraryFile[],
  series: boolean,
  resume?: LibraryEpisode | null,
  explicitEpisode?: LibraryEpisode,
) {
  return libraryChoices(
    files,
    series,
    explicitEpisode ?? resume,
    !explicitEpisode,
  )
}
