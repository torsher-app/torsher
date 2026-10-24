<script setup lang="ts">
import type { BackupStatus } from '@torsher/api-client'
import { CircleAlertIcon, FolderIcon, TriangleAlertIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { formatBytes } from '~/lib/format'
import BackupDirDialog from './BackupDirDialog.vue'

const props = defineProps<{
  status: BackupStatus
}>()

const { t, locale } = useI18n()

const base = 'panel.backups.dir'
const dialogOpen = ref(false)

const dir = computed(() => props.status.dir)
const space = computed(() =>
  dir.value.available && dir.value.total
    ? t(`${base}.free`, {
        free: formatBytes(dir.value.free ?? 0, locale.value),
        total: formatBytes(dir.value.total, locale.value),
      })
    : '',
)
</script>

<template>
  <Card class="min-w-0 gap-0 py-0">
    <div class="grid gap-1 p-5 pb-4">
      <CardTitle class="text-base font-semibold tracking-tight">
        {{ t(`${base}.title`) }}
      </CardTitle>
      <CardDescription class="max-w-[62ch]">
        {{ t(`${base}.text`) }}
      </CardDescription>
    </div>

    <!-- min-w-0 по цепочке: длинный путь сокращается, а не распирает карточку -->
    <div class="grid min-w-0 gap-3 border-t px-5 py-4">
      <div class="flex min-w-0 items-start gap-3">
        <FolderIcon
          class="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden="true"
        />
        <div class="grid min-w-0 flex-1 gap-1">
          <div class="flex min-w-0 items-baseline gap-2">
            <span
              class="min-w-0 truncate font-mono text-xs leading-5"
              :title="dir.path"
            >
              {{ dir.path }}
            </span>
            <Badge
              variant="secondary"
              class="shrink-0"
              :title="
                dir.source === 'default' ? t(`${base}.defaultHint`) : undefined
              "
            >
              {{ t(`${base}.${dir.source}`) }}
            </Badge>
          </div>
          <!-- Строка тома постоянной высоты: недоступный каталог не сдвигает кнопку -->
          <span
            class="min-h-5 text-[12.5px] text-muted-foreground tabular-nums"
          >
            {{ space }}
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          class="shrink-0"
          @click="dialogOpen = true"
        >
          {{ t(`${base}.change`) }}
        </Button>
      </div>

      <Alert v-if="!dir.available" variant="destructive" class="min-w-0">
        <CircleAlertIcon />
        <AlertTitle>{{ t(`${base}.unavailableTitle`) }}</AlertTitle>
        <AlertDescription>{{ t(`${base}.unavailableText`) }}</AlertDescription>
      </Alert>
      <Alert
        v-else-if="dir.sameVolumeAsDatabase"
        variant="warning"
        class="min-w-0"
      >
        <TriangleAlertIcon />
        <AlertDescription>{{ t(`${base}.sameVolume`) }}</AlertDescription>
      </Alert>
    </div>

    <BackupDirDialog v-model:open="dialogOpen" :status="status" />
  </Card>
</template>
