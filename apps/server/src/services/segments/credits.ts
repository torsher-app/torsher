const width = 320
const height = 180
const pixels = width * height

// An independent, deliberately narrow visual experiment: small bright glyphs
// on an almost uniformly dark canvas, distributed over several aligned rows.
export function classify(frame: Uint8Array) {
  let dark = 0
  let light = 0
  for (const v of frame) {
    if (v < 45)
      dark++
    if (v > 90)
      light++
  }
  if (dark / pixels < 0.9 || light / pixels < 0.002 || light / pixels > 0.12)
    return { text: false, dark: dark / pixels, light: light / pixels }
  const visited = new Uint8Array(pixels)
  const stack = new Int32Array(pixels)
  const glyphs = []
  let glyphPixels = 0
  for (let n = 0; n < pixels; n++) {
    if (visited[n] || frame[n] <= 90)
      continue
    let top = 0
    let area = 0
    let left = width
    let right = 0
    let first = height
    let last = 0
    stack[top++] = n
    visited[n] = 1
    while (top) {
      const k = stack[--top]
      const y = Math.floor(k / width)
      const x = k % width
      area++
      left = Math.min(left, x)
      right = Math.max(right, x)
      first = Math.min(first, y)
      last = Math.max(last, y)
      for (const neighbor of [
        x ? k - 1 : -1,
        x + 1 < width ? k + 1 : -1,
        y ? k - width : -1,
        y + 1 < height ? k + width : -1,
      ]) {
        if (neighbor >= 0 && !visited[neighbor] && frame[neighbor] > 90) {
          visited[neighbor] = 1
          stack[top++] = neighbor
        }
      }
    }
    const w = right - left + 1
    const h = last - first + 1
    if (
      area >= 2
      && w <= 45
      && h >= 1
      && h <= 14
      && first > 4
      && last < height - 4
    ) {
      glyphs.push({ x: left, y: first, w, h, area })
      glyphPixels += area
    }
  }
  const rows: { y: number, count: number }[] = []
  for (const glyph of glyphs.sort((a, b) => a.y - b.y)) {
    let row = rows.find(r => Math.abs(r.y - glyph.y) <= 1)
    if (!row) {
      row = { y: glyph.y, count: 0 }
      rows.push(row)
    }
    row.count++
  }
  const lines = rows.filter(r => r.count >= 5)
  const spread = lines.length ? lines.at(-1)!.y - lines[0].y : 0
  const text
    = glyphs.length >= 10
      && lines.length >= 3
      && spread >= 16
      && glyphPixels / light >= 0.75
  return {
    text,
    dark: dark / pixels,
    light: light / pixels,
    glyphs: glyphs.length,
    lines: lines.length,
    spread,
    covered: glyphPixels / light,
  }
}

/**
 A single negative frame splits a run
never jump over a scene or a gap.
 */
export function textRuns(frames: boolean[], fps: number, minimum = 15) {
  const runs: { start: number, end: number }[] = []
  let start = -1
  for (let i = 0; i <= frames.length; i++) {
    if (frames[i]) {
      if (start < 0)
        start = i
    }
    else if (start >= 0) {
      // Last positive sample is the boundary, not the next unobserved frame.
      const end = (i - 1) / fps
      if (end - start / fps >= minimum)
        runs.push({ start: start / fps, end })
      start = -1
    }
  }
  return runs
}
