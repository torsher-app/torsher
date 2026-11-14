<script setup lang="ts">
import type { SpeedtestSample } from '@torsher/api-client'
import { usePreferredReducedMotion } from '@vueuse/core'
import {
  Chart,
  Filler,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js'
import { useI18n } from 'vue-i18n'
import type {
  SpeedtestCurves,
  SpeedtestFrame,
  SpeedtestMotion,
  SpeedtestPoint,
} from '~/lib/speedtestChart'
import {
  mergeSpeedtestSamples,
  nextSpeedtestCeiling,
  speedtestAnimations,
} from '~/lib/speedtestChart'

const props = defineProps<{
  samples: SpeedtestSample[]
  running?: boolean
  internet?: boolean
}>()
const emit = defineEmits<{
  frame: [frame: SpeedtestFrame]
  drawing: [active: boolean]
}>()
const { t, locale } = useI18n()
const canvas = ref<HTMLCanvasElement>()
const theme = useColorMode()
const reducedMotion = usePreferredReducedMotion()
const ceiling = ref(300)
const curves: SpeedtestCurves = { download: [], upload: [] }
const phases = props.internet
  ? (['download', 'upload'] as const)
  : (['download'] as const)
const datasets = phases.map(phase => ({
  label: '',
  data: curves[phase],
  borderColor: '',
  backgroundColor: '',
  borderDash: phase === 'upload' ? [5, 4] : [],
  borderWidth: 2,
  borderCapStyle: 'round' as const,
  borderJoinStyle: 'round' as const,
  fill: phase === 'download',
  pointRadius: 0,
  pointHitRadius: 12,
  pointHoverRadius: 3,
  pointBackgroundColor: '',
  // New samples must not change the control points of the measured prefix.
  tension: 0,
}))
let chart: Chart<'line', SpeedtestPoint[]> | undefined
const motion: SpeedtestMotion = {
  initialized: false,
  transitionEnd: 0,
  added: { download: 0, upload: 0 },
  get reduced() {
    return reducedMotion.value === 'reduce'
  },
}
let drawing = false
let pending = false
let lastValueAt = Number.NEGATIVE_INFINITY
function emitFrame(force = false) {
  if (!chart)
    return
  const now = performance.now()
  if (!force && now - lastValueAt < 300)
    return
  lastValueAt = now
  const frame: SpeedtestFrame = { download: null, upload: null }
  phases.forEach((phase, datasetIndex) => {
    const rendered = chart!.getDatasetMeta(datasetIndex).data
    for (let index = rendered.length - 1; index >= 0; index--) {
      if (
        Number.isFinite(rendered[index]!.x)
        && Number.isFinite(rendered[index]!.y)
      ) {
        frame[phase] = (curves[phase][index]!.y * 1_000_000) / 8
        break
      }
    }
  })
  emit('frame', frame)
}
function dispose() {
  pending = false
  drawing = false
  emit('drawing', false)
  chart?.destroy()
  chart = undefined
  motion.initialized = false
  motion.transitionEnd = 0
  lastValueAt = Number.NEGATIVE_INFINITY
}
function draw(restyle = false) {
  if (!canvas.value)
    return
  if (chart && drawing && !restyle) {
    pending = true
    return
  }
  pending = false
  const merged = mergeSpeedtestSamples(curves, props.samples)
  motion.added = merged.added
  const css = getComputedStyle(canvas.value)
  const color = (token: string) => css.getPropertyValue(token).trim()
  const muted = color('--muted-foreground')
  const font = css.fontFamily
  datasets.forEach((dataset, index) => {
    const stroke = color(index ? '--chart-2' : '--chart-1')
    dataset.label = t(`speedtest.${phases[index]}`)
    dataset.borderColor = stroke
    dataset.pointBackgroundColor = stroke
    dataset.backgroundColor = `color-mix(in srgb, ${stroke} 8%, transparent)`
  })
  if (chart) {
    const resized = chart.options.scales!.y!.max !== ceiling.value
    if (resized)
      motion.transitionEnd = performance.now() + 500
    chart.options.scales!.y!.max = ceiling.value
    if (restyle) {
      chart.options.color = muted
      chart.options.scales!.x!.ticks!.color = muted
      chart.options.scales!.y!.ticks!.color = muted
      chart.options.scales!.y!.grid!.color = color('--border')
    }
    if (merged.changed || restyle || resized) {
      if (restyle) {
        chart.stop()
        chart.update('none')
      }
      else {
        drawing = true
        emit('drawing', true)
        chart.update()
      }
    }
    return
  }
  Chart.register(
    LineController,
    LineElement,
    PointElement,
    LinearScale,
    Tooltip,
    Filler,
  )
  chart = new Chart(canvas.value, {
    type: 'line',
    data: { datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      color: muted,
      font: { family: font },
      layout: { padding: { top: 6, left: 1 } },
      interaction: { mode: 'nearest', axis: 'x', intersect: false },
      animation: {
        duration: 0,
        onProgress: () => emitFrame(false),
        onComplete: () => {
          drawing = false
          emit('drawing', false)
          if (pending)
            draw()
          emitFrame(!props.running && !drawing && !pending)
        },
      },
      animations: speedtestAnimations(motion, phases),
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: true,
          callbacks: {
            title: items =>
              `${Math.round((items[0]?.parsed.x ?? 0) * 1000).toLocaleString(locale.value.replace('_', '-'), { useGrouping: false })} ${t('speedtest.ms')}`,
            label: item =>
              `${item.dataset.label}: ${item.parsed.y?.toLocaleString(locale.value.replace('_', '-'), { maximumFractionDigits: 0, useGrouping: false })} ${t('speedtest.mbps')}`,
          },
        },
      },
      scales: {
        x: {
          type: 'linear',
          min: 0,
          max: 10,
          border: { display: false },
          ticks: {
            count: 6,
            maxRotation: 0,
            color: muted,
            font: { family: font, size: 10 },
            callback: value =>
              `${Number(value).toLocaleString(locale.value.replace('_', '-'), { maximumFractionDigits: 0 })} ${t('speedtest.seconds')}`,
          },
          grid: { display: false },
        },
        y: {
          min: 0,
          max: ceiling.value,
          position: 'right',
          afterFit: (axis) => {
            axis.width = 52
          },
          border: { display: false },
          ticks: {
            count: 5,
            padding: 8,
            color: muted,
            font: { family: font, size: 10 },
            callback: value =>
              Number(value).toLocaleString(locale.value.replace('_', '-'), {
                maximumFractionDigits: 0,
                useGrouping: false,
              }),
          },
          grid: { color: color('--border'), drawTicks: false },
        },
      },
    },
  })
  motion.initialized = true
  chart.stop()
  chart.update('none')
}
watch(canvas, () => draw(), { flush: 'post' })
watch([() => theme.value, locale], () => draw(true), { flush: 'post' })
watch(
  [() => props.samples, () => props.running],
  () => {
    if (!props.samples.length) {
      if (curves.download.length || curves.upload.length)
        dispose()
      ceiling.value = 300
      curves.download.length = 0
      curves.upload.length = 0
      draw()
      return
    }
    ceiling.value = nextSpeedtestCeiling(ceiling.value, props.samples)
    draw()
  },
  { flush: 'post', immediate: true },
)
onBeforeUnmount(dispose)
</script>

<template>
  <div class="min-w-0 space-y-2">
    <div
      class="flex items-center justify-between gap-3 text-xs text-muted-foreground"
    >
      <div class="flex items-center gap-4">
        <span
          v-for="(phase, index) in phases"
          :key="phase"
          class="inline-flex items-center gap-1.5"
        >
          <span
            aria-hidden="true"
            class="w-3 border-t-2"
            :class="index ? 'border-chart-2 border-dashed' : 'border-chart-1'"
          />
          {{ t(`speedtest.${phase}`) }}
        </span>
      </div>
      <span>{{ t("speedtest.mbps") }}</span>
    </div>
    <div class="relative h-44 min-w-0">
      <canvas ref="canvas" role="img" :aria-label="t('speedtest.chart')" />
    </div>
  </div>
</template>
