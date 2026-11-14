import { describe, expect, it } from 'vitest'
import {
  displayedInternetSpeed,
  mergeSpeedtestSamples,
  nextSpeedtestCeiling,
  speedtestCeiling,
} from './speedtestChart'
import type { SpeedtestCurves } from './speedtestChart'

function sample(
  seconds: number,
  speed = 10_000_000,
  phase: 'download' | 'upload' = 'download',
) {
  return { seconds, bytesPerSecond: speed, phase }
}
describe('retained speed chart history', () => {
  it('preserves dataset arrays, prefix point identities and coordinates across snapshots', () => {
    const curves: SpeedtestCurves = { download: [], upload: [] }
    const datasets = [{ data: curves.download }, { data: curves.upload }]
    const download = datasets[0]!
    mergeSpeedtestSamples(curves, [sample(0.1), sample(0.2)])
    const points = curves.download.slice()
    const coordinates = points.map(point => ({ ...point }))
    const merged = mergeSpeedtestSamples(curves, [
      sample(0.1),
      sample(0.2),
      sample(0.3),
      sample(0.1, 5_000_000, 'upload'),
    ])
    expect(datasets[0]).toBe(download)
    expect(download.data).toBe(curves.download)
    expect(curves.download[0]).toBe(points[0])
    expect(curves.download[1]).toBe(points[1])
    expect(curves.download.slice(0, points.length)).toEqual(coordinates)
    expect(merged.added).toEqual({ download: points.length, upload: 0 })
    expect(curves.upload.at(-1)?.x).toBe(0.1)
    expect(
      mergeSpeedtestSamples(curves, [
        sample(0.1),
        sample(0.2),
        sample(0.3),
        sample(0.1, 5_000_000, 'upload'),
      ]).changed,
    ).toBe(false)
  })
  it('densifies only the display curve to about 60 points a second with measured endpoints intact', () => {
    const curves: SpeedtestCurves = { download: [], upload: [] }
    const raw = [sample(0.2, 10_000_000), sample(0.4, 20_000_000)]
    mergeSpeedtestSamples(curves, raw)
    expect(raw).toHaveLength(2)
    expect(curves.download.length).toBeGreaterThanOrEqual(13)
    expect(curves.download[0]).toEqual({ x: 0, y: 0 })
    expect(
      curves.download.some(point => point.x === 0.2 && point.y === 80),
    ).toBe(true)
    expect(curves.download.at(-1)).toEqual({ x: 0.4, y: 160 })
    const center = curves.download.reduce((a, b) =>
      Math.abs(a.x - 0.3) < Math.abs(b.x - 0.3) ? a : b,
    )
    expect(center.x).toBeCloseTo(0.3)
    expect(center.y).toBeCloseTo(120)
  })
  it('retains the finished direction and never revives a provisional rate on error or cancel', () => {
    expect(
      displayedInternetSpeed('running', 'upload', 'download', 200, 0, true),
    ).toBe(200)
    expect(
      displayedInternetSpeed('running', 'upload', 'upload', 100, 80, true),
    ).toBe(80)
    expect(
      displayedInternetSpeed('error', 'finished', 'upload', null, 80, true),
    ).toBeNull()
    expect(
      displayedInternetSpeed('cancelled', 'finished', 'upload', null, 80, true),
    ).toBeNull()
    expect(
      displayedInternetSpeed('complete', 'finished', 'upload', 100, 80, true),
    ).toBe(80)
    expect(
      displayedInternetSpeed('complete', 'finished', 'upload', 100, 100, false),
    ).toBe(100)
  })
  it('starts at 300 and stays fixed until the current threshold is exceeded', () => {
    const mbps = (x: number, value: number) =>
      sample(x, (value * 1_000_000) / 8)
    const ramp = [mbps(0.1, 1), mbps(0.2, 8), mbps(0.6, 70)]
    expect(nextSpeedtestCeiling(300, ramp)).toBe(300)
    const higher = [...ramp, mbps(1.8, 299)]
    expect(nextSpeedtestCeiling(300, higher)).toBe(300)
    expect(nextSpeedtestCeiling(300, [...higher, mbps(2, 301)])).toBe(500)
    expect(nextSpeedtestCeiling(500, [mbps(2.4, 499)])).toBe(500)
    expect(nextSpeedtestCeiling(500, [mbps(2.8, 501)])).toBe(1000)
  })
  it('expands only on actual overflow, includes the peak and resets for the next run', () => {
    const ceiling = 300
    const spike = sample(3, 80_000_000, 'upload')
    const expanded = nextSpeedtestCeiling(ceiling, [spike])
    expect(expanded).toBeGreaterThan((spike.bytesPerSecond * 8) / 1_000_000)
    expect(nextSpeedtestCeiling(expanded, [sample(4)])).toBe(expanded)
    expect(nextSpeedtestCeiling(expanded, [])).toBe(300)
  })
  it('uses large steps without clipping fast local measurements', () => {
    for (const peak of [0.009, 0.9, 9, 99, 999, 53_687])
      expect(speedtestCeiling(peak)).toBeGreaterThanOrEqual(peak)
  })
})
