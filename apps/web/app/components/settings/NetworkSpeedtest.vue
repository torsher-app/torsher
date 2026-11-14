<script setup lang="ts">
import type { SpeedtestSample } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import type { SpeedtestFrame } from '~/lib/speedtestChart'
import { displayedInternetSpeed } from '~/lib/speedtestChart'
import SettingsCard from './SettingsCard.vue'
import SpeedtestChart from './SpeedtestChart.vue'

const { t, locale } = useI18n()
const test = useSpeedtest()
const emptySamples: SpeedtestSample[] = []
const emptyFrame: SpeedtestFrame = { download: null, upload: null }
const localFrame = shallowRef(emptyFrame)
const internetFrame = shallowRef(emptyFrame)
const localAnimating = ref(false)
const internetAnimating = ref(false)
function number(n: number | null | undefined) {
  return n == null
    ? '—'
    : n.toLocaleString(locale.value.replace('_', '-'), {
        maximumFractionDigits: 0,
        useGrouping: false,
      })
}
function speed(n: number | null | undefined) {
  return number(n == null ? null : (n * 8) / 1000000)
}
function retryTime(value: string) {
  return new Date(value).toLocaleString(locale.value.replace('_', '-'), {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
const local = computed(() => test.local.value.result)
const internet = computed(() => test.internet.value)
const localRate = computed(() => {
  const state = test.local.value.status
  if (['error', 'cancelled', 'insufficient'].includes(state))
    return local.value?.bytesPerSecond
  return test.localRunning.value || localAnimating.value
    ? localFrame.value.download
    : local.value?.bytesPerSecond
})
function internetRate(phase: 'download' | 'upload') {
  return displayedInternetSpeed(
    test.internetState.value,
    internet.value?.phase,
    phase,
    internet.value?.[phase].bytesPerSecond,
    internetFrame.value[phase],
    internetAnimating.value,
  )
}
</script>

<template>
  <section class="grid gap-4" :aria-label="t('speedtest.title')">
    <h2 class="text-base font-semibold">
      {{ t("speedtest.title") }}
    </h2>
    <div class="grid min-w-0 gap-4 xl:grid-cols-2">
      <SettingsCard
        :title="t('speedtest.localTitle')"
        :description="t('speedtest.browserNote')"
      >
        <p class="text-sm text-muted-foreground">
          {{ t("speedtest.localDirection") }}
        </p>
        <p role="status">
          {{ t(`speedtest.states.${test.local.value.status}`) }}
        </p>
        <p
          v-if="test.local.value.error"
          class="text-sm text-destructive"
          role="alert"
        >
          {{ t(`speedtest.errors.${test.local.value.error}`) }}
        </p>
        <p class="text-3xl font-semibold tabular-nums">
          {{ speed(localRate) }}
          <span class="text-sm font-normal text-muted-foreground">{{
            t("speedtest.mbps")
          }}</span>
        </p>
        <SpeedtestChart
          :samples="local?.samples ?? emptySamples"
          :running="test.localRunning.value"
          @frame="localFrame = $event"
          @drawing="localAnimating = $event"
        />
        <dl class="grid grid-cols-2 gap-2 text-sm tabular-nums">
          <dt class="text-muted-foreground">
            {{ t("speedtest.latency") }}
          </dt>
          <dd class="text-right">
            {{ number(local?.latencyMs) }} {{ t("speedtest.ms") }}
          </dd>
          <dt class="text-muted-foreground">
            {{ t("speedtest.duration") }}
          </dt>
          <dd class="text-right">
            {{ number(local ? local.durationMs / 1000 : null) }}
            {{ t("speedtest.seconds") }}
          </dd>
          <dt class="text-muted-foreground">
            {{ t("speedtest.payload") }}
          </dt>
          <dd class="text-right">
            {{ number(local ? local.payloadBytes / 1048576 : null) }} MiB
          </dd>
          <dt class="text-muted-foreground">
            {{ t("speedtest.startedAt") }}
          </dt>
          <dd class="text-right">
            {{
              local
                ? new Date(local.startedAt).toLocaleTimeString(
                  locale.replace("_", "-"),
                )
                : "—"
            }}
          </dd>
        </dl>
        <p v-if="local?.shortened" class="text-sm text-muted-foreground">
          {{ t("speedtest.shortened") }}
        </p>
        <template #hint>
          {{ t("speedtest.localBudget") }}
        </template>
        <template #action>
          <Button
            size="sm"
            :variant="test.localRunning.value ? 'outline' : 'default'"
            :disabled="!test.localRunning.value && test.internetRunning.value"
            @click="
              test.localRunning.value ? test.stopLocal() : test.startLocal()
            "
          >
            {{
              t(test.localRunning.value ? "speedtest.stop" : "speedtest.start")
            }}
          </Button>
        </template>
      </SettingsCard>
      <SettingsCard
        :title="t('speedtest.internetTitle')"
        :description="t('speedtest.internetNote')"
      >
        <p class="text-sm text-muted-foreground">
          {{ t("speedtest.internetDirection") }}
        </p>
        <p role="status">
          {{ t(`speedtest.states.${test.internetState.value}`)
          }}<template v-if="internet?.state === 'running'">
            · {{ t(`speedtest.phases.${internet.phase}`) }}
          </template>
        </p>
        <p
          v-if="test.internetError.value"
          class="text-sm text-destructive"
          role="alert"
        >
          {{ t(`speedtest.errors.${test.internetError.value}`) }}
        </p>
        <p
          v-if="
            internet?.reason
              && !['complete', 'byte_limit', 'cancelled'].includes(internet.reason)
          "
          class="text-sm text-destructive"
          role="alert"
        >
          {{
            internet.providerHttpStatus === 429
              ? t("speedtest.providerLimited")
              : t(`speedtest.reasons.${internet.reason}`)
          }}
          <span
            v-if="
              internet.reason === 'provider_http_error'
                && internet.providerHttpStatus !== undefined
            "
          >{{
            t("speedtest.httpStatus", { status: internet.providerHttpStatus })
          }}</span>
          <span
            v-if="
              internet.providerHttpStatus === 429 && internet.providerRetryAt
            "
            class="block"
          >
            {{
              t("speedtest.retryAfter", {
                time: retryTime(internet.providerRetryAt),
              })
            }}
          </span>
        </p>
        <div class="grid grid-cols-2 gap-3 tabular-nums">
          <div v-for="phase in ['download', 'upload'] as const" :key="phase">
            <p class="text-sm text-muted-foreground">
              {{ t(`speedtest.${phase}`) }}
            </p>
            <p class="text-2xl font-semibold">
              {{ speed(internetRate(phase)) }}
              <span class="text-xs font-normal">{{ t("speedtest.mbps") }}</span>
            </p>
            <p class="mt-1 text-xs text-muted-foreground">
              {{ number(internet ? internet[phase].durationMs / 1000 : null) }}
              {{ t("speedtest.seconds") }} ·
              {{
                number(internet ? internet[phase].payloadBytes / 1048576 : null)
              }}
              MiB
            </p>
            <p
              v-if="
                internet?.state === 'complete'
                  && internet[phase].bytesPerSecond === null
              "
              class="mt-1 text-xs"
            >
              {{ t("speedtest.states.insufficient") }}
            </p>
          </div>
        </div>
        <SpeedtestChart
          internet
          :samples="internet?.samples ?? emptySamples"
          :running="test.internetRunning.value"
          @frame="internetFrame = $event"
          @drawing="internetAnimating = $event"
        />
        <dl class="grid grid-cols-2 gap-2 text-sm">
          <dt class="text-muted-foreground">
            {{ t("speedtest.latency") }}
          </dt>
          <dd class="text-right tabular-nums">
            {{ number(internet?.latencyMs) }} {{ t("speedtest.ms") }}
          </dd>
          <dt class="text-muted-foreground">
            {{ t("speedtest.route") }}
          </dt>
          <dd class="text-right">
            {{ internet ? t(`speedtest.routes.${internet.route}`) : "—" }}
          </dd>
          <dt class="text-muted-foreground">
            {{ t("speedtest.dns") }}
          </dt>
          <dd class="text-right">
            {{ internet ? t(`speedtest.dnsTypes.${internet.dns}`) : "—" }}
          </dd>
          <dt class="text-muted-foreground">
            {{ t("speedtest.startedAt") }}
          </dt>
          <dd class="text-right">
            {{
              internet
                ? new Date(internet.startedAt).toLocaleTimeString(
                  locale.replace("_", "-"),
                )
                : "—"
            }}
          </dd>
        </dl>
        <p
          v-if="internet?.reason === 'byte_limit'"
          class="text-sm text-muted-foreground"
        >
          {{ t("speedtest.shortened") }}
        </p>
        <template #hint>
          {{ t("speedtest.internetBudget") }}
        </template>
        <template #action>
          <Button
            size="sm"
            :variant="test.internetRunning.value ? 'outline' : 'default'"
            :disabled="!test.internetRunning.value && test.localRunning.value"
            @click="
              test.internetRunning.value
                ? test.stopInternet()
                : test.startInternet()
            "
          >
            {{
              t(
                test.internetRunning.value
                  ? "speedtest.stop"
                  : "speedtest.start",
              )
            }}
          </Button>
        </template>
      </SettingsCard>
    </div>
  </section>
</template>
