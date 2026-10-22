import { describe, expect, it } from 'vitest'
import { matchFiles } from './files.ts'
import { parseRelease } from './parse.ts'

const MB = 1024 * 1024
const GB = 1024 * MB

function episodes(paths: string[], title?: string) {
  const files = paths.map(path => ({ path, size: GB }))
  return matchFiles(files, title ? parseRelease(title) : undefined).map(
    ({ season, episode, episodeTo, absolute }) => ({
      season,
      episode,
      episodeTo,
      absolute,
    }),
  )
}

describe('matchFiles', () => {
  it('s13e05 и 13x05', () => {
    expect(
      episodes(['Show/Show.S13E05.1080p.mkv', 'Show/show.13x06.mkv']),
    ).toEqual([
      { season: 13, episode: 5, episodeTo: undefined, absolute: undefined },
      { season: 13, episode: 6, episodeTo: undefined, absolute: undefined },
    ])
  })

  it('номер с # или № в начале имени файла', () => {
    expect(
      episodes(
        ['Show [S02]/#01 Север помнит.mkv', 'Show [S02]/№10 Финал.mkv'],
        'Show [S02] (2012)',
      ),
    ).toEqual([
      { season: 2, episode: 1, episodeTo: undefined, absolute: undefined },
      { season: 2, episode: 10, episodeTo: undefined, absolute: undefined },
    ])
  })

  it('несколько серий в одном файле', () => {
    expect(episodes(['Show.S01E01E02.mkv'])[0]).toMatchObject({
      season: 1,
      episode: 1,
      episodeTo: 2,
    })
  })

  it('«05 серия» и «Серия 05» берут сезон из раздачи', () => {
    expect(
      episodes(
        ['Название/05 серия.mkv', 'Название/Серия 06.mkv'],
        'Название [S02] (2025) WEB-DL 1080p',
      ),
    ).toEqual([
      { season: 2, episode: 5, episodeTo: undefined, absolute: undefined },
      { season: 2, episode: 6, episodeTo: undefined, absolute: undefined },
    ])
  })

  it('сезон из вложенных папок', () => {
    expect(
      episodes([
        'Название/Сезон 1/01. Пилот.mkv',
        'Название/Season 2/Episode 03.mkv',
        'Название/S03/Название 07.mkv',
        'Название/2 сезон/105.mkv',
      ]),
    ).toEqual([
      { season: 1, episode: 1, episodeTo: undefined, absolute: undefined },
      { season: 2, episode: 3, episodeTo: undefined, absolute: undefined },
      { season: 3, episode: 7, episodeTo: undefined, absolute: undefined },
      { season: 2, episode: 105, episodeTo: undefined, absolute: undefined },
    ])
  })

  it('трёхзначный номер вида 105 в первом сезоне — пятая серия', () => {
    expect(episodes(['Show/105.mkv'], 'Show [S01] (2025)')[0]).toMatchObject({
      season: 1,
      episode: 5,
    })
  })

  it('абсолютная нумерация', () => {
    expect(episodes(['[Group] Title - 1071 [1080p].mkv'])[0]).toMatchObject({
      absolute: 1071,
      episode: undefined,
    })
    expect(
      episodes(
        ['Title/0145.mkv', 'Title/0146.mkv'],
        '[Group] Title - 0145-0146 [1080p]',
      ).map(file => file.absolute),
    ).toEqual([145, 146])
  })

  it('помечает сэмплы, доп. материалы и служебные файлы', () => {
    const files = [
      { path: 'Show/Show.S01E01.mkv', size: 2 * GB },
      { path: 'Show/Sample/show.s01e01.sample.mkv', size: 40 * MB },
      { path: 'Show/clip.mkv', size: 20 * MB },
      { path: 'Show/Extras/Making of.mkv', size: 900 * MB },
      { path: 'Show/Show.S01E01.trailer.mp4', size: 300 * MB },
      { path: 'Show/Subs/Show.S01E01.rus.srt', size: 50_000 },
      { path: 'Show/Sound/Show.S01E01.LostFilm.mka', size: 300 * MB },
      { path: 'Show/cover.jpg', size: 200_000 },
      { path: 'Show/info.nfo', size: 2000 },
    ]
    expect(matchFiles(files).map(file => file.kind)).toEqual([
      'video',
      'sample',
      'sample',
      'extra',
      'extra',
      'subtitle',
      'audio',
      'image',
      'other',
    ])
  })

  it('внешние субтитры и дорожки тоже получают серию', () => {
    const [subs] = matchFiles([
      { path: 'Show/Subs/Show.S01E04.rus.srt', size: 50_000 },
    ])
    expect(subs).toMatchObject({ kind: 'subtitle', season: 1, episode: 4 })
  })

  it('нумерует по порядку, когда номеров нет, а число файлов совпадает с сериями', () => {
    const result = matchFiles(
      ['b.mkv', 'a.mkv', 'c.mkv'].map(path => ({
        path: `Название/${path}`,
        size: GB,
      })),
      parseRelease('Название [S01E01-03 of 03] (2025)'),
    )
    expect(
      result.map(file => [file.path, file.episode, file.confidence]),
    ).toEqual([
      ['Название/b.mkv', 2, 0.4],
      ['Название/a.mkv', 1, 0.4],
      ['Название/c.mkv', 3, 0.4],
    ])
  })

  it('не принимает звук 5.1 и год фильма за серию', () => {
    expect(
      episodes(['Movie.2019.1080p.DD5.1.mkv'], 'Movie (2019) BDRip 1080p')[0],
    ).toEqual({
      season: undefined,
      episode: undefined,
      episodeTo: undefined,
      absolute: undefined,
    })
    expect(
      episodes(['Movie.2019.1080p.DD5.1.mkv'])[0]!.episode,
    ).toBeUndefined()
  })
})
