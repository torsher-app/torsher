import { describe, expect, it } from 'vitest'
import { parseMagnet } from './magnet.ts'
import { contentTypeOf, isVideoFile } from './media.ts'
import {
  bufferedAheadBytes,
  fileOffsetOf,
  resumePosition,
} from './playback.ts'

const HEX = '0123456789abcdef0123456789abcdef01234567'

describe('magnet', () => {
  it('infohash в hex приводится к нижнему регистру, имя берётся из dn', () => {
    expect(
      parseMagnet(
        `magnet:?xt=urn:btih:${HEX.toUpperCase()}&dn=Sample+Movie&tr=http%3A%2F%2Ftracker.example%2Fannounce`,
      ),
    ).toEqual({ infoHash: HEX, name: 'Sample Movie' })
  })

  it('infohash в base32 переводится в hex', () => {
    // 20 нулевых байт в base32
    expect(parseMagnet(`magnet:?xt=urn:btih:${'A'.repeat(32)}`)).toEqual({
      infoHash: '0'.repeat(40),
      name: null,
    })
  })

  it('гибридная ссылка: берётся v1-хеш, v2 пропускается', () => {
    expect(
      parseMagnet(
        `magnet:?xt=urn:btmh:1220${'a'.repeat(64)}&xt=urn:btih:${HEX}`,
      )?.infoHash,
    ).toBe(HEX)
  })

  it.each([
    'https://example.com/file.torrent',
    'magnet:?dn=no-hash',
    'magnet:?xt=urn:btih:xyz',
    `magnet:?xt=urn:btmh:1220${'a'.repeat(64)}`,
    'not a link',
  ])('не magnet v1: %s', (input) => {
    expect(parseMagnet(input)).toBeNull()
  })
})

describe('файлы', () => {
  it('видео по расширению и тип для плеера', () => {
    expect(isVideoFile('Show/Episode.01.MKV')).toBe(true)
    expect(isVideoFile('Show/Episode.01.srt')).toBe(false)
    expect(contentTypeOf('a/b.mp4')).toBe('video/mp4')
    expect(contentTypeOf('a/b.mkv')).toBe('video/x-matroska')
    expect(contentTypeOf('a/readme')).toBe('application/octet-stream')
  })

  it('смещение файла считает и файлы-выравнивания', () => {
    const files = [
      { path: 'a', size: 100, padding: false },
      { path: '.pad/0', size: 28, padding: true },
      { path: 'b', size: 50, padding: false },
    ]

    expect(fileOffsetOf(files, 0)).toBe(0)
    expect(fileOffsetOf(files, 2)).toBe(128)
  })
})

describe('буфер впереди позиции', () => {
  // Куски по 100 байт: скачаны 0, 1, 2 и 5
  const base = { pieces: '11100100', pieceLength: 100 }

  it('считает подряд скачанное от позиции до первого пропуска', () => {
    expect(
      bufferedAheadBytes({
        ...base,
        fileOffset: 0,
        fileSize: 800,
        position: 50,
      }),
    ).toBe(250)
  })

  it('кусок под позицией не скачан — буфера нет', () => {
    expect(
      bufferedAheadBytes({
        ...base,
        fileOffset: 0,
        fileSize: 800,
        position: 350,
      }),
    ).toBe(0)
  })

  it('не выходит за конец файла', () => {
    expect(
      bufferedAheadBytes({
        ...base,
        fileOffset: 120,
        fileSize: 100,
        position: 10,
      }),
    ).toBe(90)
  })

  it('позиция в конце файла — ноль', () => {
    expect(
      bufferedAheadBytes({
        ...base,
        fileOffset: 0,
        fileSize: 300,
        position: 300,
      }),
    ).toBe(0)
  })
})

describe('позиция для продолжения', () => {
  it('в самом начале продолжать нечего', () => {
    expect(resumePosition(12, 5400)).toBeNull()
  })

  it('с середины — продолжить с той же секунды', () => {
    expect(resumePosition(1800, 5400)).toBe(1800)
  })

  it('у самого конца файл считается досмотренным', () => {
    expect(resumePosition(5300, 5400)).toBeNull()
    expect(resumePosition(1270, 1320)).toBeNull()
  })

  it('без известной длительности — продолжить', () => {
    expect(resumePosition(600, null)).toBe(600)
  })
})
