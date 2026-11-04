<script setup lang="ts">
import type { MaintenanceGroup, MaintenancePreview } from '@torsher/api-client'
import { MaintenanceReason } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDateTime } from '~/lib/format'

const props = defineProps<{
  preview: MaintenancePreview
  busy: boolean
  stale: boolean
}>()
defineEmits<{ protect: [group: MaintenanceGroup] }>()
const { t, locale } = useI18n()
// Одна нумерация для сводки и файлов всех групп в этой оценке.
const volumeIds = computed(() => [
  ...new Set(
    [
      ...props.preview.volumes.map(volume => volume.volume),
      ...props.preview.groups.flatMap(group =>
        group.files.map(file => file.volume),
      ),
    ].filter((volume): volume is string => volume !== null),
  ),
])
function volumeLabel(volume: string | null) {
  return volume === null
    ? t('panel.maintenance.unknownVolume')
    : t('panel.maintenance.volume', {
        number: volumeIds.value.indexOf(volume) + 1,
      })
}
</script>

<template>
  <div class="grid min-w-0 gap-3 text-[13px]">
    <p class="text-muted-foreground">
      {{ t("panel.maintenance.estimate") }}
    </p>
    <p v-if="stale" class="text-warning" role="status">
      {{ t("panel.maintenance.stale") }}
    </p>
    <p v-if="!preview.groups.length">
      {{ t("panel.maintenance.empty") }}
    </p>
    <div
      v-for="volume in preview.volumes"
      :key="volume.volume ?? 'unknown'"
      class="break-all text-muted-foreground"
    >
      {{ volumeLabel(volume.volume) }}:
      {{ formatBytes(volume.logicalBytes, locale) }}
    </div>
    <p v-if="preview.volumes.length" class="text-xs text-muted-foreground">
      {{ t("panel.maintenance.sizeEstimate") }}
    </p>
    <p v-if="preview.groups.length" class="text-muted-foreground">
      {{ t("panel.maintenance.wholeGroup") }}
    </p>
    <article
      v-for="group in preview.groups"
      :key="group.id"
      class="grid min-w-0 gap-2 rounded-lg border p-3"
    >
      <p class="font-medium">
        {{
          group.episodes.map((e) => `S${e.season} E${e.episode}`).join(", ")
            || t("panel.maintenance.movie")
        }}
      </p>
      <p v-if="group.candidate">
        {{ t("panel.maintenance.candidate") }}
      </p>
      <ul class="list-disc pl-4 text-muted-foreground">
        <li v-for="reason in group.reasons" :key="reason">
          {{ t(`panel.maintenance.reasons.${reason}`) }}
        </li>
      </ul>
      <p v-if="group.eligibleAt">
        {{
          t("panel.maintenance.eligibleAt", {
            date: formatDateTime(group.eligibleAt, locale),
          })
        }}
      </p>
      <details class="min-w-0">
        <summary>
          {{ t("panel.maintenance.files", { count: group.files.length }) }} ·
          {{ formatBytes(group.logicalBytes, locale) }}
        </summary>
        <ul class="mt-2 grid gap-2">
          <li
            v-for="(file, index) in group.files"
            :key="index"
            class="break-all text-xs text-muted-foreground"
          >
            {{ file.name }} · {{ formatBytes(file.size, locale) }} ·
            {{ volumeLabel(file.volume) }}
          </li>
        </ul>
      </details>
      <Button
        v-if="!group.reasons.includes(MaintenanceReason.Legacy)"
        type="button"
        variant="outline"
        size="sm"
        :disabled="busy || stale"
        @click="$emit('protect', group)"
      >
        {{
          t(
            group.protected
              ? "panel.maintenance.unprotect"
              : "panel.maintenance.protect",
          )
        }}
      </Button>
    </article>
  </div>
</template>
