import { describe, expect, it } from 'vitest'
import {
  downloadPercent,
  isSelectable,
  presetSelection,
  seasonSelection,
  selectionSummary,
  toggleAll,
  toggleSeason,
} from './download.ts'

const files = [
  { fileIndex: 0, size: 100, download: null },
  {
    fileIndex: 1,
    size: 200,
    download: { state: 'library' as const, progress: 1 },
  },
  { fileIndex: 2, size: 300, download: null },
]

describe('загрузка на витрине', () => {
  it('процент не доходит до 100, пока не докачано', () => {
    expect(downloadPercent(0.456)).toBe(45)
    expect(downloadPercent(0.999)).toBe(99)
    expect(downloadPercent(1)).toBe(99)
  })

  it('скачанное и качающееся не отмечаются', () => {
    expect(files.map(isSelectable)).toEqual([true, false, true])
  })

  it('сумма выбранного', () => {
    expect(selectionSummary(files, new Set([0, 2]))).toEqual({
      count: 2,
      bytes: 400,
    })
  })

  it('«Выбрать все» берёт только доступное, второй раз снимает', () => {
    const all = toggleAll(files, new Set())

    expect([...all]).toEqual([0, 2])
    expect([...toggleAll(files, all)]).toEqual([])
  })

  it('с «Скачать» отмечены серии сезона, кроме скачанных', () => {
    const list = [
      { fileIndex: 0, season: 1, download: null },
      { fileIndex: 1, season: 2, download: null },
      {
        fileIndex: 2,
        season: 2,
        download: { state: 'library' as const, progress: 1 },
      },
    ]

    expect([...presetSelection(list, 2)]).toEqual([1])
    expect([...presetSelection(list)]).toEqual([0, 1])
  })

  it('заголовок сезона отмечает и снимает все его серии', () => {
    const list = [
      { fileIndex: 0, season: 1, download: null },
      { fileIndex: 1, season: 1, download: null },
      { fileIndex: 2, season: 2, download: null },
    ]
    const part = new Set([0])

    expect(seasonSelection(list, part, 1)).toBe('some')
    expect([...toggleSeason(list, part, 1)]).toEqual([0, 1])
    expect([...toggleSeason(list, new Set([0, 1, 2]), 1)]).toEqual([2])
    expect(seasonSelection(list, part, 2)).toBe('none')
  })
})
