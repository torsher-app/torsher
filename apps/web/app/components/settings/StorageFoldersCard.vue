<script setup lang="ts">
import type { StorageFolder, StorageOverview } from '@torsher/api-client'
import type { StorageKind } from '~/composables/useStorage'
import {
  CircleAlertIcon,
  DownloadIcon,
  LibraryIcon,
  TriangleAlertIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import LoadingButton from '~/components/LoadingButton.vue'
import { formatBytes } from '~/lib/format'
import StoragePathDialog from './StoragePathDialog.vue'

const props = defineProps<{
  overview: StorageOverview
}>()

const { t, locale } = useI18n()
const { moveLeftovers, cancelMove } = useStorage()

const editing = ref<StorageKind | null>(null)
const dialogOpen = ref(false)
const pending = ref<'retry' | 'cancel' | null>(null)

const bytes = (value: number) => formatBytes(value, locale.value)

const move = computed(() => props.overview.move)
const running = computed(() => move.value?.status === 'running')

const rows = computed(() =>
  (['downloads', 'library'] as const).map(kind => ({
    kind,
    icon: kind === 'downloads' ? DownloadIcon : LibraryIcon,
    folder: props.overview.folders[kind],
  })),
)

function contents(kind: StorageKind, items: number, size: number) {
  if (!items)
    return t('panel.settings.storage.folders.empty')

  const count = t(
    `panel.settings.storage.folders.${kind === 'downloads' ? 'torrents' : 'files'}`,
    { n: items },
    items,
  )

  return `${count} · ${bytes(size)}`
}

function edit(kind: StorageKind) {
  editing.value = kind
  dialogOpen.value = true
}

// Ошибку показываем, пока в прежних папках что-то осталось: иначе
// повторять нечего, а перенесённое уже работает
function failedFor(kind: StorageKind, folder: StorageFolder) {
  return (
    move.value?.kind === kind
    && move.value.status === 'failed'
    && folder.leftovers.length > 0
  )
}

const percent = computed(() => {
  const value = move.value

  if (!value?.bytesTotal)
    return value?.itemsTotal ? (value.itemsDone / value.itemsTotal) * 100 : 0

  return (value.bytesDone / value.bytesTotal) * 100
})

const movingNote = computed(() => {
  const value = move.value

  if (!value)
    return ''

  if (value.waiting) {
    return t(
      `panel.settings.storage.folders.${value.kind === 'downloads' ? 'waitingStream' : 'waitingEngine'}`,
    )
  }

  return value.currentName ?? ''
})

// Итог переноса — тостом, когда опрос увидел конец
watch(
  () => move.value?.status,
  (status, previous) => {
    if (previous !== 'running')
      return

    if (status === 'done')
      toast.success(t('panel.settings.storage.folders.done'))
    else if (status === 'cancelled')
      toast.info(t('panel.settings.storage.folders.cancelled'))
  },
)

async function retry(kind: StorageKind) {
  pending.value = 'retry'

  try {
    await moveLeftovers(kind)
  }
  finally {
    pending.value = null
  }
}

async function stop() {
  pending.value = 'cancel'

  try {
    await cancelMove()
  }
  finally {
    pending.value = null
  }
}
</script>

<template>
  <Card class="gap-0 py-0">
    <div class="grid gap-1 p-5 pb-4">
      <CardTitle class="text-base font-semibold tracking-tight">
        {{ t("panel.settings.storage.folders.title") }}
      </CardTitle>
      <CardDescription class="max-w-[62ch]">
        {{ t("panel.settings.storage.folders.text") }}
      </CardDescription>
    </div>

    <ul class="divide-y border-t">
      <li
        v-for="row in rows"
        :key="row.kind"
        class="grid grid-cols-1 gap-3 px-5 py-4"
      >
        <div class="flex items-start gap-3">
          <component
            :is="row.icon"
            class="mt-0.5 size-4 shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
          <div class="grid min-w-0 flex-1 gap-1">
            <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span class="font-medium">
                {{ t(`panel.settings.storage.folders.${row.kind}`) }}
              </span>
              <Badge
                v-if="row.folder.source === 'env'"
                variant="secondary"
                :title="t('panel.settings.storage.folders.defaultHint')"
              >
                {{ t("panel.settings.storage.folders.default") }}
              </Badge>
            </div>
            <span
              class="truncate font-mono text-xs leading-5"
              :title="row.folder.path"
            >
              {{ row.folder.path }}
            </span>
            <!-- Части строки не рвутся: «460,4 ГБ» не разъезжается по строкам -->
            <span
              class="flex flex-wrap gap-x-1.5 text-[12.5px] text-muted-foreground tabular-nums"
            >
              <span class="whitespace-nowrap">
                {{
                  t("panel.settings.storage.folders.free", {
                    free: bytes(row.folder.free),
                    total: bytes(row.folder.total),
                  })
                }}
                ·
              </span>
              <span class="whitespace-nowrap">
                {{ contents(row.kind, row.folder.items, row.folder.bytes) }}
              </span>
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="running"
            :aria-label="
              t('panel.settings.storage.folders.changeLabel', {
                name: t(`panel.settings.storage.folders.${row.kind}`),
              })
            "
            @click="edit(row.kind)"
          >
            {{ t("panel.settings.storage.folders.change") }}
          </Button>
        </div>

        <!-- Ход переноса: строки постоянной высоты, полоса не прыгает -->
        <div
          v-if="running && move?.kind === row.kind"
          class="grid gap-2 rounded-lg border bg-muted/40 p-3"
          aria-live="polite"
        >
          <div class="flex items-center justify-between gap-3 text-[13px]">
            <span class="font-medium tabular-nums">
              {{
                t("panel.settings.storage.folders.moving", {
                  done: move.itemsDone,
                  total: move.itemsTotal,
                })
              }}
            </span>
            <LoadingButton
              variant="ghost"
              size="sm"
              :loading="pending === 'cancel'"
              @click="stop"
            >
              {{ t("panel.settings.storage.folders.cancel") }}
            </LoadingButton>
          </div>
          <Progress :model-value="percent" class="bg-foreground/10" />
          <div
            class="flex min-h-5 justify-between gap-3 text-[12.5px] text-muted-foreground"
          >
            <span class="min-w-0 truncate" :title="movingNote">
              {{ movingNote }}
            </span>
            <span class="shrink-0 tabular-nums">
              {{
                t("panel.settings.storage.folders.movingBytes", {
                  done: bytes(move.bytesDone),
                  total: bytes(move.bytesTotal),
                })
              }}
            </span>
          </div>
        </div>

        <template v-else>
          <Alert v-if="failedFor(row.kind, row.folder)" variant="destructive">
            <CircleAlertIcon />
            <AlertTitle>
              {{ t("panel.settings.storage.folders.failedTitle") }}
            </AlertTitle>
            <AlertDescription>
              {{
                t(
                  `panel.settings.storage.folders.failed.${move?.error ?? "failed"}`,
                )
              }}
            </AlertDescription>
          </Alert>

          <div
            v-for="leftover in row.folder.leftovers"
            :key="leftover.path"
            class="flex items-center gap-3 rounded-lg border bg-muted/40 py-2 pr-2 pl-3 text-[12.5px] text-muted-foreground"
          >
            <div class="grid min-w-0 flex-1 gap-0.5">
              <span
                class="truncate font-mono text-xs text-foreground"
                :title="leftover.path"
              >
                {{ leftover.path }}
              </span>
              <span class="tabular-nums">
                {{
                  t("panel.settings.storage.folders.leftover", {
                    items: t(
                      `panel.settings.storage.folders.${row.kind === "downloads" ? "torrents" : "files"}`,
                      { n: leftover.items },
                      leftover.items,
                    ),
                    size: bytes(leftover.bytes),
                  })
                }}
              </span>
            </div>
            <LoadingButton
              variant="ghost"
              size="sm"
              class="shrink-0"
              :loading="pending === 'retry'"
              :disabled="running"
              @click="retry(row.kind)"
            >
              {{
                failedFor(row.kind, row.folder)
                  ? t("panel.settings.storage.folders.retry")
                  : t("panel.settings.storage.folders.moveHere")
              }}
            </LoadingButton>
          </div>
        </template>
      </li>
    </ul>

    <div v-if="overview.library.linkMode === 'copy'" class="border-t p-5">
      <Alert variant="warning">
        <TriangleAlertIcon />
        <AlertTitle>
          {{ t("panel.settings.storage.folders.copyTitle") }}
        </AlertTitle>
        <AlertDescription>
          {{ t("panel.settings.storage.folders.copyText") }}
        </AlertDescription>
      </Alert>
    </div>

    <StoragePathDialog
      v-if="editing"
      v-model:open="dialogOpen"
      :kind="editing"
      :overview="overview"
    />
  </Card>
</template>
