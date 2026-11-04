<script setup lang="ts">
import type { OverviewResponse } from '@torsher/api-client'
import {
  ActivityIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CpuIcon,
  InfoIcon,
  MemoryStickIcon,
  NetworkIcon,
} from '@lucide/vue'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { loadRanges } from '~/lib/loadRanges'
import type { LoadRange } from '~/lib/loadRanges'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Card, CardFooter } from '@/components/ui/card'
import LoadChart from './LoadChart.vue'
import { formatBytes } from '~/lib/format'

const props = defineProps<{ overview: OverviewResponse, fresh: boolean }>()
const { t, locale } = useI18n()
const key = 'panel.overview.load'
const metricClass = 'text-[24px] font-semibold tracking-tight tabular-nums'
const { range, selectRange } = useOverview()
const windows = Object.keys(loadRanges) as LoadRange[]
function label(r: LoadRange) {
  const unit = r.endsWith('m') ? 'minutes' : r.endsWith('h') ? 'hours' : 'days'
  return t(`${key}.${unit}`, { count: Number.parseInt(r, 10) })
}
function select(value: unknown) {
  if (windows.includes(value as LoadRange))
    selectRange(value as LoadRange)
}
const load = computed(() => props.overview.load)
// Keep the curves, axes and legend on the same snapshot until the requested range arrives.
const minutes = computed(() => loadRanges[load.value.historyRange].minutes)
const aggregated = computed(() => load.value.historyStepMs > 5000)
function percent(fraction: number) {
  return fraction.toLocaleString(locale.value.replace('_', '-'), {
    style: 'percent',
    maximumFractionDigits: 1,
  })
}
const bytes = (n: number) => formatBytes(n, locale.value)

function liveRate(bytesPerSecond: number | null) {
  if (bytesPerSecond === null)
    return { number: t(`${key}.unavailable`), unit: '' }
  const units = [
    'bytesPerSecond',
    'kilobytesPerSecond',
    'rateUnit',
    'gigabytesPerSecond',
  ]
  let index = 0
  let n = bytesPerSecond
  while (n >= 1000 && index < units.length - 1) {
    n /= 1000
    index++
  }
  return {
    number:
      bytesPerSecond > 0 && bytesPerSecond < 1
        ? '<1'
        : n.toLocaleString(locale.value.replace('_', '-'), {
            maximumFractionDigits: index && n < 100 ? 1 : 0,
          }),
    unit: t(`${key}.${units[index]}`),
  }
}
const liveRates = computed(() => [
  {
    direction: 'receive',
    icon: ArrowDownIcon,
    color: 'text-info',
    ...liveRate(load.value.receiveBps),
  },
  {
    direction: 'send',
    icon: ArrowUpIcon,
    color: 'text-chart-5',
    ...liveRate(load.value.sendBps),
  },
])

function chartSpeed(bytesPerSecond: number) {
  const mb = bytesPerSecond / 1_000_000
  const tag = locale.value.replace('_', '-')
  if (mb > 0 && mb < 0.0001)
    return `<${(0.0001).toLocaleString(tag, { maximumFractionDigits: 4 })}`
  return mb.toLocaleString(tag, {
    maximumFractionDigits: mb < 0.01 ? 4 : mb < 1 ? 3 : 2,
  })
}
function value(n: number | null, format: (n: number) => string) {
  return n === null ? t(`${key}.unavailable`) : format(n)
}
const curves = computed(
  () =>
    ({
      cpu: [
        {
          field: 'cpuCores',
          label: t(`${key}.${aggregated.value ? 'mean' : 'cpu'}`),
          color: '--brand-text',
        },
        ...(aggregated.value
          ? [
              {
                field: 'cpuPeak' as const,
                label: t(`${key}.peak`),
                color: '--chart-5',
              },
            ]
          : []),
      ],
      memory: [
        { field: 'memoryBytes', label: t(`${key}.memory`), color: '--chart-2' },
      ],
      network: [
        { field: 'receiveBps', label: t(`${key}.receive`), color: '--info' },
        { field: 'sendBps', label: t(`${key}.send`), color: '--chart-5' },
      ],
    }) as const,
)

const availableCores = computed(() => {
  const capacity = load.value.cpuCapacity
  if (capacity === null)
    return t(`${key}.unknownCoreLimit`)
  const args = {
    count: capacity.toLocaleString(locale.value.replace('_', '-')),
  }
  return Number.isInteger(capacity)
    ? t(`${key}.availableCores`, args, capacity)
    : t(`${key}.fractionalCores`, args)
})

const activity = computed(() => {
  const { analysis, thumbnails } = props.overview.load
  const lines: string[] = []
  if (analysis) {
    lines.push(
      `${t(`${key}.${analysis.stage}`)} · ${t(`${key}.progress`, { checked: analysis.checked, total: analysis.total })}`,
    )
  }
  if (thumbnails) {
    lines.push(
      `${t(`${key}.thumbnails`)} · ${t(`${key}.progress`, thumbnails)}`,
    )
  }
  if (
    props.overview.downloads.downloadSpeed > 0
    || props.overview.downloads.uploadSpeed > 0
  ) {
    lines.push(t(`${key}.transfer`))
  }
  if (props.overview.load.playbackActive)
    lines.push(t(`${key}.watching`))
  return lines.join(' · ')
})
</script>

<template>
  <Card class="@container gap-0 py-0">
    <header
      class="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3.5 sm:px-5"
    >
      <h2 class="flex items-center gap-2 font-semibold">
        <ActivityIcon class="size-4 text-brand-text" aria-hidden="true" />
        {{ t(`${key}.title`) }}
      </h2>
      <div
        role="group"
        :aria-label="t(`${key}.range`)"
        class="hidden items-center rounded-lg bg-muted p-0.5 @2xl:flex"
      >
        <button
          v-for="m in windows"
          :key="m"
          type="button"
          :aria-pressed="range === m"
          class="rounded-md px-2.5 py-1 text-xs tabular-nums text-muted-foreground focus-visible:outline-ring aria-pressed:bg-background aria-pressed:font-medium aria-pressed:text-foreground aria-pressed:shadow-xs"
          @click="selectRange(m)"
        >
          {{ label(m) }}
        </button>
      </div>
      <Select :model-value="range" @update:model-value="select">
        <SelectTrigger
          size="sm"
          class="w-auto @2xl:hidden"
          :aria-label="t(`${key}.range`)"
        >
          <SelectValue>{{ label(range) }}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem v-for="r in windows" :key="r" :value="r">
            {{ label(r) }}
          </SelectItem>
        </SelectContent>
      </Select>
    </header>
    <div
      class="grid divide-y @2xl:grid-cols-3 @2xl:divide-x @2xl:divide-y-0"
      :aria-busy="fresh && range !== load.historyRange"
    >
      <section class="grid min-w-0 content-start gap-1 px-4 pt-4 pb-2">
        <h3
          class="flex items-center gap-2 text-[13px] font-medium text-muted-foreground"
        >
          <CpuIcon class="size-4 text-brand-text" aria-hidden="true" />
          {{ t(`${key}.cpu`) }}
          <Popover>
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                class="-my-1 -ml-1"
                :aria-label="t(`${key}.cpuHelp`)"
              >
                <InfoIcon class="size-3.5" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" :aria-label="t(`${key}.cpuHelp`)">
              <p>
                {{ t(`${key}.cpuScale`, { one: percent(1) }) }}
                <template v-if="load.cpuCapacity !== null">
                  {{ t(`${key}.cpuFull`, { full: percent(load.cpuCapacity) }) }}
                </template>
              </p>
            </PopoverContent>
          </Popover>
          <span v-if="aggregated" class="ml-auto flex gap-2 text-xs">
            <span class="flex items-center gap-1"><i class="w-3 border-t-2 border-brand-text" />{{
              t(`${key}.mean`)
            }}</span>
            <span class="flex items-center gap-1"><i class="w-3 border-t-2 border-dashed border-chart-5" />{{
              t(`${key}.peak`)
            }}</span>
          </span>
        </h3>
        <p :class="metricClass">
          {{ value(load.cpuCores, percent) }}
        </p>
        <p class="min-h-4 text-xs text-muted-foreground tabular-nums">
          {{ availableCores }}
        </p>
        <LoadChart
          :history="load.history"
          :minutes="minutes"
          :end="load.historyEnd"
          :step="load.historyStepMs"
          :title="t(`${key}.cpu`)"
          :curves="curves.cpu"
          :format="percent"
          :floor="0.25"
        />
      </section>
      <section class="grid min-w-0 content-start gap-1 px-4 pt-4 pb-2">
        <h3
          class="flex items-center gap-2 text-[13px] font-medium text-muted-foreground"
        >
          <MemoryStickIcon class="size-4 text-chart-2" aria-hidden="true" />
          {{ t(`${key}.memory`) }}
          <Popover>
            <PopoverTrigger as-child>
              <Button
                variant="ghost"
                size="icon-xs"
                class="-my-1 -ml-1"
                :aria-label="t(`${key}.memoryHelp`)"
              >
                <InfoIcon class="size-3.5" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" :aria-label="t(`${key}.memoryHelp`)">
              {{ t(`${key}.memoryExplanation`) }}
            </PopoverContent>
          </Popover>
        </h3>
        <p class="flex flex-wrap items-baseline gap-x-1.5" :class="metricClass">
          <span>{{ value(load.memoryBytes, bytes) }}</span>
          <small
            v-if="load.memoryCacheBytes != null"
            class="text-xs font-normal tracking-normal text-muted-foreground"
          >{{
            t(`${key}.memoryCache`, { size: bytes(load.memoryCacheBytes) })
          }}</small>
        </p>
        <p class="min-h-4 text-xs text-muted-foreground tabular-nums">
          <template v-if="load.memoryBytes !== null && load.memoryLimit">
            {{
              t(`${key}.memoryCap`, {
                limit: bytes(load.memoryLimit),
                used: percent(load.memoryBytes / load.memoryLimit),
              })
            }}
          </template>
        </p>
        <LoadChart
          :history="load.history"
          :minutes="minutes"
          :end="load.historyEnd"
          :step="load.historyStepMs"
          :title="t(`${key}.memory`)"
          :curves="curves.memory"
          :format="bytes"
          :floor="1024 ** 2"
        />
      </section>
      <section class="grid min-w-0 content-start gap-1 px-4 pt-4 pb-2">
        <h3
          class="flex items-center gap-2 text-[13px] font-medium text-muted-foreground"
        >
          <NetworkIcon class="size-4 text-info" aria-hidden="true" />
          {{ t(`${key}.network`) }}
        </h3>
        <p
          class="grid min-h-9 grid-cols-2 items-center gap-x-2"
          :class="metricClass"
        >
          <span
            v-for="rate in liveRates"
            :key="rate.direction"
            class="flex items-baseline gap-1 whitespace-nowrap"
            :title="t(`${key}.${rate.direction}`)"
          >
            <component
              :is="rate.icon"
              class="size-4 shrink-0 self-center"
              :class="rate.color"
              aria-hidden="true"
            />
            {{ rate.number
            }}<small
              v-if="rate.unit"
              class="text-xs font-medium text-muted-foreground"
            >{{ rate.unit }}</small>
          </span>
        </p>
        <p class="flex min-h-4 gap-3 text-xs text-muted-foreground">
          <span class="flex items-center gap-1"><i class="w-3 border-t-2 border-info" />{{
            t(`${key}.receive`)
          }}</span>
          <span class="flex items-center gap-1"><i class="w-3 border-t-2 border-dashed border-chart-5" />{{
            t(`${key}.send`)
          }}</span>
          <span class="ml-auto">{{ t(`${key}.rateUnit`) }}</span>
        </p>
        <LoadChart
          :history="load.history"
          :minutes="minutes"
          :end="load.historyEnd"
          :step="load.historyStepMs"
          :title="t(`${key}.network`)"
          :curves="curves.network"
          :format="chartSpeed"
          :unit="t(`${key}.rateUnit`)"
          :floor="10_000"
        />
      </section>
    </div>
    <CardFooter
      class="min-h-11 gap-3 border-t bg-muted/50 px-5 py-3 text-[13px] text-muted-foreground [.border-t]:pt-3"
    >
      <span class="shrink-0 text-xs font-medium">{{
        t(`${key}.activity`)
      }}</span>
      <template v-if="fresh && activity">
        <Popover>
          <PopoverTrigger as-child>
            <button
              type="button"
              class="min-w-0 truncate rounded-sm text-left text-foreground tabular-nums hover:underline focus-visible:outline-ring"
            >
              {{ activity }}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" :aria-label="t(`${key}.activity`)">
            {{ activity }}
          </PopoverContent>
        </Popover>
        <svg
          v-if="load.analysis && load.analysis.total > 0"
          viewBox="0 0 20 20"
          fill="none"
          stroke-width="3"
          class="-ml-1 size-4 shrink-0"
          role="progressbar"
          :aria-label="t(`${key}.${load.analysis.stage}`)"
          :aria-valuenow="load.analysis.checked"
          :aria-valuemax="load.analysis.total"
          :aria-valuemin="0"
          :aria-valuetext="t(`${key}.progress`, load.analysis)"
        >
          <title>{{ t(`${key}.progress`, load.analysis) }}</title>
          <circle
            cx="10"
            cy="10"
            r="8"
            stroke="currentColor"
            class="text-muted-foreground/30"
          />
          <circle
            cx="10"
            cy="10"
            r="8"
            stroke="currentColor"
            class="text-brand-text"
            pathLength="100"
            stroke-dasharray="100"
            :stroke-dashoffset="
              100 * (1 - load.analysis.checked / load.analysis.total)
            "
            transform="rotate(-90 10 10)"
          />
        </svg>
      </template>
      <span v-else class="truncate">{{
        t(`${key}.${fresh ? "idle" : "stale"}`)
      }}</span>
    </CardFooter>
  </Card>
</template>
