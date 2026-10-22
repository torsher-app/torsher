import type { TitleTarget } from './match.ts'
import { describe, expect, it } from 'vitest'
import { matchTitle } from './match.ts'
import { parseRelease } from './parse.ts'

const harbor: TitleTarget = {
  kind: 'series',
  aliases: ['Тихая гавань', 'Quiet Harbor', 'Tikhaya gavan'],
  year: 2023,
  season: 2,
}

const lantern: TitleTarget = {
  kind: 'movie',
  aliases: ['Бумажный фонарь', 'The Paper Lantern'],
  year: 2021,
}

function match(title: string, target: TitleTarget) {
  return matchTitle(parseRelease(title), target)
}

describe('matchTitle', () => {
  it.each([
    'Тихая гавань / Quiet Harbor / Сезон: 2 / Серии: 1-8 из 8 (2024) WEB-DL 1080p | LostFilm',
    'Quiet.Harbor.S02E05.1080p.WEB-DL.H.264-GRP',
    'Tikhaya gavan [S02E01-04 из 08] (2024) WEBRip 720p',
    'Тихая гавань [S01-02] (2023-2024) WEB-DL 1080p',
  ])('сериал: %s → high', (title) => {
    expect(match(title, harbor)).toEqual({ confidence: 'high', issues: [] })
  })

  it('чужое название → low', () => {
    expect(
      match('Тёмная гавань / Dark Harbor / Сезон: 2 (2024) WEB-DL', harbor),
    ).toEqual({ confidence: 'low', issues: ['title'] })
  })

  it('другой сезон → low', () => {
    expect(match('Quiet.Harbor.S03E01.1080p.WEB-DL-GRP', harbor)).toEqual({
      confidence: 'low',
      issues: ['season'],
    })
  })

  it('продолжение с подзаголовком → medium', () => {
    expect(
      match('Тихая гавань Возвращение / Сезон: 2 (2024) WEB-DL 1080p', harbor),
    ).toEqual({ confidence: 'medium', issues: ['partialTitle'] })
  })

  it.each([
    'Тихая гавань Зеро / Harbor Zero (2018) BDRip 1080p | P',
    'Тихая гавань X (2023) WEB-DL 1080p | L1',
  ])('похожее начало без сезона: %s → low', (title) => {
    expect(match(title, harbor).confidence).toBe('low')
  })

  it('без сезона и не первый сезон → medium', () => {
    expect(match('Тихая гавань (2023-2025) WEB-DL 1080p', harbor)).toEqual({
      confidence: 'medium',
      issues: ['noSeason'],
    })
  })

  it('без сезона с сериями подходит первому сезону', () => {
    expect(
      match('Тихая гавань [01-08 из 08] (2023) WEB-DL 1080p', {
        ...harbor,
        season: 1,
      }).confidence,
    ).toBe('high')
  })

  it('год до начала сериала → medium', () => {
    expect(
      match('Тихая гавань / Сезон: 2 (2015) WEB-DL 1080p', harbor),
    ).toEqual({ confidence: 'medium', issues: ['year'] })
  })

  it.each([
    'Бумажный фонарь / The Paper Lantern (2021) BDRip 1080p | D',
    'The.Paper.Lantern.2022.2160p.WEB-DL.HDR-GRP',
    'Бумажный фонарь (2021) WEB-DL 720p',
  ])('фильм: %s → high', (title) => {
    expect(match(title, lantern).confidence).toBe('high')
  })

  it('омоним фильма другого года → medium', () => {
    expect(match('The Paper Lantern (1987) DVDRip', lantern)).toEqual({
      confidence: 'medium',
      issues: ['year'],
    })
  })

  it('фильм с похожим началом и чужим годом → low', () => {
    expect(match('Бумажный фонарь 2 (2024) WEB-DL 1080p', lantern)).toEqual({
      confidence: 'low',
      issues: ['partialTitle', 'year'],
    })
  })

  it('сериал с названием фильма → low', () => {
    expect(
      match('Бумажный фонарь / Сезон: 1 / Серии: 1-6 из 6 (2021)', lantern),
    ).toEqual({ confidence: 'low', issues: ['kind'] })
  })
})
