<script setup lang="ts">
import type { AttentionItem } from '@torsher/api-client'
import { ChevronRightIcon, CircleAlertIcon, CircleXIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { formatBytes } from '~/lib/format'
import { attentionLinks } from '~/lib/overview'

defineProps<{
  items: AttentionItem[]
}>()

const { t, locale } = useI18n()

const sectionLabels: Record<AttentionItem['section'], string> = {
  downloads: 'panel.nav.torrents',
  library: 'panel.nav.library',
  storage: 'panel.settings.nav.storage',
  sources: 'panel.nav.sources',
  network: 'panel.settings.nav.network',
  metadata: 'panel.settings.nav.metadata',
  playback: 'panel.settings.nav.playback',
  logs: 'panel.nav.logs',
}

/** Текст причины: у проблемы с одним элементом — его имя, иначе — число */
function textOf(item: AttentionItem) {
  const key = `panel.overview.attention.${item.kind}`
  const { count = 0, name, reason, free = 0, minFree = 0 } = item.params

  switch (item.kind) {
    case 'engine_down':
    case 'tmdb_key_invalid':
      return t(`${key}.${reason}`)
    case 'engine_crashed':
      return t(key, { n: count }, count)
    case 'library_copies':
    case 'media_accel_failed':
      return t(key)
    case 'storage_low':
      return t(key, {
        free: formatBytes(free, locale.value),
        minFree: formatBytes(minFree, locale.value),
      })
    default:
      return name
        ? t(`${key}.one`, { name })
        : t(`${key}.many`, { n: count }, count)
  }
}
</script>

<template>
  <section class="grid gap-2.5" aria-labelledby="overview-attention">
    <h2
      id="overview-attention"
      class="flex items-baseline gap-2 text-[15px] font-semibold tracking-tight"
    >
      {{ t("panel.overview.attention.title") }}
      <span class="text-[13px] font-normal text-muted-foreground tabular-nums">
        {{ t("panel.overview.attention.count", items.length) }}
      </span>
    </h2>
    <ul class="divide-y overflow-hidden rounded-xl border">
      <li v-for="item in items" :key="item.kind">
        <NuxtLink
          :to="attentionLinks[item.section]"
          class="grid min-h-11 grid-cols-[16px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 text-[13.5px] outline-none hover:bg-muted/50 dark:hover:bg-muted focus-visible:bg-muted/50 dark:focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:items-center sm:py-2.5"
        >
          <component
            :is="item.severity === 'error' ? CircleXIcon : CircleAlertIcon"
            class="mt-0.5 size-4 sm:mt-0"
            :class="
              item.severity === 'error' ? 'text-destructive' : 'text-warning'
            "
            aria-hidden="true"
          />
          <span>
            <span class="sr-only">{{ t(`panel.overview.attention.${item.severity}`) }}:
            </span>
            {{ textOf(item) }}
          </span>
          <span
            class="mt-0.5 flex items-center gap-1 text-[13px] whitespace-nowrap text-muted-foreground sm:mt-0"
          >
            <span class="hidden sm:inline"><span class="sr-only">. </span>{{ t(sectionLabels[item.section]) }}</span>
            <ChevronRightIcon class="size-4" aria-hidden="true" />
          </span>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
