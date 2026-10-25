<script setup lang="ts">
import type { BlocklistItem } from '@torsher/api-client'
import { useI18n } from 'vue-i18n'
import { Skeleton } from '@/components/ui/skeleton'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatDate, formatDateTime } from '~/lib/format'

const props = defineProps<{
  item: BlocklistItem
  removing: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  remove: []
}>()

const { t, locale } = useI18n()
const text = useFollowText()
const title = useFollowTitle(() => props.item.titleId)

const term = computed(() =>
  props.item.expiresAt
    ? t('panel.follow.blocklist.until', {
        date: formatDate(props.item.expiresAt, locale.value),
      })
    : t('panel.follow.blocklist.forever'),
)
</script>

<template>
  <li
    class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto]"
  >
    <span class="grid min-w-0">
      <span class="truncate font-medium">
        <template v-if="title">{{ title.title }}</template>
        <Skeleton v-else class="inline-block h-3.5 w-28 align-middle" />
      </span>
      <span
        class="truncate font-mono text-xs text-muted-foreground"
        :title="item.releaseTitle"
      >{{ item.releaseTitle }}</span>
    </span>
    <span
      class="col-start-1 row-start-2 truncate text-[13px] text-muted-foreground md:col-start-2 md:row-start-1"
      :title="formatDateTime(item.createdAt, locale)"
    >
      {{ text.blockReason(item.reason) }} · {{ term }}
    </span>
    <LoadingButton
      variant="ghost"
      size="sm"
      class="col-start-2 row-span-2 md:col-start-3 md:row-span-1"
      :loading="removing"
      :disabled="disabled"
      @click="emit('remove')"
    >
      {{ t("panel.follow.blocklist.remove") }}
    </LoadingButton>
  </li>
</template>
