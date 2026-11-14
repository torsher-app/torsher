import { describe, expect, it } from 'vitest'
import { readMatroskaCues } from './matroska.ts'

function concat(...parts: Uint8Array[]) {
  return Uint8Array.from(parts.flatMap(part => [...part]))
}
function uint(value: number, length = 4) {
  return Uint8Array.from(
    Array.from(
      { length },
      (_, i) => Math.floor(value / 256 ** (length - i - 1)) % 256,
    ),
  )
}
function element(id: number, data: Uint8Array) {
  const hex = id
    .toString(16)
    .padStart(Math.ceil(id.toString(16).length / 2) * 2, '0')
  const idBytes = Uint8Array.from(
    hex.match(/../g)!.map(byte => Number.parseInt(byte, 16)),
  )
  const size
    = data.length < 127
      ? Uint8Array.of(0x80 | data.length)
      : Uint8Array.of(0x40 | (data.length >> 8), data.length & 255)
  return concat(idBytes, size, data)
}
function fixture(
  points: {
    time: number
    offset: number
    track?: number
    extraTime?: number
  }[],
  video = true,
) {
  const cues = element(
    0x1C53BB6B,
    concat(
      ...points.map(point =>
        element(
          0xBB,
          concat(
            element(0xB3, uint(point.time, point.time > 2 ** 32 ? 8 : 4)),
            ...(point.extraTime === undefined
              ? []
              : [element(0xB3, uint(point.extraTime))]),
            element(
              0xB7,
              concat(
                element(0xF7, uint(point.track ?? 1)),
                element(
                  0xF1,
                  uint(point.offset, point.offset > 2 ** 32 ? 8 : 4),
                ),
              ),
            ),
          ),
        ),
      ),
    ),
  )
  const tracks = element(
    0x1654AE6B,
    element(
      0xAE,
      concat(element(0xD7, uint(1)), element(0x83, uint(video ? 1 : 2))),
    ),
  )
  const seek = (position: number) =>
    element(
      0x114D9B74,
      element(
        0x4DBB,
        concat(
          element(0x53AB, uint(0x1C53BB6B)),
          element(0x53AC, uint(position)),
        ),
      ),
    )
  const cluster = element(0x1F43B675, new Uint8Array(10))
  const position = seek(0).length + tracks.length + cluster.length
  const body = concat(seek(position), tracks, cluster, cues)
  const segment = concat(uint(0x18538067), Uint8Array.of(0xFF))
  const bytes = new Uint8Array(10_000)
  bytes.set(concat(segment, body))
  return {
    bytes,
    segmentData: segment.length,
    cuesOffset: segment.length + position,
  }
}
async function parse(points: Parameters<typeof fixture>[0], video = true) {
  const { bytes } = fixture(points, video)
  return readMatroskaCues(
    async (start, end) => bytes.subarray(start, end),
    bytes.length,
  )
}

describe('strict video cluster index alongside HLS times', () => {
  it('groups cues in the same cluster and collapses identical repeated points', async () => {
    const result = await parse([
      { time: 0, offset: 1000 },
      { time: 1000, offset: 1000 },
      { time: 1000, offset: 1000 },
      { time: 3000, offset: 4000 },
    ])
    expect(result?.times).toEqual([0, 1, 3])
    expect(result?.playbackIndex).toEqual([
      { offset: 1005, minTime: 0, maxTime: 1 },
      { offset: 4005, minTime: 3, maxTime: 3 },
    ])
  })
  it.each([
    [
      { time: 1000, offset: 1000 },
      { time: 0, offset: 4000 },
    ],
    [
      { time: 0, offset: 4000 },
      { time: 1000, offset: 1000 },
    ],
    [
      { time: 0, offset: 1000 },
      { time: 0, offset: 4000 },
    ],
    [{ time: 0, offset: 10_000 }],
    [{ time: Number.MAX_SAFE_INTEGER + 1, offset: 1000 }],
    [{ time: 0, offset: Number.MAX_SAFE_INTEGER + 1 }],
    [{ time: 0, offset: 1000, extraTime: 10 }],
  ])(
    'rejects conflicting, nonmonotonic, out-of-file or unsafe values: %j',
    async (...points) => {
      expect((await parse(points))?.playbackIndex).toBeNull()
    },
  )
  it('never treats an unknown video track as every track; HLS keeps its old times', async () => {
    const result = await parse([{ time: 1000, offset: 1000 }], false)
    expect(result?.times).toEqual([1])
    expect(result?.playbackIndex).toBeNull()
    expect(
      (await parse([{ time: 1000, offset: 1000, track: 2 }]))?.playbackIndex,
    ).toBeNull()
  })
  it('rejects incomplete cue payloads and other formats', async () => {
    const { bytes, cuesOffset } = fixture([{ time: 0, offset: 1000 }])
    // CuePoint claims bytes past Cues, even though the buffer has enough file bytes.
    bytes[cuesOffset + 6] = 0xFF
    expect(
      (
        await readMatroskaCues(
          async (a, b) => bytes.subarray(a, b),
          bytes.length,
        )
      )?.playbackIndex,
    ).toBeNull()
    expect(await readMatroskaCues(async () => new Uint8Array(8), 8)).toBeNull()
  })
})
