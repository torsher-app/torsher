import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { SpeedtestMotion, SpeedtestPoint } from './speedtestChart'
import { speedtestAnimations } from './speedtestChart'

// Chart.js captures rAF at import. Keep frames under test control, without a DOM.
vi.stubGlobal('window', { requestAnimationFrame: () => 1 })
const {
  Chart,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  BasicPlatform,
} = await import('chart.js')
vi.unstubAllGlobals()
Chart.register(LinearScale, LineController, LineElement, PointElement)
class Platform extends BasicPlatform {
  override updateConfig() {}
}
const charts: InstanceType<typeof Chart>[] = []
beforeEach(() => vi.stubGlobal('window', { requestAnimationFrame: () => 1 }))
afterEach(() => {
  charts.splice(0).forEach(chart => chart.destroy())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function fixture() {
  let context: object
  const canvas = {
    width: 480,
    height: 176,
    style: {},
    getContext: () => context,
  }
  context = new Proxy(
    { canvas, measureText: (v: string) => ({ width: String(v).length * 6 }) },
    {
      get: (target, key) => Reflect.get(target, key) ?? (() => {}),
    },
  )
  let clock = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => clock)
  const motion: SpeedtestMotion = {
    initialized: false,
    transitionEnd: 0,
    added: { download: 0, upload: 0 },
    reduced: false,
  }
  const points = [
    { x: 0.2, y: 10 },
    { x: 0.4, y: 40 },
    { x: 0.6, y: 70 },
  ]
  const upload: SpeedtestPoint[] = []
  const chart = new Chart(canvas as unknown as HTMLCanvasElement, {
    type: 'line',
    platform: Platform,
    data: { datasets: [{ data: points }, { data: upload }] },
    options: {
      responsive: false,
      events: [],
      parsing: false,
      animation: { duration: 0 },
      animations: speedtestAnimations(
        motion,
        ['download', 'upload'],
        () => clock,
      ),
      scales: {
        x: { type: 'linear', min: 0, max: 8 },
        y: {
          min: 0,
          max: 100,
          afterFit: (axis) => {
            axis.width = 52
          },
          ticks: { count: 5 },
        },
      },
    },
  })
  charts.push(chart)
  motion.initialized = true
  chart.stop()
  chart.update('none')
  return {
    chart,
    points,
    upload,
    motion,
    setClock: (value: number) => {
      clock = value
    },
  }
}
// Internal animation fields are inspected only in these pinned Chart.js regressions.
function animations(point: unknown) {
  return (
    point as {
      $animations?: Record<
        string,
        {
          active: () => boolean
          _from: number
          _duration: number
          _start: number
        }
      >
    }
  ).$animations
}
it('creates a populated snapshot without queued history replay', () => {
  const { chart } = fixture()
  for (const point of chart.getDatasetMeta(0).data) {
    expect(animations(point)?.x?.active() ?? false).toBe(false)
    expect(animations(point)?.y?.active() ?? false).toBe(false)
  }
})
it('leaves the rendered prefix at the same pixels when extending inside a fixed range', () => {
  const { chart, points, motion } = fixture()
  const prefix = chart.getDatasetMeta(0).data.map(p => ({ x: p.x, y: p.y }))
  motion.added.download = points.length
  points.push({ x: 0.8, y: 80 })
  chart.update()
  expect(
    chart
      .getDatasetMeta(0)
      .data.slice(0, 3)
      .map(p => ({ x: p.x, y: p.y })),
  ).toEqual(prefix)
  expect(animations(chart.getDatasetMeta(0).data[3])?.y?.active()).toBe(true)
})
it('grows an overflow segment from the existing tail and preserves its 500ms deadline across polls', () => {
  const { chart, points, motion, setClock } = fixture()
  const tail = chart.getDatasetMeta(0).data[2]!
  motion.added.download = points.length
  motion.transitionEnd = 1500
  points.push({ x: 0.8, y: 160 })
  chart.options.scales!.y!.max = 250
  chart.update()
  const appended = animations(chart.getDatasetMeta(0).data[3])!.y!
  expect(appended._from).toBeCloseTo(chart.scales.y!.getPixelForValue(70))
  expect(appended._from).not.toBeCloseTo(chart.scales.y!.getBasePixel())
  expect(appended._duration).toBeLessThanOrEqual(500)
  setClock(1250)
  motion.added.download = points.length
  points.push({ x: 1, y: 150 })
  chart.update()
  expect(animations(tail)!.y!._duration).toBeLessThanOrEqual(250)
  expect(animations(tail)!.y!.active()).toBe(true)
})
it('reveals a batch one point at a time instead of growing all segments simultaneously', () => {
  const { chart, points, motion } = fixture()
  motion.added.download = points.length
  points.push({ x: 0.8, y: 80 }, { x: 1, y: 85 }, { x: 1.2, y: 90 })
  chart.update()
  const batch = chart
    .getDatasetMeta(0)
    .data
    .slice(3)
    .map(point => animations(point)!)
  expect(batch[0]!.x!._from).toBeNaN()
  expect(batch[1]!.x!._from).toBeNaN()
  expect(batch[1]!.y!._start).toBeGreaterThanOrEqual(
    batch[0]!.y!._start + batch[0]!.y!._duration,
  )
  expect(batch[2]!.y!._start).toBeGreaterThanOrEqual(
    batch[1]!.y!._start + batch[1]!.y!._duration,
  )
  expect(batch[2]!.y!._start + batch[2]!.y!._duration).toBeLessThanOrEqual(
    1500,
  )
})
it('places the first upload point at its measurement instead of animating from zero', () => {
  const { chart, upload, motion } = fixture()
  motion.added = { download: 3, upload: 0 }
  motion.transitionEnd = 1500
  upload.push({ x: 0.4, y: 160 })
  chart.options.scales!.y!.max = 250
  chart.update()
  const first = chart.getDatasetMeta(1).data[0]!
  expect(animations(first)?.y?.active() ?? false).toBe(false)
  expect(first.y).toBeCloseTo(chart.scales.y!.getPixelForValue(160))
})
it('disables queued motion for a theme resync and for reduced motion', () => {
  const { chart, points, motion } = fixture()
  motion.added.download = points.length
  points.push({ x: 0.8, y: 80 })
  chart.update()
  chart.stop()
  chart.update('none')
  expect(
    animations(chart.getDatasetMeta(0).data[3])?.y?.active() ?? false,
  ).toBe(false)
  motion.reduced = true
  motion.added.download = points.length
  points.push({ x: 1, y: 90 })
  chart.update()
  expect(
    animations(chart.getDatasetMeta(0).data[4])?.y?.active() ?? false,
  ).toBe(false)
})
