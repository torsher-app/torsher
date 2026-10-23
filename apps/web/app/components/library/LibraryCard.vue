<script setup lang="ts">
import type { Library, LibraryFolder } from '@torsher/api-client'
import {
  EllipsisIcon,
  FilmIcon,
  FolderIcon,
  LibraryIcon,
  LoaderCircleIcon,
  PlusIcon,
  RefreshCwIcon,
  VideoIcon,
} from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { formatBytes, formatRelative } from '~/lib/format'

/**
 * Библиотека: тип, папки со статусом, числом файлов и временем скана.
 * Своя раскладка Torsher — только чтение: её папку не отключить и не удалить
 */
const props = defineProps<{
  library: Library
  now: number
}>()

const emit = defineEmits<{
  addFolder: []
  settings: []
  files: []
  remove: []
  scan: [folder: LibraryFolder]
  removeFolder: [folder: LibraryFolder]
}>()

const { t, locale } = useI18n()

type Tone = 'success' | 'warning' | 'destructive' | 'secondary' | 'info'

const STATUS_TONE: Record<LibraryFolder['status'], Tone> = {
  ok: 'success',
  empty: 'secondary',
  offline: 'destructive',
  denied: 'destructive',
  scanning: 'info',
}

function meta(folder: LibraryFolder) {
  return [
    t('panel.library.folder.files', folder.files),
    formatBytes(folder.size, locale.value),
    folder.scannedAt
      ? t('panel.library.folder.scanned', {
          when: formatRelative(folder.scannedAt, locale.value, props.now),
        })
      : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

// Что требует внимания у папки: пропавшие, нераспознанные, наблюдатель
function notes(folder: LibraryFolder) {
  return [
    folder.pending ? t('panel.library.folder.pending', folder.pending) : '',
    folder.missing ? t('panel.library.folder.missing', folder.missing) : '',
    folder.unsure ? t('panel.library.folder.unsure', folder.unsure) : '',
    folder.unmatched
      ? t('panel.library.folder.unmatched', folder.unmatched)
      : '',
    folder.watcher === 'network'
      ? t('panel.library.folder.watcherNetwork')
      : folder.watcher === 'failed'
        ? t('panel.library.folder.watcherFailed')
        : '',
  ].filter(Boolean)
}
</script>

<template>
  <Card class="gap-0 py-0">
    <!-- Все строки карточки — на одной сетке: колонка иконок 32 px, текст правее -->
    <div
      class="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 px-5 pt-4 pb-3"
    >
      <span
        class="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <!-- Как на витрине: полка — своя раскладка, камера — домашнее видео -->
        <LibraryIcon v-if="library.managed" class="size-4" />
        <VideoIcon v-else-if="library.kind === 'home'" class="size-4" />
        <FilmIcon v-else class="size-4" />
      </span>
      <div class="grid min-w-0">
        <CardTitle class="truncate text-base font-semibold tracking-tight">
          {{ library.managed ? t("panel.library.managed") : library.name }}
        </CardTitle>
        <span class="text-[12.5px] text-muted-foreground">
          {{
            library.managed
              ? t("panel.library.managedText")
              : t(`panel.library.kinds.${library.kind}`)
          }}
        </span>
      </div>
      <DropdownMenu v-if="!library.managed">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            :aria-label="t('panel.library.actions')"
          >
            <EllipsisIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="min-w-48">
          <DropdownMenuItem @select="emit('addFolder')">
            {{ t("panel.library.addFolder.title") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="library.kind === 'home'"
            @select="emit('files')"
          >
            {{ t("panel.library.files.title") }}
          </DropdownMenuItem>
          <DropdownMenuItem @select="emit('settings')">
            {{ t("panel.library.settings.title") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="emit('remove')">
            {{ t("panel.library.remove.action") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <ul class="divide-y border-t">
      <li
        v-for="folder in library.folders"
        :key="folder.id"
        class="grid grid-cols-[32px_minmax(0,1fr)_auto] items-start gap-3 px-5 py-3"
      >
        <FolderIcon
          class="mt-0.5 size-4 justify-self-center text-muted-foreground"
          aria-hidden="true"
        />
        <div class="grid min-w-0 gap-1">
          <div class="flex min-w-0 items-center gap-2">
            <span class="truncate font-mono text-xs" :title="folder.path">{{
              folder.path
            }}</span>
            <Badge :variant="STATUS_TONE[folder.status]" class="shrink-0">
              <LoaderCircleIcon
                v-if="folder.status === 'scanning'"
                class="animate-spin"
                aria-hidden="true"
              />
              {{ t(`panel.library.status.${folder.status}`) }}
            </Badge>
          </div>
          <span class="text-[12.5px] text-muted-foreground tabular-nums">
            {{ meta(folder) }}
          </span>
          <span
            v-for="note in notes(folder)"
            :key="note"
            class="text-[12.5px] text-warning"
          >{{ note }}</span>
          <span
            v-if="
              folder.error
                && (folder.status === 'offline' || folder.status === 'denied')
            "
            class="text-[12.5px] text-destructive"
          >{{ t(`panel.library.statusText.${folder.status}`) }}</span>
        </div>
        <div v-if="!library.managed" class="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="folder.status === 'scanning'"
            :aria-label="t('panel.library.folder.scan')"
            :title="t('panel.library.folder.scan')"
            @click="emit('scan', folder)"
          >
            <RefreshCwIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            class="text-muted-foreground"
            @click="emit('removeFolder', folder)"
          >
            {{ t("panel.library.folder.remove") }}
          </Button>
        </div>
      </li>
    </ul>

    <button
      v-if="!library.managed"
      type="button"
      class="grid w-full grid-cols-[32px_minmax(0,1fr)] items-center gap-3 rounded-b-xl border-t px-5 py-2.5 text-left text-[13.5px] font-medium outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      @click="emit('addFolder')"
    >
      <PlusIcon
        class="size-4 justify-self-center text-muted-foreground"
        aria-hidden="true"
      />
      {{ t("panel.library.addFolder.title") }}
    </button>
  </Card>
</template>
