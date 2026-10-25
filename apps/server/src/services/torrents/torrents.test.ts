import { describe, expect, it } from 'vitest'
import { parseMagnet } from './magnet.ts'
import { contentTypeOf, isVideoFile } from './media.ts'
import {
  bufferedAheadBytes,
  fileOffsetOf,
  isWatched,
  resumePosition,
  streamWindowOf,
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

// Фильм на 2,5 часа и серия на 22 минуты
const MOVIE = 9000
const EPISODE = 1320

describe('досмотрено', () => {
  it('фильм, остановленный на титрах, досмотрен', () => {
    expect(isWatched(MOVIE - 6 * 60, MOVIE)).toBe(true)
    expect(isWatched(8101, MOVIE)).toBe(true)
  })

  it('90% и раньше — ещё смотрим', () => {
    expect(isWatched(8100, MOVIE)).toBe(false)
    expect(isWatched(4500, MOVIE)).toBe(false)
  })

  it('серия: то же правило', () => {
    expect(isWatched(1189, EPISODE)).toBe(true)
    expect(isWatched(1188, EPISODE)).toBe(false)
  })

  it('последняя секунда — досмотрено', () => {
    expect(isWatched(1, 1)).toBe(true)
    expect(isWatched(EPISODE - 1, EPISODE)).toBe(true)
  })

  it('файл короче пяти минут досмотрен, как только начат', () => {
    expect(isWatched(60, 240)).toBe(true)
    expect(isWatched(5, 240)).toBe(false)
  })

  it('без длительности — не досмотрено', () => {
    expect(isWatched(9000, null)).toBe(false)
    expect(isWatched(10, 0)).toBe(false)
  })
})

describe('позиция для продолжения', () => {
  it('в первых 5% продолжать нечего', () => {
    expect(resumePosition(449, MOVIE)).toBeNull()
    expect(resumePosition(65, EPISODE)).toBeNull()
  })

  it('с 5% — продолжить с той же секунды', () => {
    expect(resumePosition(450, MOVIE)).toBe(450)
    expect(resumePosition(66, EPISODE)).toBe(66)
    expect(resumePosition(1800, 5400)).toBe(1800)
  })

  it('досмотренный файл играем с начала', () => {
    expect(resumePosition(MOVIE - 6 * 60, MOVIE)).toBeNull()
    expect(resumePosition(1270, EPISODE)).toBeNull()
  })

  it('файл короче пяти минут не продолжаем', () => {
    expect(resumePosition(120, 240)).toBeNull()
  })

  it('без длительности — продолжить после первых 30 секунд', () => {
    expect(resumePosition(600, null)).toBe(600)
    expect(resumePosition(29, null)).toBeNull()
  })
})

describe('окно просмотра', () => {
  const MIB = 1024 * 1024

  it('три минуты видео по среднему битрейту', () => {
    // 4,5 ГиБ на 45 минут — 100 МиБ в минуту
    expect(streamWindowOf(4500 * MIB, 45 * 60)).toBe(300 * MIB)
  })

  it('не меньше 64 МиБ и не больше 1 ГиБ', () => {
    expect(streamWindowOf(300 * MIB, 45 * 60)).toBe(64 * MIB)
    expect(streamWindowOf(80 * 1024 * MIB, 60 * 60)).toBe(1024 * MIB)
  })

  it('без длительности — окно по умолчанию', () => {
    expect(streamWindowOf(4500 * MIB, null)).toBe(128 * MIB)
  })
})
