<script setup lang="ts">
import type { BackupItem } from '@torsher/api-client'
import {
  ArchiveRestoreIcon,
  DownloadIcon,
  EllipsisIcon,
  LockIcon,
  Trash2Icon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { backupReasonIcons, formatDayTime } from '~/lib/backups'
import { formatBytes, formatRelative } from '~/lib/format'

const props = defineProps<{
  item: BackupItem
  now: Date
}>()

const emit = defineEmits<{
  restore: []
  remove: []
}>()

const { t, locale } = useI18n()

const date = computed(() =>
  formatDayTime(props.item.createdAt, locale.value, undefined, props.now),
)
const relative = computed(() =>
  formatRelative(props.item.createdAt, locale.value, props.now.getTime()),
)
const reason = computed(() =>
  t(`panel.backups.list.reasons.${props.item.reason}`),
)
const downloadUrl = computed(
  () => `/api/backups/${encodeURIComponent(props.item.name)}/download`,
)
</script>

<template>
  <li
    class="group/row grid min-h-11 grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 border-b py-2 pr-2.5 pl-4 text-[13.5px] last:border-b-0 hover:bg-muted/50 dark:hover:bg-muted sm:py-1.5"
  >
    <component
      :is="backupReasonIcons[item.reason]"
      class="size-4 text-muted-foreground"
      :title="reason"
      aria-hidden="true"
    />
    <span class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        class="font-medium whitespace-nowrap tabular-nums"
        :title="relative"
      >
        {{ date }}
      </span>
      <Badge variant="secondary">{{ reason }}</Badge>
      <!-- Версия загруженной копии неизвестна, если имя файла не по шаблону -->
      <span
        v-if="item.version !== '0'"
        class="font-mono text-xs text-muted-foreground"
      >v{{ item.version }}</span>
      <span
        v-if="item.encrypted"
        class="inline-flex self-center text-muted-foreground"
        :title="t('panel.backups.list.encrypted')"
      >
        <LockIcon class="size-3.5" aria-hidden="true" />
        <span class="sr-only">{{ t("panel.backups.list.encrypted") }}</span>
      </span>
      <Badge
        v-if="item.dirKind === 'fallback'"
        variant="warning"
        :title="t('panel.backups.list.fallbackHint')"
      >
        {{ t("panel.backups.list.fallback") }}
      </Badge>
    </span>
    <span
      class="flex items-center justify-end gap-1 text-[12.5px] whitespace-nowrap text-muted-foreground tabular-nums"
    >
      {{ formatBytes(item.size, locale) }}
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="size-7 sm:opacity-50 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100 sm:aria-expanded:opacity-100"
            :aria-label="t('panel.backups.list.actions', { date })"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-48">
          <!-- Обычная ссылка: файл качает браузер, без Blob в памяти вкладки -->
          <DropdownMenuItem as-child>
            <a :href="downloadUrl" :download="item.name">
              <DownloadIcon aria-hidden="true" />
              {{ t("panel.backups.list.download") }}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem @select="emit('restore')">
            <ArchiveRestoreIcon aria-hidden="true" />
            {{ t("panel.backups.list.restore") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="emit('remove')">
            <Trash2Icon aria-hidden="true" />
            {{ t("panel.backups.list.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
