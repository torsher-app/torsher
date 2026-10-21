<script setup lang="ts">
import type { StorageOverview } from '@torsher/api-client'
import { ArrowRightIcon } from '@lucide/vue'
import { useNow } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import { formatBytes, formatDateTime, formatRelative } from '~/lib/format'
import SettingsCard from './SettingsCard.vue'

defineProps<{
  queue: StorageOverview['queue']
}>()

const { t, locale } = useI18n()
const now = useNow({ interval: 30_000 })
</script>

<template>
  <SettingsCard
    :title="t('panel.settings.storage.queue.title')"
    :description="t('panel.settings.storage.queue.text')"
  >
    <ol v-if="queue.length > 0" class="grid rounded-lg border">
      <li
        v-for="item in queue"
        :key="item.torrentId"
        class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 border-b px-3 py-2 text-[13px] last:border-b-0"
      >
        <span class="min-w-0 truncate font-medium" :title="item.name">{{
          item.name
        }}</span>
        <span class="text-right text-muted-foreground tabular-nums">
          {{ formatBytes(item.sizeOnDisk, locale) }}
        </span>
        <span
          class="col-span-2 text-xs text-muted-foreground"
          :title="
            item.lastAccessAt
              ? formatDateTime(item.lastAccessAt, locale)
              : undefined
          "
        >
          {{
            item.lastAccessAt
              ? t("panel.settings.storage.queue.watched", {
                when: formatRelative(
                  item.lastAccessAt,
                  locale,
                  now.getTime(),
                ),
              })
              : t("panel.settings.storage.queue.notWatched")
          }}
        </span>
      </li>
    </ol>
    <p v-else class="text-[13px] text-muted-foreground">
      {{ t("panel.settings.storage.queue.empty") }}
    </p>
    <template #action>
      <Button variant="outline" size="sm" as-child>
        <NuxtLink to="/downloads?filter=cache">
          {{ t("panel.settings.storage.queue.open") }}
          <ArrowRightIcon aria-hidden="true" />
        </NuxtLink>
      </Button>
    </template>
  </SettingsCard>
</template>
