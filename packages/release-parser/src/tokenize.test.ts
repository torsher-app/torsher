import { describe, expect, it } from 'vitest'
import { tokenize } from './tokenize.ts'

function words(raw: string) {
  return tokenize(raw).tokens.map(token => token.value)
}

describe('tokenize', () => {
  it('делит scene-имя по точкам и сохраняет теги с точкой', () => {
    expect(words('Show.Name.S01E02.1080p.WEB-DL.DDP5.1.H.264-GRP')).toEqual([
      'Show',
      'Name',
      'S01E02',
      '1080p',
      'WEB-DL',
      'DDP5.1',
      'H.264-GRP',
    ])
  })

  it('держит 5.1 и 2.0 целыми, но не склеивает номер серии с качеством', () => {
    expect(words('Title.S01E01.1080p.AAC.2.0')).toEqual([
      'Title',
      'S01E01',
      '1080p',
      'AAC',
      '2.0',
    ])
  })

  it('оставляет `|` значимым токеном и помечает всё после него', () => {
    const { tokens } = tokenize('Название (2025) WEB-DL 1080p | D, P')
    const pipe = tokens.find(token => token.value === '|')!

    expect(pipe.kind).toBe('punct')
    expect(
      tokens.filter(token => token.afterPipe).map(token => token.value),
    ).toEqual(['D', ',', 'P'])
    expect(
      tokens
        .filter(token => token.index < pipe.index)
        .every(token => !token.afterPipe),
    ).toBe(true)
  })

  it('считает сегменты по ` / ` только на верхнем уровне', () => {
    const { tokens } = tokenize(
      'Тихая гавань / Quiet Harbor / Сезон: 1 [2024, США / Канада, драма]',
    )
    const segmentOf = (value: string) =>
      tokens.find(token => token.value === value)!.segment

    expect(segmentOf('Тихая')).toBe(0)
    expect(segmentOf('Quiet')).toBe(1)
    expect(segmentOf('Сезон')).toBe(2)
    expect(segmentOf('Канада')).toBe(2)
  })

  it('запоминает скобочные группы и их вложенность', () => {
    const { tokens, groups } = tokenize(
      'Title [S01E01-20 of 30] (2025) MVO (LostFilm [rip])',
    )

    expect(groups.map(group => group.kind)).toEqual([
      'square',
      'round',
      'round',
      'square',
    ])
    expect(groups[3]!.parent).toBe(2)
    expect(tokens.find(token => token.value === 'of')!.group).toBe(0)
    expect(tokens.find(token => token.value === 'rip')!.group).toBe(3)
    expect(
      tokens.find(token => token.value === 'MVO')!.group,
    ).toBeUndefined()
  })

  it('сохраняет исходные позиции', () => {
    const raw = 'Серии: 1-8 из 8 [2025]'
    const { tokens } = tokenize(raw)

    for (const token of tokens)
      expect(raw.slice(token.start, token.end)).toBe(token.value)
    expect(tokens.map(token => token.value)).toEqual([
      'Серии',
      ':',
      '1-8',
      'из',
      '8',
      '2025',
    ])
  })

  it('отделяет одиночный дефис, но не дефис внутри слова', () => {
    expect(words('[Group] Show - 05 [1080p]')).toEqual([
      'Group',
      'Show',
      '-',
      '05',
      '1080p',
    ])
    expect(words('Человек-паук 1 - 8')).toEqual([
      'Человек-паук',
      '1',
      '-',
      '8',
    ])
  })

  it('нормализует регистр и ё', () => {
    expect(tokenize('Ёлки СЕЗОН').tokens.map(token => token.norm)).toEqual([
      'елки',
      'сезон',
    ])
  })

  it('переживает непарные скобки', () => {
    expect(words('Title (2025 [1080p')).toEqual(['Title', '2025', '1080p'])
    expect(words('Title) 2025]')).toEqual(['Title', '2025'])
  })
})
