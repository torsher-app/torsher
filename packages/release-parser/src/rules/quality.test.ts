import { describe, expect, it } from 'vitest'
import { parseRelease } from '../parse.ts'

function video(title: string) {
  const { quality, source, codec, hdr } = parseRelease(title)
  return { quality, source, codec, hdr }
}

describe('качество и источник', () => {
  it.each([
    [
      'Show.S01E01.1080p.WEB-DL.x265',
      { quality: '1080p', source: 'WEB-DL', codec: 'H.265', hdr: [] },
    ],
    [
      'Название [2024, драма, WEB-DLRip 720p]',
      { quality: '720p', source: 'WEB-DLRip', codec: undefined, hdr: [] },
    ],
    [
      'Название [2024, драма, HDTVRip-AVC]',
      { quality: undefined, source: 'HDTVRip', codec: 'H.264', hdr: [] },
    ],
    [
      'Название (2025) IPTV',
      { quality: undefined, source: 'IPTV', codec: undefined, hdr: [] },
    ],
    [
      'Название (2025) SATRip',
      { quality: undefined, source: 'SATRip', codec: undefined, hdr: [] },
    ],
    [
      'Movie.2023.2160p.UHD.Blu-ray.Remux.HEVC.DV.HDR10',
      {
        quality: '2160p',
        source: 'BDRemux',
        codec: 'H.265',
        hdr: ['DV', 'HDR10'],
      },
    ],
    [
      'Movie.2023.2160p.WEB-DL.HDR10+.H.265',
      { quality: '2160p', source: 'WEB-DL', codec: 'H.265', hdr: ['HDR10+'] },
    ],
    [
      'Название (2024) 4K WEB-DL | HDR',
      { quality: '2160p', source: 'WEB-DL', codec: undefined, hdr: ['HDR10'] },
    ],
    [
      'Movie 2019 BDRip 1920x1080 AVC',
      { quality: '1080p', source: 'BDRip', codec: 'H.264', hdr: [] },
    ],
    [
      'Movie.2021.1080p.WEB.H264-GRP',
      { quality: '1080p', source: 'WEB-DL', codec: 'H.264', hdr: [] },
    ],
    [
      'Название (2025) WEB DL 1080p',
      { quality: '1080p', source: 'WEB-DL', codec: undefined, hdr: [] },
    ],
    [
      'Movie.2020.DVDRip.XviD',
      { quality: undefined, source: 'DVDRip', codec: 'XviD', hdr: [] },
    ],
    [
      'Movie.2024.HDTS.x264',
      { quality: undefined, source: 'TS', codec: 'H.264', hdr: [] },
    ],
    [
      'Movie 2024 2160p Dolby Vision WEB-DL',
      { quality: '2160p', source: 'WEB-DL', codec: undefined, hdr: ['DV'] },
    ],
  ] as const)('%s', (title, expected) => {
    expect(video(title)).toEqual(expected)
  })

  it('не принимает слово названия за тег', () => {
    expect(video('Паутина / The Web (2020) BDRip 720p')).toMatchObject({
      source: 'BDRip',
      quality: '720p',
    })
    expect(
      parseRelease('Паутина / The Web (2020) BDRip 720p').titles.orig,
    ).toBe('The Web')
  })
})
