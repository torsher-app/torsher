<script setup lang="ts">
import type { StorageOverview } from '@torsher/api-client'
import { HardDriveIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Card } from '@/components/ui/card'
import { formatBytes } from '~/lib/format'

const props = defineProps<{
  overview: StorageOverview
}>()

const { t, locale } = useI18n()

const bytes = (value: number) => formatBytes(value, locale.value)
function share(value: number) {
  return props.overview.total > 0
    ? `${(value / props.overview.total) * 100}%`
    : '0%'
}

// Порядок полосы: оставленное, кэш, чужое; свободное — фон дорожки
const segments = computed(() => [
  { key: 'kept', size: props.overview.keptUsed, class: 'bg-foreground' },
  { key: 'cache', size: props.overview.cacheUsed, class: 'bg-brand' },
  { key: 'other', size: props.overview.other, class: 'bg-muted-foreground/40' },
])
</script>

<template>
  <Card class="gap-3 p-5">
    <div
      class="flex items-center justify-between gap-3 text-[13px] text-muted-foreground"
    >
      <span class="flex min-w-0 items-center gap-2">
        <HardDriveIcon class="size-4 shrink-0" aria-hidden="true" />
        <span class="truncate font-mono text-xs">{{ overview.path }}</span>
      </span>
    </div>
    <p class="text-[22px] font-semibold tracking-tight tabular-nums">
      {{
        t("panel.settings.storage.disk.freeOf", {
          free: bytes(overview.free),
          total: bytes(overview.total),
        })
      }}
    </p>
    <div
      class="flex h-2 gap-0.5 overflow-hidden rounded-full bg-accent"
      role="img"
      :aria-label="
        t('panel.settings.storage.disk.label', {
          kept: bytes(overview.keptUsed),
          cache: bytes(overview.cacheUsed),
          other: bytes(overview.other),
          free: bytes(overview.free),
        })
      "
    >
      <i
        v-for="segment in segments"
        v-show="segment.size > 0"
        :key="segment.key"
        class="block h-full"
        :class="segment.class"
        :style="{ width: share(segment.size) }"
      />
    </div>
    <ul
      class="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[12.5px] text-muted-foreground tabular-nums"
    >
      <li
        v-for="segment in segments"
        :key="segment.key"
        class="flex items-center gap-1.5"
      >
        <i
          class="block size-2 rounded-xs"
          :class="segment.class"
          aria-hidden="true"
        />
        {{
          t(`panel.settings.storage.disk.${segment.key}`, {
            size: bytes(segment.size),
          })
        }}
      </li>
      <li class="flex items-center gap-1.5">
        <i
          class="block size-2 rounded-xs border bg-accent"
          aria-hidden="true"
        />
        {{
          t("panel.settings.storage.disk.free", { size: bytes(overview.free) })
        }}
      </li>
    </ul>
  </Card>
</template>
