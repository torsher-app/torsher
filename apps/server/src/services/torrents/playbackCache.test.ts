import { describe, expect, it } from 'vitest'
import {
  bufferedAheadBytes,
  playbackCacheAt,
  verifiedBufferedAheadBytes,
  verifiedFileOffsets,
} from './playback.ts'

const index = [
  { offset: 100, minTime: 0, maxTime: 0 },
  { offset: 700, minTime: 20, maxTime: 22 },
  { offset: 800, minTime: 30, maxTime: 30 },
  { offset: 900, minTime: 80, maxTime: 80 },
]
const base = {
  pieces: '0000000110',
  pieceLength: 100,
  fileOffset: 0,
  fileOffsets: [0],
  fileSize: 1000,
}

describe('indexed playback cache', () => {
  it('finds the VBR cluster instead of an unrelated linear byte hole', () => {
    const time = 25
    expect(bufferedAheadBytes({ ...base, position: (time / 100) * 1000 })).toBe(
      0,
    )
    expect(playbackCacheAt(base, time, 100, index)).toEqual({
      sampledAtSeconds: 25,
      anchorOffset: 700,
      contiguousEndOffset: 900,
      bufferedUntilSeconds: 30,
      verifiedToEnd: false,
    })
  })
  it('never uses a cue inside an incomplete cluster as the cached end', () => {
    expect(
      playbackCacheAt({ ...base, pieces: '0000000100' }, 25, 100, index),
    ).toMatchObject({ contiguousEndOffset: 800, bufferedUntilSeconds: 22 })
    expect(
      playbackCacheAt({ ...base, pieces: '0000000000' }, 25, 100, index),
    ).toMatchObject({ contiguousEndOffset: 700, bufferedUntilSeconds: null })
  })
  it('handles a multifile offset and clips verified coverage at this file EOF', () => {
    const shifted = {
      ...base,
      fileOffset: 50,
      fileOffsets: [50],
      pieces: '00000001111',
    }
    expect(playbackCacheAt(shifted, 85, 100, index)).toMatchObject({
      anchorOffset: 900,
      contiguousEndOffset: 1000,
      bufferedUntilSeconds: 100,
      verifiedToEnd: true,
    })
  })
  it('keeps positions outside the cue times unknown without a verified tail', () => {
    expect(playbackCacheAt(base, 81, 100, index)).toBeNull()
    expect(playbackCacheAt(base, 1, 100, index.slice(1))).toBeNull()
    expect(playbackCacheAt(base, 25, 100, null)).toBeNull()
  })
  it('proves full-file coverage from the bitmap even without an index or duration', () => {
    expect(
      playbackCacheAt({ ...base, pieces: '1111111111' }, 50, 100, null),
    ).toMatchObject({
      anchorOffset: 0,
      contiguousEndOffset: 1000,
      bufferedUntilSeconds: 100,
      verifiedToEnd: true,
    })
    expect(
      playbackCacheAt({ ...base, pieces: '1111111111' }, 50, null, null),
    ).toMatchObject({ bufferedUntilSeconds: null, verifiedToEnd: true })
    expect(
      playbackCacheAt({ ...base, pieces: '1111111110' }, 50, 100, null),
    ).toBeNull()
  })
})

it('rejects partial indexed times incompatible with the probed duration', () => {
  const malformed = [
    { offset: 100, minTime: 0, maxTime: 0 },
    { offset: 700, minTime: 10, maxTime: 10 },
    { offset: 800, minTime: 600, maxTime: 600 },
  ]
  expect(playbackCacheAt(base, 11, 100, malformed)).toBeNull()
  expect(
    playbackCacheAt({ ...base, pieces: '1'.repeat(10) }, 11, 100, malformed),
  ).toMatchObject({ bufferedUntilSeconds: 100, verifiedToEnd: true })
})

it('resolves strict v1 and hybrid file layouts from the bitmap count and requires ambiguous candidates to agree', () => {
  const files = (sizes: number[]) =>
    sizes.map(size => ({ size, path: 'synthetic.mkv', padding: false }))
  const sample = (sizes: number[], pieces: string) => ({
    pieces,
    pieceLength: 100,
    fileSize: sizes[1]!,
    fileOffsets: verifiedFileOffsets(files(sizes), 1, 100, pieces.length),
  })
  expect(sample([120, 120], '111').fileOffsets).toEqual([120])
  expect(sample([50, 50], '10').fileOffsets).toEqual([100])
  expect(verifiedBufferedAheadBytes(sample([50, 50], '10'), 0)).toBe(0)
  expect(playbackCacheAt(sample([50, 50], '10'), 10, 100, null)).toBeNull()
  expect(sample([60, 60], '10').fileOffsets).toEqual([60, 100])
  expect(verifiedBufferedAheadBytes(sample([60, 60], '10'), 0)).toBe(0)
  expect(playbackCacheAt(sample([60, 60], '10'), 10, 100, null)).toBeNull()
  expect(playbackCacheAt(sample([60, 60], '11'), 10, 100, null)).toMatchObject({
    verifiedToEnd: true,
    contiguousEndOffset: 60,
  })
  expect(sample([60, 60], '111').fileOffsets).toEqual([])
  expect(verifiedBufferedAheadBytes(sample([60, 60], '111'), 0)).toBeNull()
})
