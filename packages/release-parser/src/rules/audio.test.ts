import { describe, expect, it } from 'vitest'
import { parseRelease } from '../parse.ts'

function voices(title: string) {
  const { audio, subs } = parseRelease(title)
  return { audio, subs }
}

describe('маркеры после `|`', () => {
  it.each([
    ['Название (2025) WEB-DL 1080p | D', [{ type: 'D' }]],
    ['Название (2025) WEB-DL 1080p | P', [{ type: 'MVO' }]],
    ['Название (2025) WEB-DL 1080p | MVO', [{ type: 'MVO' }]],
    ['Название (2025) WEB-DL 1080p | A', [{ type: 'AVO' }]],
    ['Название (2025) WEB-DL 1080p | L', [{ type: 'L' }]],
    ['Название (2025) WEB-DL 1080p | P2', [{ type: 'DVO' }]],
    ['Название (2025) WEB-DL 1080p | L1', [{ type: 'L' }]],
    [
      'Название (2025) WEB-DL 1080p | D, P, A',
      [{ type: 'D' }, { type: 'MVO' }, { type: 'AVO' }],
    ],
    [
      'Название (2025) WEB-DL 1080p | LostFilm',
      [{ type: 'MVO', studio: 'LostFilm' }],
    ],
    ['Название (2025) WEB-DL 1080p | Пифагор', [{ studio: 'Пифагор' }]],
    [
      'Название (2025) WEB-DL 1080p | P | NewStudio, TVShows',
      [
        { type: 'MVO', studio: 'NewStudio' },
        { type: 'MVO', studio: 'TVShows' },
      ],
    ],
    ['Название (2025) WEB-DL 1080p | D | Лицензия', [{ type: 'D' }]],
    [
      'Название (2025) WEB-DL 1080p | P | Кубик в Кубе',
      [{ type: 'MVO', studio: 'Кубик в Кубе' }],
    ],
  ] as const)('%s', (title, audio) => {
    expect(voices(title).audio).toEqual(audio)
  })

  it('одиночная буква до `|` озвучкой не считается', () => {
    expect(voices('Plan A (2025) WEB-DL 1080p').audio).toEqual([])
  })
})

describe('озвучка в хвосте русской раздачи', () => {
  it('mVO со студиями, оригинал и субтитры', () => {
    expect(
      voices(
        'Название / Original / Сезон: 1 [2024, WEB-DL 1080p] MVO (LostFilm, NewStudio) + Original + Sub (Rus, Eng)',
      ),
    ).toEqual({
      audio: [
        { type: 'MVO', studio: 'LostFilm' },
        { type: 'MVO', studio: 'NewStudio' },
        { type: 'Original' },
      ],
      subs: ['ru', 'en'],
    })
  })

  it.each([
    ['Название [2024, BDRip 1080p] Dub', [{ type: 'D' }]],
    [
      'Название [2024, BDRip 1080p] Dub (Невафильм)',
      [{ type: 'D', studio: 'Невафильм' }],
    ],
    [
      'Название [2024, BDRip 1080p] Dub + AVO (Гаврилов)',
      [{ type: 'D' }, { type: 'AVO', studio: 'Гаврилов' }],
    ],
    [
      'Название [2024, BDRip 1080p] DVO (Кубик в Кубе)',
      [{ type: 'DVO', studio: 'Кубик в Кубе' }],
    ],
    [
      'Название [2024, BDRip 1080p] VO + Original Eng',
      [{ type: 'VO' }, { type: 'Original', language: 'en' }],
    ],
    [
      'Название [2024, BDRip 1080p] Профессиональный (многоголосый)',
      [{ type: 'MVO' }],
    ],
    [
      'Название [2024, BDRip 1080p] Профессиональный (двухголосый)',
      [{ type: 'DVO' }],
    ],
    [
      'Название [2024, BDRip 1080p] Любительский (одноголосый)',
      [{ type: 'L' }],
    ],
    [
      'Название [2024, BDRip 1080p] Авторский (одноголосый) Сербин',
      [{ type: 'AVO', studio: 'Сербин' }],
    ],
    [
      'Название [2024, BDRip 1080p] MVO (HDRezka Studio) + Ukr',
      [{ type: 'MVO', studio: 'HDRezka Studio' }, { language: 'uk' }],
    ],
    [
      'Show.S01E01.1080p.WEB-DL.Rus.Eng',
      [{ language: 'ru' }, { language: 'en' }],
    ],
  ] as const)('%s', (title, audio) => {
    expect(voices(title).audio).toEqual(audio)
  })

  it('субтитры без языка и субтитры перед языком', () => {
    expect(voices('Название [2024, BDRip 1080p] Dub + Sub').subs).toEqual([
      'und',
    ])
    expect(voices('Show.S01.1080p.WEB-DL.Rus.Sub').subs).toEqual(['ru'])
    expect(voices('Show.S01.1080p.WEB-DL.Rus.Sub').audio).toEqual([])
  })

  it('студия из релиз-группы scene-имени', () => {
    expect(voices('Show.S01E01.1080p.WEB-DL.H.264-LostFilm').audio).toEqual([
      { type: 'MVO', studio: 'LostFilm' },
    ])
  })

  it('студию в названии не ищет', () => {
    expect(voices('Amedia (2024) WEB-DL 1080p').audio).toEqual([])
  })
})
