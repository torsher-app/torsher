import { describe, expect, it } from 'vitest'
import { parseRelease } from './parse.ts'
import { frameResolution, videoResolution } from './resolution.ts'

describe('frameResolution', () => {
  it.each([
    [3840, 2160, '2160p'],
    [3840, 1600, '2160p'],
    [2560, 1440, '1440p'],
    [1920, 1080, '1080p'],
    [1920, 800, '1080p'],
    [1440, 1080, '1080p'],
    [1280, 720, '720p'],
    [1280, 534, '720p'],
    [1024, 576, '576p'],
    [720, 576, '576p'],
    [720, 400, '480p'],
    [640, 360, '480p'],
  ] as const)('%dx%d → %s', (width, height, expected) => {
    expect(frameResolution(width, height)).toBe(expected)
  })
})

describe('videoResolution', () => {
  it.each([
    [
      'Название (2020) BDRip 1080p',
      { value: '1080p', basis: 'title', sure: true },
    ],
    [
      'Название (2020) WEB-DL 1440p',
      { value: '1080p', basis: 'title', sure: true },
    ],
    [
      'Название (2020) HDTV 1080i',
      { value: '1080p', basis: 'title', sure: true },
    ],
    [
      'Название (2020) 4K WEB-DL',
      { value: '2160p', basis: 'title', sure: true },
    ],
    [
      'Название (2020) WEB-DLRip 480p',
      { value: 'SD', basis: 'title', sure: true },
    ],
    ['Название (2020) DVDRip', { value: 'SD', basis: 'source', sure: true }],
    ['Название (2020) DVD9', { value: 'SD', basis: 'source', sure: true }],
    ['Название (2020) BDRip', { value: 'SD', basis: 'source', sure: false }],
    ['Название (2020) HDRip', { value: 'SD', basis: 'source', sure: false }],
    [
      'Название (2020) WEB-DLRip',
      { value: 'SD', basis: 'source', sure: false },
    ],
    ['Название (2020) SATRip', { value: 'SD', basis: 'source', sure: false }],
    ['Name.2020.WEBRip.x264', { value: 'SD', basis: 'source', sure: false }],
    ['Name.2020.HDTV.XviD', { value: 'SD', basis: 'codec', sure: false }],
    [
      'Название (2020) Blu-ray',
      { value: '1080p', basis: 'source', sure: false },
    ],
    [
      'Название (2020) BDRemux',
      { value: '1080p', basis: 'source', sure: false },
    ],
  ] as const)('%s', (title, expected) => {
    expect(videoResolution(parseRelease(title))).toEqual(expected)
  })

  it.each([
    'Название (2020) WEB-DL',
    'Название (2020) HDTV',
    'Название (2020) IPTV',
    'Название (2020)',
  ])('%s — не вывести', (title) => {
    expect(videoResolution(parseRelease(title))).toBeUndefined()
  })
})
