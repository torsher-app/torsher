import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { BodyTooLargeError, readBodyLimited } from './body.ts'

function countingStream(chunks: number, chunkSize: number) {
  const state = { pulls: 0, cancelled: false }
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        state.pulls++

        if (state.pulls > chunks)
          controller.close()
        else controller.enqueue(new Uint8Array(chunkSize).fill(0x61))
      },
      cancel() {
        state.cancelled = true
      },
    },
    { highWaterMark: 0 },
  )

  return { stream, state }
}

describe('readBodyLimited', () => {
  it('refuses a declared length above the limit without reading', async () => {
    const { stream, state } = countingStream(20, 10)
    const res = new Response(stream, { headers: { 'content-length': '200' } })

    await expect(readBodyLimited(res, 100)).rejects.toBeInstanceOf(
      BodyTooLargeError,
    )
    expect(state.pulls).toBe(0)
  })

  it('stops reading a stream once it grows past the limit', async () => {
    const { stream, state } = countingStream(20, 10)

    await expect(
      readBodyLimited(new Response(stream), 55),
    ).rejects.toBeInstanceOf(BodyTooLargeError)
    expect(state.pulls).toBeLessThan(20)
    expect(state.cancelled).toBe(true)
  })

  it('returns the whole body within the limit', async () => {
    const { stream } = countingStream(5, 10)
    const bytes = await readBodyLimited(new Response(stream), 50)

    expect(Buffer.isBuffer(bytes)).toBe(true)
    expect(bytes.toString()).toBe('a'.repeat(50))
  })

  it('returns an empty buffer for a response without body', async () => {
    const bytes = await readBodyLimited(new Response(null), 10)

    expect(bytes.byteLength).toBe(0)
  })
})
