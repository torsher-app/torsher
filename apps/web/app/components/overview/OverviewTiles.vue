<script setup lang="ts">
import type { OverviewResponse } from '@torsher/api-client'
import {
  ArchiveIcon,
  ArrowDownToLineIcon,
  CircleCheckIcon,
  CircleXIcon,
  HardDriveIcon,
  MonitorPlayIcon,
  MonitorSmartphoneIcon,
  PlayIcon,
  RadarIcon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { capitalize, formatWhen } from '~/lib/backups'
import { formatBytes } from '~/lib/format'
import {
  accelStatusOf,
  mainGpuOf,
  toneMappingOf,
  vendorNameOf,
} from '~/lib/playback'
import OverviewTile from './OverviewTile.vue'

const props = defineProps<{
  overview: OverviewResponse
}>()

const { t, locale } = useI18n()

const bytes = (value: number) => formatBytes(value, locale.value)
const now = useNow({ interval: 60_000 })

/** Плитка копий: когда была последняя, и всё ли в порядке */
const backups = computed(() => {
  const value = props.overview.backups
  const key = 'panel.overview.tiles.backups'

  return {
    title: value.lastSuccessAt
      ? capitalize(
          formatWhen(t, value.lastSuccessAt, locale.value, { now: now.value }),
          locale.value,
        )
      : t(`${key}.${value.enabled ? 'none' : 'off'}`),
    muted: !value.lastSuccessAt,
    footer: value.failing
      ? t(`${key}.failing`)
      : t(`${key}.${value.enabled ? 'ok' : 'offHint'}`),
  }
})

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

/** Плитка ускорения: заголовок, строка под ним и потолки в футере */
const playback = computed(() => {
  const settings = props.overview.playback
  const key = 'panel.overview.tiles.playback'

  if (!settings) {
    return {
      status: 'checking' as const,
      title: t(`${key}.checking`),
      hint: t(`${key}.checkingHint`),
      limits: '',
    }
  }

  const status = accelStatusOf(settings)
  const gpu = mainGpuOf(settings)
  const vendor = gpu && vendorNameOf(gpu)
  const hdr
    = toneMappingOf(settings) !== 'none'
      && t(`${key}.hdr`, { height: settings.toneMappingMaxHeight })
  const cpu
    = settings.software
      && t(`${key}.cpu`, { height: settings.softwareMaxHeight })

  if (status === 'gpu') {
    return {
      status,
      title: vendor
        ? t('panel.settings.playback.gpu.named', { vendor })
        : t('panel.settings.playback.gpu.unnamed'),
      hint: t(`${key}.gpuHint`),
      limits: hdr || '',
    }
  }

  return {
    status,
    title: t(`${key}.${status}`),
    hint: t(`${key}.${status}Hint`),
    limits: [cpu, hdr].filter(Boolean).join(' · '),
  }
})
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
            class="size-4 shrink-0 -translate-y-px text-success"
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
          <PlayIcon
            class="size-4 shrink-0 -translate-y-px"
            aria-hidden="true"
          />
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

    <!-- Шесть плиток — ровная сетка 2×3 без дыры -->
    <OverviewTile
      to="/settings/playback"
      :title="t('panel.settings.nav.playback')"
      :icon="MonitorPlayIcon"
    >
      <p class="text-[22px] font-semibold tracking-tight">
        {{ playback.title }}
      </p>
      <p class="flex items-center gap-2 text-[13px] text-muted-foreground">
        <CircleCheckIcon
          v-if="playback.status === 'gpu'"
          class="size-4 shrink-0 -translate-y-px text-success"
          aria-hidden="true"
        />
        <TriangleAlertIcon
          v-else-if="playback.status === 'failed'"
          class="size-4 shrink-0 -translate-y-px text-warning"
          aria-hidden="true"
        />
        {{ playback.hint }}
      </p>
      <template #footer>
        <span class="tabular-nums">{{ playback.limits }}</span>
      </template>
    </OverviewTile>

    <OverviewTile
      to="/settings/backups"
      :title="t('panel.settings.nav.backups')"
      :icon="ArchiveIcon"
    >
      <p
        class="text-[22px] font-semibold tracking-tight tabular-nums"
        :class="{ 'text-muted-foreground': backups.muted }"
      >
        {{ backups.title }}
      </p>
      <p
        v-if="overview.backups.lastSuccessAt"
        class="text-[13px] text-muted-foreground"
      >
        {{ t("panel.overview.tiles.backups.last") }}
      </p>
      <template #footer>
        <CircleXIcon
          v-if="overview.backups.failing"
          class="size-4 shrink-0 -translate-y-px text-destructive"
          aria-hidden="true"
        />
        <CircleCheckIcon
          v-else-if="overview.backups.enabled"
          class="size-4 shrink-0 -translate-y-px text-success"
          aria-hidden="true"
        />
        {{ backups.footer }}
      </template>
    </OverviewTile>
  </div>
</template>
