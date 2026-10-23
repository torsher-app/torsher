import type { FileCard } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import {
  albumName,
  formatCaptured,
  formatMonth,
  gridRows,
  groupByMonth,
  rowWindow,
} from './homeVideo.ts'

function video(id: string, capturedAt: string | null): FileCard {
  return {
    id,
    name: id,
    album: '',
    capturedAt,
    duration: 10,
    share: 0,
    thumb: '',
  }
}

describe('домашнее видео', () => {
  it('дата — как на часах камеры, без сдвига зоны', () => {
    expect(formatCaptured('2019-07-14T23:30:00.000Z', 'ru-RU')).toBe(
      '14 июля 2019 г.',
    )
    expect(formatMonth('2023-07-01T00:30:00.000Z', 'ru-RU')).toBe('Июль 2023')
    expect(formatMonth('2023-07-01T00:30:00.000Z', 'en-US')).toBe('July 2023')
  })

  it('по месяцам в порядке списка, без даты — в конце', () => {
    const groups = groupByMonth([
      video('a', '2023-07-20T10:00:00.000Z'),
      video('n', null),
      video('b', '2023-07-02T10:00:00.000Z'),
      video('c', '2019-01-02T10:00:00.000Z'),
    ])

    expect(
      groups.map(group => [group.key, group.items.map(item => item.id)]),
    ).toEqual([
      ['2023-07', ['a', 'b']],
      ['2019-01', ['c']],
      ['none', ['n']],
    ])
  })

  it('альбом — последняя папка', () => {
    expect(albumName('Отпуск 2019/День 1')).toBe('День 1')
    expect(albumName('')).toBe('')
  })
})

describe('окно сетки', () => {
  it('строки: заголовок месяца и карточки по колонкам', () => {
    const rows = gridRows(
      [
        { key: 'a', label: 'Июль', items: [1, 2, 3, 4] },
        { key: 'b', items: [5] },
      ],
      3,
    )

    expect(
      rows.map(row => (row.kind === 'header' ? row.label : row.items)),
    ).toEqual(['Июль', [1, 2, 3], [4], [5]])
  })

  it('окно вокруг фокуса, отступы — по высотам строк вне окна', () => {
    const kinds = [
      'header',
      'cards',
      'cards',
      'header',
      'cards',
      'cards',
    ] as const

    expect(rowWindow([...kinds], 4, 1, 0, { header: 10, cards: 100 })).toEqual({
      from: 3,
      to: 5,
      top: 210,
      bottom: 100,
    })
    expect(
      rowWindow([...kinds], 0, 2, 2, { header: 10, cards: 100 }),
    ).toMatchObject({
      from: 0,
      to: 3,
      top: 0,
    })
  })
})
