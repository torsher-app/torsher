import type { SpeedtestSample } from '@torsher/api-client'
import type { ScriptableContext } from 'chart.js'

export interface SpeedtestPoint {
  x: number
  y: number
}
export type SpeedtestCurves = Record<'download' | 'upload', SpeedtestPoint[]>
export interface SpeedtestFrame {
  download: number | null
  upload: number | null
}

/** Visual interpolation only; these points never enter the measurement statistics. */
function interpolateTrace(samples: SpeedtestSample[]) {
  const points: SpeedtestPoint[] = []
  samples.forEach((sample, index) => {
    const y = (sample.bytesPerSecond * 8) / 1_000_000
    if (index === 0) {
      if (sample.seconds <= 0) {
        points.push({ x: sample.seconds, y })
        return
      }
      points.push({ x: 0, y: 0 })
    }
    const previous = samples[index - 1] ?? { seconds: 0, bytesPerSecond: 0 }
    const startY = (previous.bytesPerSecond * 8) / 1_000_000
    const steps = Math.max(
      1,
      Math.ceil((sample.seconds - previous.seconds) * 60),
    )
    for (let step = 1; step <= steps; step++) {
      const fraction = step / steps
      points.push({
        x: previous.seconds + (sample.seconds - previous.seconds) * fraction,
        y: startY + (y - startY) * fraction,
      })
    }
  })
  return points
}

export interface SpeedtestMotion {
  initialized: boolean
  transitionEnd: number
  added: Record<'download' | 'upload', number>
  reduced: boolean
}

/** Animate only the appended tail, except during an explicit scale expansion. */
export function speedtestAnimations(
  motion: SpeedtestMotion,
  phases: readonly ('download' | 'upload')[],
  now = () => performance.now(),
) {
  const isNew = (ctx: ScriptableContext<'line'>) =>
    ctx.type === 'data'
    && ctx.dataIndex >= motion.added[phases[ctx.datasetIndex]!]
  const timing = (ctx: ScriptableContext<'line'>) => {
    const points = ctx.dataset.data as SpeedtestPoint[]
    const origin
      = points[Math.max(0, motion.added[phases[ctx.datasetIndex]!] - 1)]!.x
    const total = points.at(-1)!.x - origin
    const previous = points[ctx.dataIndex - 1]!.x
    const span = Math.min(500, Math.max(100, total * 1000))
    return total > 0
      ? {
          duration: ((points[ctx.dataIndex]!.x - previous) / total) * span,
          delay: ((previous - origin) / total) * span,
        }
      : { duration: 0, delay: 0 }
  }
  const duration = (ctx: ScriptableContext<'line'>) => {
    if (
      !motion.initialized
      || motion.reduced
      || (isNew(ctx) && ctx.dataIndex === 0)
    ) {
      return 0
    }
    if (isNew(ctx))
      return timing(ctx).duration
    const remaining = motion.transitionEnd - now()
    return Math.max(0, remaining)
  }
  const delay = (ctx: ScriptableContext<'line'>) =>
    motion.initialized && !motion.reduced && isNew(ctx) && ctx.dataIndex > 0
      ? timing(ctx).delay
      : 0
  const previousY = (ctx: ScriptableContext<'line'>) => {
    if (!motion.initialized || !isNew(ctx) || ctx.dataIndex === 0)
      return undefined
    return ctx.chart
      .getDatasetMeta(ctx.datasetIndex)
      .data[ctx.dataIndex - 1]
      ?.getProps(['y'], true)
      .y
  }
  return {
    x: {
      type: 'number' as const,
      easing: 'linear' as const,
      duration,
      delay,
      from: (ctx: ScriptableContext<'line'>) =>
        motion.initialized && isNew(ctx) && ctx.dataIndex > 0
          ? Number.NaN
          : undefined,
    },
    y: {
      type: 'number' as const,
      easing: 'linear' as const,
      duration,
      delay,
      from: previousY,
    },
  }
}
/** Mutate retained points; each snapshot extends the same measured prefix. */
export function mergeSpeedtestSamples(
  curves: SpeedtestCurves,
  samples: SpeedtestSample[],
) {
  const added = {
    download: curves.download.length,
    upload: curves.upload.length,
  }
  let changed = false
  for (const phase of ['download', 'upload'] as const) {
    const incoming = interpolateTrace(
      samples.filter(sample => sample.phase === phase),
    )
    const points = curves[phase]
    if (incoming.length < points.length) {
      points.length = 0
      added[phase] = 0
      changed = true
    }
    incoming.forEach(({ x, y }, index) => {
      const point = points[index]
      if (!point) {
        points.push({ x, y })
        changed = true
      }
      else if (point.x !== x || point.y !== y) {
        point.x = x
        point.y = y
        changed = true
      }
    })
  }
  return { added, changed }
}
export function speedtestCeiling(peak: number) {
  if (peak <= 300)
    return 300
  const scale = 10 ** Math.max(2, Math.floor(Math.log10(peak)))
  return ([1, 2, 5, 10].find(step => step * scale >= peak) ?? 10) * scale
}

/** Never resize for a peak inside the chosen range, or shrink at phase/end boundaries. */
export function nextSpeedtestCeiling(
  current: number,
  samples: SpeedtestSample[],
) {
  if (!samples.length)
    return 300
  const peak = Math.max(
    ...samples.map(sample => (sample.bytesPerSecond * 8) / 1_000_000),
  )
  return peak > current ? speedtestCeiling(peak) : current
}

export function displayedInternetSpeed(
  state: string,
  activePhase: string | undefined,
  phase: 'download' | 'upload',
  measured: number | null | undefined,
  rendered: number | null,
  animating: boolean,
) {
  if (state === 'complete')
    return animating ? rendered : (measured ?? null)
  if (state !== 'running')
    return measured ?? null
  if (phase === 'download' && activePhase === 'upload')
    return measured ?? null
  return activePhase === phase ? rendered : null
}
