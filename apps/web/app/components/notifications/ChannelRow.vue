<script setup lang="ts">
import type { NotificationChannel } from '@torsher/api-client'
import {
  CircleAlertIcon,
  EllipsisIcon,
  PencilIcon,
  SendIcon,
  Trash2Icon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Switch } from '@/components/ui/switch'
import { formatDateTime, formatRelative } from '~/lib/format'
import {
  channelIcons,
  notificationGroupOrder,
} from '~/lib/notificationChannels'

const props = defineProps<{
  channel: NotificationChannel
  now: number
  toggling: boolean
}>()

const emit = defineEmits<{
  edit: []
  test: []
  remove: []
  toggle: [enabled: boolean]
}>()

const { t, locale } = useI18n()

const groups = computed(() => {
  const selected = notificationGroupOrder.filter(group =>
    props.channel.events.includes(group),
  )

  return selected.length
    ? selected
        .map(group => t(`panel.notifications.groups.${group}`))
        .join(', ')
    : t('panel.notifications.noEvents')
})
</script>

<template>
  <li
    class="grid grid-cols-[20px_minmax(0,1fr)_auto] items-start gap-x-3 px-4 py-3 text-[13.5px]"
  >
    <component
      :is="channelIcons[channel.kind]"
      class="mt-px size-4 text-muted-foreground"
      aria-hidden="true"
    />
    <span class="grid min-w-0 gap-0.5">
      <span class="truncate font-medium">{{ channel.name }}</span>
      <span class="truncate text-[12.5px] text-muted-foreground">
        {{ t(`panel.notifications.kinds.${channel.kind}`) }} · {{ groups }}
      </span>
      <span
        v-if="channel.lastError"
        class="inline-flex items-center gap-1 text-[12.5px] text-destructive tabular-nums"
        :title="formatDateTime(channel.lastError.at, locale)"
      >
        <CircleAlertIcon
          class="size-3.5 shrink-0 -translate-y-px"
          aria-hidden="true"
        />
        {{
          t("panel.notifications.failing", {
            reason: t(
              `panel.notifications.test.errors.${channel.lastError.kind}`,
            ),
          })
        }}
      </span>
      <span
        v-else-if="channel.lastSentAt"
        class="text-[12.5px] text-muted-foreground tabular-nums"
        :title="formatDateTime(channel.lastSentAt, locale)"
      >
        {{
          t("panel.notifications.lastSent", {
            time: formatRelative(channel.lastSentAt, locale, now),
          })
        }}
      </span>
      <span v-else class="text-[12.5px] text-muted-foreground">
        {{ t("panel.notifications.neverSent") }}
      </span>
    </span>
    <span class="flex items-center gap-1">
      <Switch
        :model-value="channel.enabled"
        :disabled="toggling"
        :aria-label="
          t('panel.notifications.enabledLabel', { name: channel.name })
        "
        @update:model-value="(value) => emit('toggle', value)"
      />
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground"
            :aria-label="
              t('panel.notifications.actions', { name: channel.name })
            "
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-48">
          <DropdownMenuItem @select="emit('edit')">
            <PencilIcon aria-hidden="true" />
            {{ t("panel.notifications.edit") }}
          </DropdownMenuItem>
          <DropdownMenuItem :disabled="!channel.enabled" @select="emit('test')">
            <SendIcon aria-hidden="true" />
            {{ t("panel.notifications.test.send") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="emit('remove')">
            <Trash2Icon aria-hidden="true" />
            {{ t("panel.common.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
