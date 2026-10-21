<script setup lang="ts">
import type { OverviewResponse } from '@torsher/api-client'
import {
  ArrowDownToLineIcon,
  CircleCheckIcon,
  HardDriveIcon,
  MonitorSmartphoneIcon,
  PlayIcon,
  RadarIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatBytes } from '~/lib/format'
import OverviewTile from './OverviewTile.vue'

const props = defineProps<{
  overview: OverviewResponse
}>()

const { t, locale } = useI18n()

const bytes = (value: number) => formatBytes(value, locale.value)

const storage = computed(() => props.overview.storage)
const used = computed(() =>
  Math.max(0, storage.value.total - storage.value.free),
)
const usedPercent = computed(() =>
  storage.value.total > 0 ? (used.value / storage.value.total) * 100 : 0,
)
const isLow = computed(
  () => storage.value.total > 0 && storage.value.free < storage.value.minFree,
)
</script>

<template>
  <div class="grid gap-4 sm:grid-cols-2">
    <OverviewTile
      to="/downloads"
      :title="t('panel.nav.torrents')"
      :icon="ArrowDownToLineIcon"
    >
      <template v-if="overview.downloads.active > 0" #badge>
        <!-- Янтарная точка, как у пункта навигации, пока что-то качается -->
        <i class="size-1.75 rounded-full bg-brand" aria-hidden="true" />
      </template>
      <p class="text-[22px] font-semibold tracking-tight tabular-nums">
        {{
          overview.downloads.active > 0
            ? t(
              "panel.overview.tiles.downloads.active",
              overview.downloads.active,
            )
            : t("panel.overview.tiles.downloads.idle")
        }}
      </p>
      <p class="text-[13px] text-muted-foreground tabular-nums">
        {{
          t("panel.overview.tiles.downloads.speed", {
            down: bytes(overview.downloads.downloadSpeed),
            up: bytes(overview.downloads.uploadSpeed),
          })
        }}
      </p>
      <template #footer>
        <span class="tabular-nums">{{
          overview.downloads.total > 0
            ? t(
              "panel.overview.tiles.downloads.total",
              overview.downloads.total,
            )
            : t("panel.overview.tiles.downloads.empty")
        }}</span>
      </template>
    </OverviewTile>

    <OverviewTile
      to="/settings/storage"
      :title="t('panel.settings.nav.storage')"
      :icon="HardDriveIcon"
    >
      <p
        class="text-[22px] font-semibold tracking-tight tabular-nums"
        :class="{ 'text-destructive': isLow }"
      >
        {{
          t("panel.settings.storage.disk.freeOf", {
            free: bytes(storage.free),
            total: bytes(storage.total),
          })
        }}
      </p>
      <Progress
        :model-value="usedPercent"
        :class="
          cn(
            'mt-1 h-2 bg-accent',
            isLow
              ? '*:data-[slot=progress-indicator]:bg-destructive'
              : '*:data-[slot=progress-indicator]:bg-brand',
          )
        "
        :aria-label="
          t('panel.overview.tiles.storage.label', {
            used: bytes(used),
            total: bytes(storage.total),
          })
        "
      />
      <template #footer>
        <span class="tabular-nums">{{
          t("panel.overview.tiles.storage.legend", {
            used: bytes(storage.usedByCache),
            limit: bytes(storage.cacheLimit),
            reserve: bytes(storage.minFree),
          })
        }}</span>
      </template>
    </OverviewTile>

    <OverviewTile
      to="/sources"
      :title="t('panel.nav.sources')"
      :icon="RadarIcon"
    >
      <p class="text-[22px] font-semibold tracking-tight tabular-nums">
        {{
          overview.sources.total > 0
            ? t(
              "panel.overview.tiles.sources.working",
              { ok: overview.sources.ok, n: overview.sources.total },
              overview.sources.total,
            )
            : t("panel.overview.tiles.sources.empty")
        }}
      </p>
      <template #footer>
        <template v-if="overview.sources.total === 0">
          {{ t("panel.overview.tiles.sources.emptyHint") }}
        </template>
        <template v-else-if="overview.sources.ok === overview.sources.total">
          <CircleCheckIcon
            class="size-4 shrink-0 text-success"
            aria-hidden="true"
          />
          {{ t("panel.overview.tiles.sources.allWorking") }}
        </template>
        <template v-else>
          {{ t("panel.overview.tiles.sources.notAll") }}
        </template>
      </template>
    </OverviewTile>

    <OverviewTile
      to="/people"
      :title="t('panel.nav.people')"
      :icon="MonitorSmartphoneIcon"
    >
      <p class="text-[22px] font-semibold tracking-tight tabular-nums">
        {{
          overview.devices.total > 0
            ? t("panel.overview.tiles.devices.count", overview.devices.total)
            : t("panel.overview.tiles.devices.empty")
        }}
      </p>
      <template #footer>
        <template v-if="overview.devices.total === 0">
          {{ t("panel.overview.tiles.devices.emptyHint") }}
        </template>
        <span
          v-else-if="overview.devices.watching > 0"
          class="flex items-center gap-2 text-info"
        >
          <PlayIcon class="size-4 shrink-0" aria-hidden="true" />
          {{
            t(
              "panel.overview.tiles.devices.watching",
              overview.devices.watching,
            )
          }}
        </span>
        <template v-else>
          {{ t("panel.overview.tiles.devices.idle") }}
        </template>
      </template>
    </OverviewTile>
  </div>
</template>
