import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { readCueTimes } from './matroska.ts'

const fixture = await readFile(new URL('./fixtures/cues.mkv', import.meta.url))

function readerOf(bytes: Uint8Array) {
  const ranges: [number, number][] = []
  const read = async (start: number, end: number) => {
    ranges.push([start, end])
    return bytes.subarray(start, Math.min(end, bytes.length))
  }

  return { read, ranges }
}

describe('readCueTimes', () => {
  it('отдаёт ключевые кадры видео из индекса', async () => {
    // Те же ключевые кадры показывает ffprobe по пакетам файла
    expect(await readCueTimes(readerOf(fixture).read)).toEqual([
      0,
      2.6,
      5,
      7.6,
      10,
      12.6,
      15,
      17.6,
    ])
  })

  it('читает индекс диапазоном, а не весь файл подряд', async () => {
    const { read, ranges } = readerOf(fixture)

    await readCueTimes(read)

    // Начало файла и адресное чтение `Cues` в конце
    expect(ranges.length).toBeGreaterThanOrEqual(2)
    expect(ranges.slice(1).every(([start]) => start > 1000)).toBe(true)
  })

  it('не MKV — null', async () => {
    expect(
      await readCueTimes(
        readerOf(new TextEncoder().encode('not a matroska file')).read,
      ),
    ).toBeNull()
  })

  it('обрезанный индекс — null, без исключения', async () => {
    const { read } = readerOf(fixture.subarray(0, fixture.length - 40))

    expect(await readCueTimes(read)).toBeNull()
  })
})
