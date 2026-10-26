<script setup lang="ts">
import type { NotificationItem } from '@torsher/api-client'
import {
  ArrowUpCircleIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CirclePlayIcon,
  CircleXIcon,
  DownloadIcon,
  EyeIcon,
  LibraryIcon,
  MonitorSmartphoneIcon,
  RefreshCwIcon,
  SearchXIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { formatDateTime, formatRelative } from '~/lib/format'
import {
  notificationLink,
  notificationText,
  notificationTitle,
} from '~/lib/notifications'

const props = defineProps<{
  item: NotificationItem
  now: number
}>()

const emit = defineEmits<{
  open: []
}>()

const { t, locale } = useI18n()
// Строка со ссылкой — ссылка, без неё — просто текст
const NuxtLink = resolveComponent('NuxtLink')

const icon = computed(() => {
  const { item } = props

  if (item.kind === 'problem') {
    if (item.resolvedAt)
      return { component: CircleCheckIcon, class: 'text-muted-foreground' }

    return item.severity === 'error'
      ? { component: CircleXIcon, class: 'text-destructive' }
      : { component: CircleAlertIcon, class: 'text-warning' }
  }

  switch (item.kind) {
    case 'update_available':
      return { component: ArrowUpCircleIcon, class: 'text-primary' }
    case 'server_updated':
      return { component: RefreshCwIcon, class: 'text-muted-foreground' }
    case 'download_completed':
      return { component: DownloadIcon, class: 'text-muted-foreground' }
    case 'device_paired':
      return {
        component: MonitorSmartphoneIcon,
        class: 'text-muted-foreground',
      }
    case 'follow_downloaded':
    case 'follow_upgraded':
      return { component: LibraryIcon, class: 'text-primary' }
    case 'follow_ready':
      return { component: CirclePlayIcon, class: 'text-primary' }
    case 'follow_missing':
      return { component: SearchXIcon, class: 'text-warning' }
    case 'follow_waiting':
    case 'follow_other_voice':
    case 'follow_topic_updated':
      return { component: EyeIcon, class: 'text-muted-foreground' }
    default:
      return { component: CircleAlertIcon, class: 'text-warning' }
  }
})

const title = computed(() => notificationTitle(t, locale.value, props.item))
const text = computed(() => notificationText(t, locale.value, props.item))
const link = computed(() => notificationLink(props.item))
const time = computed(() =>
  formatRelative(props.item.createdAt, locale.value, props.now),
)
</script>

<template>
  <component
    :is="link ? NuxtLink : 'div'"
    :to="link"
    class="grid grid-cols-[16px_minmax(0,1fr)_8px] items-start gap-x-3 px-4 py-3 text-[13.5px] outline-none"
    :class="
      link
        && 'hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset dark:hover:bg-muted dark:focus-visible:bg-muted'
    "
    @click="emit('open')"
  >
    <component
      :is="icon.component"
      class="mt-px size-4"
      :class="icon.class"
      aria-hidden="true"
    />
    <span class="grid min-w-0 gap-0.5">
      <span :class="item.resolvedAt && 'text-muted-foreground'">{{
        title
      }}</span>
      <span v-if="text" class="text-[12.5px] text-muted-foreground">{{
        text
      }}</span>
      <span
        class="text-[12px] text-muted-foreground tabular-nums"
        :title="formatDateTime(item.createdAt, locale)"
      >
        {{ time }}
        <template v-if="item.resolvedAt">
          · {{ t("panel.notifications.resolved") }}
        </template>
      </span>
    </span>
    <!-- Место под точку есть всегда: прочитанная строка не сдвигается -->
    <span
      class="mt-1.25 size-2 rounded-full"
      :class="item.readAt ? 'bg-transparent' : 'bg-primary'"
    >
      <span v-if="!item.readAt" class="sr-only">{{
        t("panel.notifications.unreadMark")
      }}</span>
    </span>
  </component>
</template>
