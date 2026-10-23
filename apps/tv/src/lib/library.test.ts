import type { LibraryFile } from '@torsher/api-client'
import { describe, expect, it } from 'vitest'
import { libraryFileFor, libraryTarget } from './library.ts'

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
