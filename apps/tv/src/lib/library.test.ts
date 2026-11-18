import type { LibraryFile } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { downloadSlot } from './downloadSlot.ts'
import {
  firstLibraryFile,
  libraryChoices,
  libraryEpisodeCount,
  libraryFileFor,
  libraryFilesFor,
  libraryTarget,
  sourceLibraryChoice,
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

describe('unique season library coverage', () => {
  it('does not let a future library episode replace a missing aired episode', () => {
    const future = Array.from({ length: 7 }, (_, index) =>
      file(`${index}`, 1, index + 2))
    const complete = [file('aired', 1, 1, 7)]
    expect(libraryEpisodeCount(future, 1, 7)).toBe(6)
    expect(libraryEpisodeCount(complete, 1, 7)).toBe(7)
    const input = {
      series: true,
      season: 1,
      downloads: [],
      movieInLibrary: false,
      seasonAired: 7,
    }
    expect(
      downloadSlot({
        ...input,
        seasonInLibrary: libraryEpisodeCount(future, 1, 7),
      }),
    ).toEqual({ kind: 'start' })
    expect(
      downloadSlot({
        ...input,
        seasonInLibrary: libraryEpisodeCount(complete, 1, 7),
      }),
    ).toEqual({ kind: 'none' })
  })
  it('counts alternate versions of E2 and E3 as two episodes', () => {
    const files = [
      file('2a', 1, 2),
      file('2b', 1, 2),
      file('3a', 1, 3),
      file('3b', 1, 3),
    ]
    expect(libraryEpisodeCount(files, 1)).toBe(2)
  })

  it('unions overlapping multi-episode ranges and includes disjoint episodes', () => {
    const files = [
      file('tail', 1, 3, 5),
      file('single', 1, 2),
      file('head', 1, 1, 3),
      file('gap', 1, 8),
    ]
    expect(libraryEpisodeCount(files, 1)).toBe(6)
  })

  it('keeps seasons separate and ignores files without episode mapping', () => {
    const files = [
      file('s1', 1, 1, 2),
      file('s2', 2, 1, 3),
      file('unknown', 1, null),
      file('movie', null, null),
    ]
    expect(libraryEpisodeCount(files, 1)).toBe(2)
    expect(libraryEpisodeCount(files, 2)).toBe(3)
    expect(libraryEpisodeCount(files, 3)).toBe(0)
    expect(libraryEpisodeCount(files)).toBe(0)
    expect(libraryEpisodeCount([], 1)).toBe(0)
  })

  it('uses the same special season normalization as libraryFilesFor', () => {
    const files = [
      file('special-a', null, 1, 2),
      file('special-b', 0, 2, 3),
      file('regular', 1, 1),
    ]
    expect(libraryEpisodeCount(files, 0)).toBe(3)
    expect(libraryEpisodeCount(files, 1)).toBe(1)
  })

  it('keeps season download available despite enough duplicate files to hide it', () => {
    const files = Array.from({ length: 8 }, (_, i) =>
      file(`${i}`, 1, i < 4 ? 2 : 3))
    const input = {
      series: true,
      season: 1,
      downloads: [],
      movieInLibrary: false,
      seasonAired: 7,
      seasonInLibrary: libraryEpisodeCount(files, 1),
    }
    expect(downloadSlot(input)).toEqual({ kind: 'start' })
    expect(
      downloadSlot({
        ...input,
        seasonInLibrary: libraryEpisodeCount(
          [...files, file('complete', 1, 1, 7)],
          1,
        ),
      }),
    ).toEqual({ kind: 'none' })
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

describe('sources after exact episode resolution fails', () => {
  it('does not replace S2E6 with the title resume or first library episode', () => {
    const files = [file('first', 2, 1), file('resume', 2, 3)]
    const requested = { season: 2, episode: 6 }
    const choice = sourceLibraryChoice(
      files,
      true,
      { season: 2, episode: 3 },
      requested,
    )
    expect(choice).toEqual({ files: [], target: requested })
    expect(
      sourceLibraryChoice(
        [...files, file('combined', 2, 5, 7)],
        true,
        { season: 2, episode: 3 },
        requested,
      ),
    ).toEqual({
      files: [file('combined', 2, 5, 7)],
      target: requested,
    })
  })

  it('preserves the existing fallback for sources opened without an episode', () => {
    const first = file('first', 2, 1)
    expect(
      sourceLibraryChoice([first], true, { season: 2, episode: 3 }),
    ).toEqual({
      files: [first],
      target: { season: 2, episode: 1 },
    })
  })
})
