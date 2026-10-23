<script setup lang="ts">
import type { PlaybackSettings } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  settings: PlaybackSettings
}>()

const { t } = useI18n()

const toneMapping = computed(() => {
  if (props.settings.gpuToneMapping)
    return 'gpu'

  return props.settings.softwareToneMapping ? 'software' : 'none'
})
</script>

<template>
  <SettingsCard
    :title="t('panel.settings.playback.transcode.title')"
    :description="t('panel.settings.playback.transcode.text')"
  >
    <dl class="grid gap-2">
      <div
        class="flex items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
      >
        <dt class="grid gap-0.5">
          <span class="font-semibold">{{
            t("panel.settings.playback.ceiling")
          }}</span>
          <span class="text-xs text-muted-foreground">
            {{
              settings.softwareFps
                ? t("panel.settings.playback.bench", {
                  fps: Math.round(settings.softwareFps),
                })
                : t("panel.settings.playback.noBench")
            }}
          </span>
        </dt>
        <dd class="font-semibold tabular-nums">
          {{
            settings.software
              ? `${settings.softwareMaxHeight}p`
              : t("panel.settings.playback.noSoftware")
          }}
        </dd>
      </div>
      <div
        class="flex items-start justify-between gap-4 rounded-lg border border-input px-3 py-2.5"
      >
        <dt class="grid gap-0.5">
          <span class="font-semibold">{{
            t("panel.settings.playback.toneMapping")
          }}</span>
          <span class="text-xs text-muted-foreground">
            {{ t(`panel.settings.playback.toneMappingHint.${toneMapping}`) }}
          </span>
        </dt>
        <dd class="font-semibold tabular-nums">
          {{ t(`panel.settings.playback.toneMappingValue.${toneMapping}`) }}
          <template v-if="toneMapping !== 'none'">
            · {{ settings.toneMappingMaxHeight }}p
          </template>
        </dd>
      </div>
    </dl>

    <template #hint>
      {{ t("panel.settings.playback.transcode.hint") }}
    </template>
  </SettingsCard>
</template>
