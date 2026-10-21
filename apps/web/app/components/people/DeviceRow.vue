<script setup lang="ts">
import type { Device } from '@torsher/api-client'
import {
  EllipsisIcon,
  GlobeIcon,
  MonitorSmartphoneIcon,
  PencilIcon,
  TvMinimalIcon,
  UnplugIcon,
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
import { formatDateTime, formatRelative } from '~/lib/format'

const props = defineProps<{
  device: Device
  now: number
}>()

const emit = defineEmits<{
  rename: []
  revoke: []
}>()

const { t, locale } = useI18n()
const meta = useProfileMeta()

const icon = computed(
  () =>
    ({ tv: TvMinimalIcon, browser: GlobeIcon, other: MonitorSmartphoneIcon })[
      props.device.type
    ],
)
const seenAt = computed(
  () => props.device.lastSeenAt ?? props.device.createdAt,
)
</script>

<template>
  <li
    class="group/row relative grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] hover:bg-muted/50 sm:h-11 sm:grid-cols-[20px_minmax(0,190px)_minmax(0,1fr)_150px] sm:py-0 xl:grid-cols-[20px_190px_minmax(0,1fr)_150px_150px]"
  >
    <span
      class="row-span-2 mt-1 grid size-5 place-items-center self-start text-muted-foreground sm:row-span-1 sm:mt-0 sm:self-center"
      :title="meta.typeOf(device)"
    >
      <component :is="icon" class="size-4" aria-hidden="true" />
      <span class="sr-only">{{ meta.typeOf(device) }}</span>
    </span>
    <span class="col-start-2 row-start-1 min-w-0 truncate font-medium">
      {{ device.name }}
    </span>
    <span
      class="col-span-2 col-start-2 row-start-2 truncate text-[13px] text-muted-foreground sm:col-span-1 sm:col-start-3 sm:row-start-1"
    >
      {{
        [
          meta.typeOf(device),
          device.profile?.name ?? t("panel.people.devices.noProfile"),
        ].join(" · ")
      }}
    </span>
    <span
      class="hidden truncate font-mono text-xs text-muted-foreground/80 xl:col-start-4 xl:row-start-1 xl:block"
    >
      {{ device.address }}
    </span>
    <span
      class="col-start-3 row-start-1 flex items-center justify-end gap-1 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums sm:col-start-4 xl:col-start-5"
    >
      <span
        v-if="device.watching"
        class="flex items-center gap-1.5 font-medium text-info"
      >
        <span class="size-1.5 rounded-full bg-current" aria-hidden="true" />
        {{ t("panel.people.devices.watching") }}
      </span>
      <span v-else :title="formatDateTime(seenAt, locale)">
        {{ formatRelative(seenAt, locale, now) }}
      </span>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="relative size-7 sm:opacity-50 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100 sm:aria-expanded:opacity-100"
            :aria-label="
              t('panel.people.devices.actions', { name: device.name })
            "
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-44">
          <DropdownMenuItem @select="emit('rename')">
            <PencilIcon aria-hidden="true" />
            {{ t("panel.people.devices.rename") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="emit('revoke')">
            <UnplugIcon aria-hidden="true" />
            {{ t("panel.people.devices.revoke") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
