<script setup lang="ts">
import type { ChartData, ChartOptions, Plugin } from 'chart.js'
import type { OverviewResponse } from '@torsher/api-client'
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

type Point = OverviewResponse['load']['history'][number]
type Field = Exclude<keyof Point, 'time'>
interface Curve {
  field: Field
  label: string
  color: string
}
const props = defineProps<{
  history: Point[]
  minutes: number
  end: number
  step: number
  title: string
  curves: readonly Curve[]
  format: (n: number) => string
  unit?: string
  floor: number
}>()
const canvas = ref<HTMLCanvasElement>()
const { t, locale } = useI18n()
const theme = useColorMode()
const end = computed(() => props.end)
const start = computed(() => end.value - props.minutes * 60_000)
const rows = computed(() => props.history.filter(p => p.time >= start.value))
const hasData = computed(() =>
  rows.value.some(p => props.curves.some(curve => p[curve.field] != null)),
)
interface XY {
  x: number
  y: number | null
}
let chart: Chart<'line', XY[]> | undefined
const cursor: Plugin<'line'> = {
  id: 'loadCursor',
  afterDatasetsDraw(chart) {
    const item = chart.tooltip?.getActiveElements()[0]
    if (!item || !chart.tooltip?.opacity)
      return
    const { ctx, chartArea } = chart
    ctx.save()
    ctx.strokeStyle = chart.options.color as string
    ctx.setLineDash([3, 4])
    ctx.beginPath()
    ctx.moveTo(item.element.x, chartArea.top)
    ctx.lineTo(item.element.x, chartArea.bottom)
    ctx.stroke()
    ctx.restore()
  },
}

function draw() {
  if (!canvas.value || !hasData.value) {
    chart?.destroy()
    chart = undefined
    return
  }
  const css = getComputedStyle(canvas.value)
  const color = (token: string) => css.getPropertyValue(token).trim()
  const formatTime = (ms: number) =>
    props.minutes > 1440
      ? new Date(ms).toLocaleDateString(locale.value.replace('_', '-'), {
          month: 'short',
          day: 'numeric',
        })
      : new Date(ms).toLocaleTimeString(locale.value.replace('_', '-'), {
          hour: '2-digit',
          minute: '2-digit',
          second: props.minutes === 1 ? '2-digit' : undefined,
          hourCycle: 'h23',
        })
  const data: ChartData<'line', XY[]> = {
    datasets: props.curves.map((curve, index) => {
      const stroke = color(curve.color)
      const points: XY[] = []
      for (const row of rows.value) {
        const last = points.at(-1)
        if (last && row.time - last.x > props.step * 1.9)
          points.push({ x: last.x + props.step, y: null })
        points.push({ x: row.time, y: row[curve.field] ?? null })
      }
      return {
        label: curve.label,
        data: points,
        borderColor: stroke,
        borderWidth: 2,
        borderDash: index ? [4, 3] : [],
        backgroundColor: `color-mix(in srgb, ${stroke} 12%, transparent)`,
        fill: index === 0,
        pointRadius: ctx =>
          points[ctx.dataIndex - 1]?.y == null
          && points[ctx.dataIndex + 1]?.y == null
            ? 2
            : 0,
        pointHoverRadius: 3,
        pointBackgroundColor: stroke,
        spanGaps: false,
        tension: 0,
      }
    }),
  }
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    animation: false,
    parsing: false,
    normalized: true,
    color: color('--muted-foreground'),
    layout: { padding: { top: 5 } },
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'linear',
        min: start.value,
        max: end.value,
        border: { display: false },
        grid: { display: false },
        ticks: {
          maxTicksLimit: 3,
          maxRotation: 0,
          font: { size: 10 },
          color: color('--muted-foreground'),
          callback: value => formatTime(Number(value)),
        },
      },
      y: {
        min: 0,
        suggestedMax: props.floor,
        position: 'right',
        afterFit: (axis) => {
          axis.width = 57
        },
        border: { display: false },
        grid: { color: color('--border'), drawTicks: false },
        ticks: {
          maxTicksLimit: 3,
          padding: 4,
          font: { size: 10 },
          color: color('--muted-foreground'),
          callback: value => props.format(Number(value)),
        },
      },
    },
    plugins: {
      tooltip: {
        displayColors: false,
        callbacks: {
          title: items =>
            items[0]
              ? new Date(items[0].parsed.x!).toLocaleString(
                  locale.value.replace('_', '-'),
                  {
                    dateStyle: 'short',
                    timeStyle: props.minutes === 1 ? 'medium' : 'short',
                  },
                )
              : '',
          label: item =>
            `${item.dataset.label}: ${item.parsed.y === null ? '—' : [props.format(item.parsed.y), props.unit].filter(Boolean).join(' ')}`,
        },
      },
    },
  }
  if (!chart) {
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
      data,
      options,
      plugins: [cursor],
    })
  }
  else {
    chart.data = data
    chart.options = options
    chart.update('none')
  }
}

watch([rows, () => props.curves, () => theme.value, locale, canvas], draw, {
  flush: 'post',
})
onBeforeUnmount(() => chart?.destroy())
</script>

<template>
  <div class="relative h-28 min-w-0">
    <canvas v-if="hasData" ref="canvas" role="img" :aria-label="title" />
    <div
      v-else
      class="flex h-full items-center justify-center text-xs text-muted-foreground"
    >
      {{ t("panel.overview.load.noSamples") }}
    </div>
  </div>
</template>
