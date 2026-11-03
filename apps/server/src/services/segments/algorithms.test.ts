import { describe, expect, it } from 'vitest'
import { classify, textRuns } from './credits.ts'
import { consensus, match } from './match.ts'
import { FINGERPRINT_STEP } from './model.ts'

function noise(seed: number, length: number) {
  return Array.from({ length }, () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed >>> 0
  })
}

describe('independent intro matching', () => {
  it('finds only a consistent three-episode core, with conservative boundaries', () => {
    const shared = noise(17, 400)
    const a = [...noise(1, 200), ...shared, ...noise(2, 200)]
    const b = [...noise(3, 300), ...shared, ...noise(4, 100)]
    const c = [...noise(5, 100), ...shared, ...noise(6, 300)]
    const result = consensus(match(a, b), match(a, c), match(b, c))
    expect(Array.isArray(result)).toBe(true)
    const core = result as number[]
    expect(core[0]).toBeGreaterThan(200 * FINGERPRINT_STEP)
    expect(core[1]).toBeLessThan(600 * FINGERPRINT_STEP)
    expect(consensus(match(a, b), [], [])).toBeNull()
  })
  it('rejects silence, short logos and unrelated audio', () => {
    expect(
      match(
        Array.from<number>({ length: 800 }).fill(42),
        Array.from<number>({ length: 800 }).fill(42),
      ),
    ).toEqual([])
    expect(match(noise(1, 800), noise(7, 800))).toEqual([])
    expect(match(noise(1, 60), noise(1, 60))).toEqual([])
  })
  it('rejects mutually inconsistent offsets and multiple plausible intros', () => {
    const run = (start: number, lag: number) => ({
      a: [start, start + 40],
      b: [start + lag * FINGERPRINT_STEP, start + 40 + lag * FINGERPRINT_STEP],
      lag,
      seconds: 40,
      density: 1,
      distance: 0,
    })
    expect(consensus([run(10, 0)], [run(10, 0)], [run(10, 5)])).toBeNull()
    expect(
      consensus(
        [run(10, 0), run(100, 0)],
        [run(10, 0), run(100, 0)],
        [run(10, 0), run(100, 0)],
      ),
    ).toBe('ambiguous')
  })
})

function frame(rows: number, background = 0) {
  const pixels = new Uint8Array(320 * 180).fill(background)
  for (let row = 0; row < rows; row++) {
    for (let glyph = 0; glyph < 15; glyph++) {
      for (let y = 0; y < 5; y++) {
        for (let x = 0; x < 3; x++)
          pixels[(30 + row * 18 + y) * 320 + 60 + glyph * 10 + x] = 220
      }
    }
  }
  return pixels
}

describe('narrow visual credits', () => {
  it('accepts light glyph rows on dark and rejects subtitles / image backgrounds / black', () => {
    expect(classify(frame(5)).text).toBe(true)
    expect(classify(frame(2)).text).toBe(false)
    expect(classify(frame(5, 80)).text).toBe(false)
    expect(classify(new Uint8Array(320 * 180)).text).toBe(false)
    expect(classify(new Uint8Array(320 * 180).fill(255)).text).toBe(false)
  })
  it('splits on even one ambiguous frame and never bridges a post-credit scene', () => {
    const frames = [
      ...Array.from<boolean>({ length: 161 }).fill(true),
      false,
      ...Array.from<boolean>({ length: 161 }).fill(true),
    ]
    expect(textRuns(frames, 8)).toEqual([
      { start: 0, end: 20 },
      { start: 20.25, end: 40.25 },
    ])
    expect(textRuns([true, true, false, true], 1)).toEqual([])
  })
})
