<script setup lang="ts">
import type { StorageOverview } from '@torsher/api-client'
import { LibraryIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Card, CardTitle } from '@/components/ui/card'
import { formatBytes } from '~/lib/format'

const props = defineProps<{
  library: StorageOverview['library']
}>()

const { t, locale } = useI18n()

const bytes = (value: number) => formatBytes(value, locale.value)
const used = computed(() =>
  props.library.used > 0
    ? t('panel.settings.storage.library.usedValue', {
        used: bytes(props.library.used),
        shared: bytes(props.library.shared),
      })
    : t('panel.settings.storage.library.usedEmpty'),
)
</script>

<template>
  <Card class="gap-3 p-5">
    <CardTitle
      class="flex items-center gap-2 text-base font-semibold tracking-tight"
    >
      <LibraryIcon class="size-4 text-muted-foreground" aria-hidden="true" />
      {{ t("panel.settings.storage.library.title") }}
    </CardTitle>
    <dl
      class="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13.5px]"
    >
      <dt class="text-muted-foreground">
        {{ t("panel.settings.storage.library.used") }}
      </dt>
      <dd class="tabular-nums">
        {{ used }}
      </dd>
      <dt class="text-muted-foreground">
        {{ t("panel.settings.storage.library.links") }}
      </dt>
      <dd>
        {{
          t(`panel.settings.storage.library.${library.linkMode ?? "unknown"}`)
        }}
      </dd>
    </dl>
  </Card>
</template>
