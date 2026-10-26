import type { LibraryFile } from '@torsher/api-client'

/** Серия, которую содержит файл: у файла с несколькими сериями — любая из них */
export function libraryFileFor(
  files: LibraryFile[],
  target: { season?: number | null, episode?: number | null },
) {
  const { season, episode } = target

  if (!season || !episode)
    return undefined

  return files.find(
    file =>
      file.season === season
      && file.episode !== null
      && episode >= file.episode
      && episode <= (file.episodeTo ?? file.episode),
  )
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
