import { FINGERPRINT_STEP as step } from './model.ts'

export interface Match {
  a: number[]
  b: number[]
  seconds: number
  density: number
  distance: number
  lag: number
}
function bits(x: number) {
  let n = 0
  for (x >>>= 0; x; x = (x & (x - 1)) >>> 0) n++
  return n
}
function candidates(a: number[], b: number[]) {
  const votes = new Map<number, number>()
  for (const shift of [0, 11, 22]) {
    const mask = shift === 22 ? 1023 : 2047
    const index = new Map<number, number[]>()
    for (let j = 0; j < b.length; j++) {
      const key = (b[j] >>> shift) & mask
      const positions = index.get(key) ?? []
      if (positions.length <= 24)
        positions.push(j)
      index.set(key, positions)
    }
    for (let i = 0; i < a.length; i++) {
      const positions = index.get((a[i] >>> shift) & mask)
      if (!positions || positions.length > 24)
        continue
      for (const j of positions) {
        const lag = j - i
        votes.set(lag, (votes.get(lag) ?? 0) + 1)
      }
    }
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1])
  return ranked.slice(0, 12).map(([lag]) => lag)
}
export function match(a: number[], b: number[]) {
  const found: Match[] = []
  for (const lag of candidates(a, b)) {
    const lo = Math.max(0, -lag)
    const hi = Math.min(a.length, b.length - lag)
    let first = -1
    let last = -1
    let good = 0
    let distance = 0
    function finish() {
      if (first < 0)
        return
      const length = last - first + 1
      const seconds = length * step
      const diversity = new Set(a.slice(first, last + 1)).size
      if (
        seconds >= 15
        && seconds <= 120
        && good / length >= 0.85
        && diversity >= 40
      ) {
        found.push({
          a: [first * step, (last + 1) * step],
          b: [(first + lag) * step, (last + lag + 1) * step],
          seconds,
          density: good / length,
          distance: distance / good,
          lag,
        })
      }
      first = last = -1
      good = distance = 0
    }
    for (let i = lo; i < hi; i++) {
      const d = bits(a[i] ^ b[i + lag])
      if (d <= 5) {
        if (first < 0)
          first = i
        last = i
        good++
        distance += d
      }
      else if (last >= 0 && i - last > 8) {
        finish()
      }
    }
    finish()
  }
  found.sort((a, b) => b.seconds * b.density - a.seconds * a.density)
  const distinct: Match[] = []
  for (const run of found) {
    if (
      !distinct.some(
        x =>
          Math.abs(x.a[0] - run.a[0]) < 3 && Math.abs(x.b[0] - run.b[0]) < 3,
      )
    ) {
      distinct.push(run)
    }
  }
  return distinct.slice(0, 4)
}

/** Require a triangle, not two independent pair votes. Reject competing cores. */
export function consensus(
  ab: Match[],
  ac: Match[],
  bc: Match[],
): number[] | 'ambiguous' | null {
  const cores: number[][] = []
  for (const x of ab) {
    for (const y of ac) {
      for (const z of bc) {
        if (Math.abs(x.lag + z.lag - y.lag) > 2)
          continue
        const start = Math.max(x.a[0], y.a[0], z.a[0] - x.lag * step)
        const end = Math.min(x.a[1], y.a[1], z.a[1] - x.lag * step)
        if (end - start >= 19)
          cores.push([start + 3, end - 1])
      }
    }
  }
  if (!cores.length)
    return null
  const first = cores[0]
  if (
    cores.some(
      core =>
        Math.abs(core[0] - first[0]) > 3 || Math.abs(core[1] - first[1]) > 3,
    )
  ) {
    return 'ambiguous'
  }
  return [
    Math.max(...cores.map(core => core[0])),
    Math.min(...cores.map(core => core[1])),
  ]
}
