import type { LibraryFile } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import {
  firstLibraryFile,
  libraryChoices,
  libraryFileFor,
  libraryFilesFor,
  libraryTarget,
} from './library.ts'

function file(
  id: string,
  season: number | null,
  episode: number | null,
  episodeTo: number | null = null,
): LibraryFile {
  return {
    id,
    season,
    episode,
    episodeTo,
    quality: '1080p',
    size: 1,
    duration: null,
  }
}

describe('файлы библиотеки', () => {
  const show = [file('a', 1, 1), file('b', 1, 2, 3), file('c', 2, 1)]

  it('первый файл — самая ранняя серия, в каком бы порядке ни пришли', () => {
    expect(firstLibraryFile([file('c', 2, 1), file('b', 1, 2, 3)])?.id).toBe(
      'b',
    )
    expect(firstLibraryFile([])).toBeUndefined()
  })

  it('серия — по номеру, в том числе внутри файла с несколькими сериями', () => {
    expect(libraryFileFor(show, { season: 1, episode: 3 })?.id).toBe('b')
    expect(libraryFileFor(show, { season: 2, episode: 2 })).toBeUndefined()
  })

  it('«Смотреть»: фильм — его файл, сериал — файл серии, которую играть', () => {
    expect(libraryTarget([file('m', null, null)], false)?.id).toBe('m')
    expect(libraryTarget(show, true, { season: 2, episode: 1 })?.id).toBe('c')
    expect(libraryTarget(show, true, { season: 1, episode: 1 })?.id).toBe('a')
    expect(
      libraryTarget(show, true, { season: 3, episode: 1 }),
    ).toBeUndefined()
    expect(libraryTarget(show, true)).toBeUndefined()
    expect(libraryTarget([], true)).toBeUndefined()
  })

  it('не начатый сериал со скачанной серией из середины — не она', () => {
    const middle = [file('s3e3', 3, 3)]

    expect(
      libraryTarget(middle, true, { season: 1, episode: 1 }),
    ).toBeUndefined()
  })
})

describe('library version candidates', () => {
  it('includes every overlapping version but no unrelated episode', () => {
    const files = [
      file('span', 1, 1, 3),
      file('single', 1, 2),
      file('next', 1, 4),
      file('other', 2, 2),
    ]
    expect(
      libraryFilesFor(files, { season: 1, episode: 2 }).map(item => item.id),
    ).toEqual(['span', 'single'])
    expect(
      libraryChoices(files, true, { season: 1, episode: 8 }).files,
    ).toEqual([])
  })

  it('groups all movie versions and only the earliest episode on fallback', () => {
    const movies = [
      file('m1', null, null),
      file('m2', null, null),
      file('episode', 1, 1),
    ]
    expect(libraryChoices(movies, false).files.map(item => item.id)).toEqual([
      'm1',
      'm2',
    ])
    const series = [
      file('later', 2, 1),
      file('first-a', 1, 3),
      file('first-b', 1, 3, 4),
    ]
    expect(libraryChoices(series, true, null, true)).toEqual({
      files: series.slice(1),
      target: { season: 1, episode: 3 },
    })
    expect(libraryChoices(series, true).files).toEqual([])
  })
})

it('keeps special-only library fallback and groups only versions covering that special', () => {
  const only = file('special', null, 1)
  expect(libraryChoices([only], true, null, true)).toEqual({
    files: [only],
    target: { season: null, episode: 1 },
  })
  const files = [
    only,
    file('combined-specials', null, 1, 2),
    file('later-special', null, 3),
    file('regular', 1, 1),
  ]
  expect(
    libraryChoices(files, true, { season: 2, episode: 1 }, true).files.map(
      item => item.id,
    ),
  ).toEqual(['special', 'combined-specials'])
  expect(
    libraryFilesFor(files, { season: 0, episode: 2 }).map(item => item.id),
  ).toEqual(['combined-specials'])
  expect(libraryFilesFor(files, { episode: 1 })).toEqual([])
  expect(
    libraryChoices(files, true, { season: null, episode: 1 }).files.map(
      item => item.id,
    ),
  ).toEqual(['special', 'combined-specials'])
})
