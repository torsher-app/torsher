import type { SourceView } from './sources.ts'

const PREFIX = 'torsher.sources.'

/**
 * Сортировка и фильтры «Источников» запоминаются для тайтла на этом устройстве.
 * Хранилище недоступно — экран работает со значениями по умолчанию.
 */
export function loadSourceView(titleId: string): Partial<SourceView> {
  try {
    const raw = window.localStorage.getItem(PREFIX + titleId)

    return raw ? (JSON.parse(raw) as Partial<SourceView>) : {}
  }
  catch {
    return {}
  }
}

export function saveSourceView(titleId: string, view: Partial<SourceView>) {
  try {
    window.localStorage.setItem(PREFIX + titleId, JSON.stringify(view))
  }
  catch {
    // Не запомнилось — в следующий раз будут значения по умолчанию
  }
}
