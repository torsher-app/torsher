import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readCueTimes, readSubtitleIndex } from './matroska.ts'

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

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

describe.runIf(hasFfmpeg())('indexed subtitle seeking', () => {
  let dir: string
  let bytes: Uint8Array
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'torsher-subtitle-seek-'))
    await writeFile(
      join(dir, 'long.srt'),
      '1\n00:00:00,000 --> 00:00:40,000\nLong overlapping cue\n\n',
    )
    execFileSync('ffmpeg', [
      '-v',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x180:rate=15',
      '-i',
      join(dir, 'long.srt'),
      '-t',
      '40',
      '-map',
      '0:v',
      '-map',
      '1:s',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-g',
      '30',
      '-c:s',
      'srt',
      join(dir, 'video.mkv'),
    ])
    bytes = await readFile(join(dir, 'video.mkv'))
  })
  afterAll(async () => {
    if (dir)
      await rm(dir, { recursive: true, force: true })
  })
  it('recovers a cue begun before a cold seek using only indexed ranges', async () => {
    const { read, ranges } = readerOf(bytes)
    const lookup = await readSubtitleIndex(read)
    expect(lookup).not.toBeNull()
    expect(await lookup!(1, 25)).toEqual([
      { start: 0, end: 40, text: 'Long overlapping cue' },
    ])
    expect(await lookup!(0, 25)).toEqual([])
    expect(await lookup!(1, 40)).toEqual([])
    const calls = ranges.length
    expect(await lookup!(1, 30)).toHaveLength(1)
    expect(ranges).toHaveLength(calls)
    expect(
      ranges.reduce((sum, [start, end]) => sum + end - start, 0),
    ).toBeLessThan(bytes.length)
    expect(
      ranges.every(([start, end]) => start >= 0 && end - start <= 256 * 1024),
    ).toBe(true)
  })
  it('does not invent cues without a readable index', async () => {
    expect(await readSubtitleIndex(readerOf(new Uint8Array()).read)).toBeNull()
    expect(
      await readSubtitleIndex(readerOf(bytes.subarray(0, 128)).read),
    ).toBeNull()
  })
})
