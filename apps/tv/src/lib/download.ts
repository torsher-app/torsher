import type { TitleFile } from '@torsher/api-client'

/** Процент для подписи: 99,6 % — ещё не 100, пока файл не докачан */
export function downloadPercent(progress: number) {
  return Math.min(99, Math.floor(progress * 100))
}

/** Отметить для «Скачать выбранное» можно только то, что ещё не качают и не скачали */
export function isSelectable(file: Pick<TitleFile, 'download'>) {
  return !file.download
}

/** Сколько отмечено и сколько это весит — для кнопки «Скачать выбранное» */
export function selectionSummary(
  files: Pick<TitleFile, 'fileIndex' | 'size'>[],
  selected: ReadonlySet<number>,
) {
  let count = 0
  let bytes = 0

  for (const file of files) {
    if (selected.has(file.fileIndex)) {
      count++
      bytes += file.size
    }
  }

  return { count, bytes }
}

/**
 * Что отмечено, когда «Файлы» открыли с «Скачать»: серии сезона (без сезона —
 * все видео раздачи), кроме уже скачанных и качающихся
 */
export function presetSelection(
  files: Pick<TitleFile, 'fileIndex' | 'season' | 'download'>[],
  season?: number,
) {
  return new Set(
    files
      .filter(
        file =>
          isSelectable(file)
          && (season === undefined || file.season === season),
      )
      .map(file => file.fileIndex),
  )
}

/** Сколько серий сезона отмечено: все, часть или ни одной */
export function seasonSelection(
  files: Pick<TitleFile, 'fileIndex' | 'season' | 'download'>[],
  selected: ReadonlySet<number>,
  season: number | null,
): 'all' | 'some' | 'none' {
  const own = files.filter(
    file => file.season === season && isSelectable(file),
  )
  const count = own.filter(file => selected.has(file.fileIndex)).length

  return count === 0 ? 'none' : count === own.length ? 'all' : 'some'
}

/** OK на заголовке сезона: отмечены все его серии — снять, иначе отметить все */
export function toggleSeason(
  files: Pick<TitleFile, 'fileIndex' | 'season' | 'download'>[],
  selected: ReadonlySet<number>,
  season: number | null,
) {
  const own = files
    .filter(file => file.season === season && isSelectable(file))
    .map(file => file.fileIndex)
  const next = new Set(selected)
  const all = seasonSelection(files, selected, season) === 'all'

  for (const index of own) {
    if (all)
      next.delete(index)
    else next.add(index)
  }

  return next
}

/** «Выбрать все» — все, что ещё можно отметить; все отмечены — снять */
export function toggleAll(
  files: Pick<TitleFile, 'fileIndex' | 'download'>[],
  selected: ReadonlySet<number>,
) {
  const selectable = files.filter(isSelectable).map(file => file.fileIndex)
  const all
    = selectable.length > 0 && selectable.every(index => selected.has(index))

  return all ? new Set<number>() : new Set(selectable)
}
