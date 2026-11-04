<script setup lang="ts">
import type { MaintenanceStatus } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDateTime } from '~/lib/format'

defineProps<{ status: MaintenanceStatus, busy: boolean }>()
defineEmits<{ retry: [id: string], cancelFence: [id: string] }>()
const { t, locale } = useI18n()
function observedChange(bytes: number | null) {
  if (bytes === null)
    return t('panel.maintenance.unknown')
  return `${bytes < 0 ? '−' : ''}${formatBytes(Math.abs(bytes), locale.value)}`
}
</script>

<template>
  <section class="grid min-w-0 gap-3 text-[13px]">
    <h3 class="font-medium">
      {{ t("panel.maintenance.operations") }}
    </h3>
    <p
      v-if="!status.operations.length && !status.externalFences.length"
      class="text-muted-foreground"
    >
      {{ t("panel.maintenance.noOperations") }}
    </p>
    <article
      v-for="operation in status.operations"
      :key="operation.id"
      class="grid min-w-0 gap-2 rounded-lg border p-3"
    >
      <p class="break-words font-medium">
        {{ operation.titleName ?? operation.titleId }} ·
        {{ t(`panel.maintenance.states.${operation.state}`) }}
      </p>
      <p>
        {{
          operation.episodes.map((e) => `S${e.season} E${e.episode}`).join(", ")
        }}
      </p>
      <p class="text-muted-foreground">
        {{ formatDateTime(operation.updatedAt, locale) }}
      </p>
      <p v-if="operation.action === 'inspect_files'">
        {{ t("panel.maintenance.inspect") }}
      </p>
      <p v-if="operation.action === 'retry'">
        {{ t("panel.maintenance.retryHint") }}
      </p>
      <details class="min-w-0">
        <summary>
          {{ t("panel.maintenance.files", { count: operation.files.length }) }}
        </summary>
        <ul class="mt-2 grid gap-2">
          <li
            v-for="(file, index) in operation.files"
            :key="index"
            class="break-all"
          >
            <span class="font-medium">{{ file.name }} —
              {{ t(`panel.maintenance.results.${file.result}`) }}</span>
            <p class="text-xs text-muted-foreground">
              {{ file.path }}
            </p>
          </li>
        </ul>
      </details>
      <div
        v-for="(volume, index) in operation.volumes"
        :key="volume.volume"
        class="break-all text-xs text-muted-foreground"
      >
        {{
          t("panel.maintenance.observedChange", {
            volume: t("panel.maintenance.volume", { number: index + 1 }),
            size: observedChange(volume.observedFreeChange),
          })
        }}
      </div>
      <details v-if="operation.error">
        <summary>
          {{ t("panel.maintenance.details") }}
        </summary>
        <p class="break-all text-xs">
          {{ operation.error }}
        </p>
      </details>
      <Button
        v-if="operation.action === 'retry'"
        variant="outline"
        size="sm"
        :disabled="busy"
        @click="$emit('retry', operation.id)"
      >
        {{ t("panel.common.retry") }}
      </Button>
    </article>
    <article
      v-for="fence in status.externalFences"
      :key="fence.id"
      class="grid min-w-0 gap-2 rounded-lg border p-3"
    >
      <h4 class="font-medium">
        {{ t("panel.maintenance.externalFence") }}
      </h4>
      <p>
        {{
          t(
            fence.action === "review_history"
              ? "panel.maintenance.reviewHistory"
              : fence.action === "inspect_files"
                ? "panel.maintenance.inspect"
                : "panel.maintenance.cancelFenceHint",
          )
        }}
      </p>
      <details>
        <summary>
          {{ t("panel.maintenance.files", { count: fence.files.length }) }}
        </summary>
        <ul class="mt-2 grid gap-2">
          <li
            v-for="(file, index) in fence.files"
            :key="index"
            class="break-all"
          >
            <span>{{ file.name }} —
              {{ t(`panel.maintenance.results.${file.result}`) }}</span>
            <p class="text-xs text-muted-foreground">
              {{ file.path }}
            </p>
          </li>
        </ul>
        <p class="mt-2 break-all text-xs text-muted-foreground">
          {{ fence.id }} · {{ fence.state }}
        </p>
      </details>
      <Button
        v-if="fence.action === 'cancel_preserve_files'"
        variant="outline"
        size="sm"
        :disabled="busy"
        @click="$emit('cancelFence', fence.id)"
      >
        {{ t("panel.maintenance.cancelFence") }}
      </Button>
    </article>
  </section>
</template>
