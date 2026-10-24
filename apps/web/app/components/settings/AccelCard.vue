<script setup lang="ts">
import type { GpuEncoder, PlaybackSettings } from '@torsher/api-client'
import {
  ChevronRightIcon,
  CircleAlertIcon,
  CpuIcon,
  ExternalLinkIcon,
  MonitorCogIcon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDateTime } from '~/lib/format'
import {
  accelStatusOf,
  decodeLabelOf,
  HARDWARE_DOCS,
  mainGpuOf,
  vendorNameOf,
} from '~/lib/playback'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  settings: PlaybackSettings
}>()

const { t, locale } = useI18n()
const { setAccel, check } = usePlaybackSettings()

const isSaving = ref(false)
const isChecking = ref(false)

const status = computed(() => accelStatusOf(props.settings))
const gpu = computed(() => mainGpuOf(props.settings))

function gpuTitle(item: GpuEncoder) {
  const vendor = vendorNameOf(item)

  return vendor
    ? t('panel.settings.playback.gpu.named', { vendor })
    : t('panel.settings.playback.gpu.unnamed')
}

const gpuText = computed(() => {
  if (status.value === 'off')
    return t('panel.settings.playback.offText')

  const keys = gpu.value?.decode ?? []

  if (keys.length === 0)
    return t('panel.settings.playback.decodesNothing')

  const codecs = keys
    .map((key) => {
      const { codec, deep } = decodeLabelOf(key)

      return deep ? t('panel.settings.playback.deep', { codec }) : codec
    })
    .join(', ')

  return t('panel.settings.playback.decodes', { codecs })
})

const currentText = computed(() => {
  const date = formatDateTime(props.settings.checkedAt, locale.value)
  const vendor = gpu.value && vendorNameOf(gpu.value)

  if (status.value === 'gpu') {
    return vendor
      ? t('panel.settings.playback.current.gpuNamed', { vendor, date })
      : t('panel.settings.playback.current.gpu', { date })
  }

  return status.value === 'unavailable'
    ? t('panel.settings.playback.current.none', { date })
    : t('panel.settings.playback.current.software', { date })
})

/** Строки «Подробностей»: способ, устройство и драйвер, затем ошибки проб */
const details = computed(() => [
  ...props.settings.gpus.flatMap(item => [
    {
      key: `${item.encoder}:${item.device}:method`,
      label: t('panel.settings.playback.detail.method'),
      value: [
        item.encoder.toUpperCase(),
        item.lowPower && t('panel.settings.playback.lowPower'),
      ]
        .filter(Boolean)
        .join(' · '),
      code: false,
    },
    ...(item.device
      ? [
          {
            key: `${item.encoder}:${item.device}:device`,
            label: t('panel.settings.playback.detail.device'),
            value: item.device,
            code: true,
          },
        ]
      : []),
    ...(item.name
      ? [
          {
            key: `${item.encoder}:${item.device}:name`,
            label: t(
              `panel.settings.playback.detail.${item.encoder === 'nvenc' ? 'model' : 'driver'}`,
            ),
            value: item.name,
            code: false,
          },
        ]
      : []),
  ]),
  ...props.settings.failed.map(failure => ({
    key: `${failure.encoder}:${failure.device}:error`,
    label: [
      t('panel.settings.playback.detail.error'),
      failure.device ?? failure.encoder.toUpperCase(),
    ].join(' · '),
    value: failure.error,
    code: true,
  })),
])

async function onToggle(useGpu: boolean) {
  isSaving.value = true

  try {
    await setAccel(useGpu ? 'auto' : 'software')
  }
  finally {
    isSaving.value = false
  }
}

async function onCheck() {
  isChecking.value = true

  try {
    await check()
  }
  finally {
    isChecking.value = false
  }
}
</script>

<template>
  <SettingsCard
    :title="t('panel.settings.playback.accel.title')"
    :description="t('panel.settings.playback.accel.text')"
  >
    <Alert v-if="status === 'failed'" variant="warning">
      <TriangleAlertIcon />
      <AlertTitle>{{ t("panel.settings.playback.failed.title") }}</AlertTitle>
      <!-- Без <p>: у описания алерта отступ под абзацем на 16 px -->
      <AlertDescription class="grid gap-1.5">
        <span>{{ t("panel.settings.playback.failed.text") }}</span>
        <a
          :href="HARDWARE_DOCS"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex w-fit items-center gap-1 font-medium text-foreground"
        >
          {{ t("panel.settings.playback.fixLink") }}
          <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
        </a>
      </AlertDescription>
    </Alert>

    <Alert v-else-if="status === 'unavailable'" variant="destructive">
      <CircleAlertIcon />
      <AlertTitle>
        {{ t("panel.settings.playback.unavailable.title") }}
      </AlertTitle>
      <AlertDescription>
        {{ t("panel.settings.playback.unavailable.text") }}
      </AlertDescription>
    </Alert>

    <div
      v-else-if="gpu"
      class="flex items-start gap-3 rounded-lg border border-input px-3 py-2.5"
    >
      <MonitorCogIcon
        class="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div class="grid min-w-0 gap-0.5">
        <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span class="font-semibold">{{ gpuTitle(gpu) }}</span>
          <Badge :variant="status === 'gpu' ? 'success' : 'outline'">
            {{
              t(
                `panel.settings.playback.status.${status === "gpu" ? "working" : "off"}`,
              )
            }}
          </Badge>
        </span>
        <span class="text-xs text-muted-foreground">{{ gpuText }}</span>
      </div>
    </div>

    <div
      v-else
      class="flex items-start gap-3 rounded-lg border border-input px-3 py-2.5"
    >
      <CpuIcon
        class="mt-0.5 size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <div class="grid gap-0.5">
        <span class="font-semibold">{{
          t("panel.settings.playback.noGpu")
        }}</span>
        <span class="text-xs text-muted-foreground">
          {{ t("panel.settings.playback.noGpuHint") }}
        </span>
        <a
          :href="HARDWARE_DOCS"
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex w-fit items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline"
        >
          {{ t("panel.settings.playback.connectLink") }}
          <ExternalLinkIcon class="size-3.5" aria-hidden="true" />
        </a>
      </div>
    </div>

    <div
      v-if="settings.gpus.length > 0"
      class="flex items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
    >
      <Label for="accel-gpu" class="grid cursor-pointer gap-1 font-normal">
        <span class="font-semibold">{{
          t("panel.settings.playback.useGpu")
        }}</span>
        <span class="text-xs text-muted-foreground">
          {{ t("panel.settings.playback.useGpuHint") }}
        </span>
      </Label>
      <Switch
        id="accel-gpu"
        :model-value="settings.accel === 'auto'"
        :disabled="isSaving"
        @update:model-value="onToggle"
      />
    </div>

    <!-- Устройство, драйвер и ошибки проб нужны для отчёта, а не каждый день -->
    <details v-if="details.length > 0" class="group/details">
      <summary
        class="w-fit list-none rounded-sm text-[13px] font-medium text-muted-foreground outline-none select-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <span class="flex items-center gap-1">
          <ChevronRightIcon
            class="size-4 group-open/details:rotate-90"
            aria-hidden="true"
          />
          {{ t("panel.settings.playback.details") }}
        </span>
      </summary>
      <dl
        class="mt-2 grid gap-x-4 gap-y-1.5 rounded-lg border border-input bg-muted/50 px-3 py-2.5 text-[13px] sm:grid-cols-[max-content_minmax(0,1fr)]"
      >
        <template v-for="row in details" :key="row.key">
          <dt class="text-muted-foreground">
            {{ row.label }}
          </dt>
          <dd
            class="min-w-0 break-words"
            :class="{ 'font-mono text-xs leading-5': row.code }"
          >
            {{ row.value }}
          </dd>
        </template>
      </dl>
    </details>

    <template #hint>
      {{ currentText }}
    </template>
    <template #action>
      <LoadingButton
        type="button"
        variant="outline"
        size="sm"
        :loading="isChecking"
        @click="onCheck"
      >
        {{ t("panel.settings.playback.check") }}
      </LoadingButton>
    </template>
  </SettingsCard>
</template>
