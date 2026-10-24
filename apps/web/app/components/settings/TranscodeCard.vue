<script setup lang="ts">
import type { PlaybackSettings } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { toneMappingOf } from '~/lib/playback'
import SettingsCard from './SettingsCard.vue'

const props = defineProps<{
  settings: PlaybackSettings
}>()

const { t } = useI18n()

const toneMapping = computed(() => toneMappingOf(props.settings))

const toneMappingHint = computed(() => {
  if (toneMapping.value === 'none')
    return t('panel.settings.playback.toneMappingNone')

  const hint = t('panel.settings.playback.toneMappingHint')

  // Ниже 1080p — значит, перевод не успевает и кадр уменьшается
  return props.settings.toneMappingMaxHeight < 1080
    ? `${hint} ${t('panel.settings.playback.toneMappingLimit', {
      height: props.settings.toneMappingMaxHeight,
    })}`
    : hint
})
</script>

<template>
  <SettingsCard
    :title="t('panel.settings.playback.transcode.title')"
    :description="t('panel.settings.playback.transcode.text')"
  >
    <!-- На телефоне значение — под подсказкой: справа оно сжимало её в столбик -->
    <dl class="grid gap-2">
      <div
        class="grid gap-1 rounded-lg border border-input px-3 py-2.5 sm:flex sm:items-start sm:justify-between sm:gap-4"
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
        <dd class="font-semibold whitespace-nowrap tabular-nums">
          {{
            settings.software
              ? t("panel.settings.playback.ceilingValue", {
                height: settings.softwareMaxHeight,
              })
              : t("panel.settings.playback.noSoftware")
          }}
        </dd>
      </div>
      <div
        class="grid gap-1 rounded-lg border border-input px-3 py-2.5 sm:flex sm:items-start sm:justify-between sm:gap-4"
      >
        <dt class="grid gap-0.5">
          <span class="font-semibold">{{
            t("panel.settings.playback.toneMapping")
          }}</span>
          <span class="text-xs text-muted-foreground">
            {{ toneMappingHint }}
          </span>
        </dt>
        <dd class="font-semibold whitespace-nowrap tabular-nums">
          {{ t(`panel.settings.playback.toneMappingValue.${toneMapping}`) }}
          <template v-if="toneMapping !== 'none'">
            ·
            {{
              t("panel.settings.playback.ceilingValue", {
                height: settings.toneMappingMaxHeight,
              })
            }}
          </template>
        </dd>
      </div>
    </dl>

    <template #hint>
      {{ t("panel.settings.playback.transcode.hint") }}
    </template>
  </SettingsCard>
</template>
