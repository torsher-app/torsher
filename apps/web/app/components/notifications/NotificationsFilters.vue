<script setup lang="ts">
import type { FeedGroup } from '~/lib/notifications'
import { useI18n } from 'vue-i18n'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { FEED_GROUPS } from '~/lib/notifications'

defineProps<{
  /** Непрочитанные по всей ленте: при выбранной группе число было бы враньём */
  unreadCount?: number
}>()

const { t } = useI18n()
const { group, unreadOnly } = useNotificationsQuery()

// В ToggleGroup нет пустого значения: «Все» — отдельный пункт
const ALL = 'all'

const CHIP
  = 'h-7 gap-1.5 border border-transparent px-2.5 text-[13px] font-normal text-muted-foreground hover:bg-transparent data-[state=on]:border-border data-[state=on]:bg-accent data-[state=on]:text-foreground'

// Повторный клик по выбранному чипу снимает выбор в ToggleGroup: остаёмся на нём
function onGroup(value: unknown) {
  if (typeof value !== 'string' || !value)
    return

  group.value = value === ALL ? undefined : (value as FeedGroup)
}
</script>

<template>
  <div
    class="no-scrollbar flex min-h-11 shrink-0 items-center gap-1 overflow-x-auto border-b py-1.5 pr-2.5 pl-3"
    role="toolbar"
    :aria-label="t('panel.notifications.feed.filtersLabel')"
  >
    <ToggleGroup
      type="single"
      :spacing="1"
      :model-value="group ?? ALL"
      class="shrink-0"
      @update:model-value="onGroup"
    >
      <ToggleGroupItem :value="ALL" :class="CHIP">
        {{ t("panel.notifications.feed.all") }}
      </ToggleGroupItem>
      <ToggleGroupItem
        v-for="item in FEED_GROUPS"
        :key="item"
        :value="item"
        :class="CHIP"
      >
        {{ t(`panel.notifications.feed.groups.${item}`) }}
      </ToggleGroupItem>
    </ToggleGroup>

    <Toggle v-model="unreadOnly" class="ml-auto shrink-0" :class="CHIP">
      {{ t("panel.notifications.feed.unread") }}
      <span
        v-if="unreadCount !== undefined && !group"
        class="text-muted-foreground/70 tabular-nums"
      >{{ unreadCount }}</span>
    </Toggle>
  </div>
</template>
