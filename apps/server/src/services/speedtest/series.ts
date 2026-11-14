/** Linear interpolated p90 of complete finite, positive HTTP samples. */
export function p90(values: number[]) {
  const sorted = values
    .filter(value => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b)
  if (sorted.length < 3)
    return null
  const index = (sorted.length - 1) * 0.9
  const lower = Math.floor(index)
  return (
    sorted[lower]!
    + (sorted[Math.ceil(index)]! - sorted[lower]!) * (index - lower)
  )
}
export function createSeries(
  maxBytes: number,
  latencyMs: number,
  targetMs = 400,
) {
  let size = 16 * 1024
  const speeds: number[] = []
  return {
    get size() {
      return size
    },
    get value() {
      return p90(speeds)
    },
    observe(bytes: number, durationMs: number) {
      const speed = (bytes * 1000) / durationMs
      const valid
        = bytes > 0 && durationMs >= 10 && Number.isFinite(speed) && speed > 0
      if (valid)
        speeds.push(speed)
      // RTT is used only to choose the next payload size, never to adjust a measured speed.
      const payloadMs = Math.max(1, durationMs - latencyMs)
      const planned
        = payloadMs >= targetMs * 0.8 && payloadMs <= targetMs * 1.25
          ? bytes
          : Math.round((bytes * targetMs) / payloadMs)
      const next = Math.min(maxBytes, bytes * 8, Math.max(16 * 1024, planned))
      size = next
      return { valid, speed }
    },
  }
}
