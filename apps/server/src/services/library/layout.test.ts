import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import {
  episodeCode,
  safeName,
  sidecarPath,
  titleFolder,
  videoPath,
} from './layout.ts'

const movie = {
  kind: 'movie' as const,
  name: 'Sample Movie',
  year: 2010,
  tmdbId: 27205,
}
const show = {
  kind: 'series' as const,
  name: 'Sample Show',
  year: 2008,
  tmdbId: 1396,
}

describe('раскладка', () => {
  it('фильм: папка и файл с ID каталога', () => {
    expect(videoPath(movie, 'MKV')).toBe(
      'movies/Sample Movie (2010) [tmdbid-27205]/Sample Movie (2010) [tmdbid-27205].mkv',
    )
  })

  it('вторая версия фильма — суффикс после дефиса', () => {
    expect(videoPath(movie, 'mkv', undefined, '2160p')).toBe(
      'movies/Sample Movie (2010) [tmdbid-27205]/Sample Movie (2010) [tmdbid-27205] - 2160p.mkv',
    )
  })

  it('серия: сезон в папке, номер в имени', () => {
    expect(videoPath(show, 'mkv', { season: 1, episode: 5 })).toBe(
      'shows/Sample Show (2008) [tmdbid-1396]/Season 01/Sample Show S01E05.mkv',
    )
  })

  it('несколько серий в файле и спецвыпуски', () => {
    expect(episodeCode({ season: 1, episode: 1, episodeTo: 2 })).toBe(
      'S01E01-E02',
    )
    expect(videoPath(show, 'mp4', { season: 0, episode: 3 })).toBe(
      'shows/Sample Show (2008) [tmdbid-1396]/Season 00/Sample Show S00E03.mp4',
    )
    expect(episodeCode({ season: 12, episode: 104 })).toBe('S12E104')
  })

  it('без года — без скобок', () => {
    expect(titleFolder({ ...movie, year: undefined })).toBe(
      'Sample Movie [tmdbid-27205]',
    )
  })

  it('запрещённые символы, управляющие и завершающие точки убираются', () => {
    expect(safeName('Who: Are/You? <"Part"> * 2|3...')).toBe(
      'Who Are You Part 2 3',
    )
    expect(safeName('Tab\there\u0000')).toBe('Tab here')
    expect(titleFolder({ ...movie, name: '...' })).toBe(
      'Untitled (2010) [tmdbid-27205]',
    )
  })

  it('имя не длиннее 120 байт и без разрезанных букв', () => {
    const name = safeName('Очень длинное название '.repeat(20))

    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(120)
    expect(name).not.toMatch(/�/)
    expect(name).toMatch(/^Очень длинное/)
  })

  it('имя в NFD с macOS приводится к NFC', () => {
    const nfd = 'Ёлки'.normalize('NFD')

    expect(safeName(nfd)).toBe('Ёлки'.normalize('NFC'))
  })

  it('субтитры и дорожки — рядом с тем же базовым именем', () => {
    const video = 'shows/Show [tmdbid-1]/Season 01/Show S01E05.mkv'

    expect(sidecarPath(video, 'SRT', ['rus', 'forced'])).toBe(
      'shows/Show [tmdbid-1]/Season 01/Show S01E05.rus.forced.srt',
    )
    expect(sidecarPath(video, 'mka', ['Studio: Name', 'rus'])).toBe(
      'shows/Show [tmdbid-1]/Season 01/Show S01E05.Studio Name.rus.mka',
    )
  })
})
