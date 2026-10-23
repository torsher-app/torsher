<script setup lang="ts">
import type { PlaybackSettings } from '@torsher/api-client'
import { CpuIcon, MonitorCogIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDateTime } from '~/lib/format'
import { decodeLabelOf } from '~/lib/playback'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  settings: PlaybackSettings
}>()

const { t, locale } = useI18n()
const { setAccel, check } = usePlaybackSettings()

const isSaving = ref(false)
const isChecking = ref(false)

function decodeText(keys: string[]) {
  return keys
    .map((key) => {
      const { codec, deep } = decodeLabelOf(key)

      return deep ? t('panel.settings.playback.deep', { codec }) : codec
    })
    .join(', ')
}

const encoderText = computed(() =>
  t(`panel.settings.playback.encoder.${props.settings.encoder ?? 'none'}`),
)

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
    <ul v-if="settings.gpus.length > 0" class="grid gap-2">
      <li
        v-for="gpu in settings.gpus"
        :key="`${gpu.encoder}:${gpu.device}`"
        class="flex items-start gap-3 rounded-lg border border-input px-3 py-2.5"
      >
        <MonitorCogIcon
          class="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div class="grid min-w-0 gap-0.5">
          <span class="font-semibold">
            {{ t(`panel.settings.playback.encoder.${gpu.encoder}`) }}
            <span v-if="gpu.name" class="font-normal text-muted-foreground">
              · {{ gpu.name }}
            </span>
          </span>
          <span class="text-xs text-muted-foreground">
            {{
              [
                gpu.device,
                gpu.lowPower ? t("panel.settings.playback.lowPower") : null,
                gpu.decode.length > 0
                  ? t("panel.settings.playback.decodes", {
                    codecs: decodeText(gpu.decode),
                  })
                  : t("panel.settings.playback.decodesNothing"),
              ]
                .filter(Boolean)
                .join(" · ")
            }}
          </span>
        </div>
      </li>
    </ul>
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
      </div>
    </div>

    <div
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
        :model-value="settings.accel === 'auto' && settings.gpus.length > 0"
        :disabled="isSaving || settings.gpus.length === 0"
        @update:model-value="onToggle"
      />
    </div>

    <template #hint>
      {{
        t("panel.settings.playback.current", {
          encoder: encoderText,
          date: formatDateTime(settings.checkedAt, locale),
        })
      }}
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
