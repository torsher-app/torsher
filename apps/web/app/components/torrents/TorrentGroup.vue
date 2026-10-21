<script setup lang="ts">
import type { Torrent } from '@torsher/api-client'
import {
  CircleXIcon,
  EllipsisIcon,
  FileIcon,
  FilmIcon,
  Loader2Icon,
  MonitorPlayIcon,
  RotateCwIcon,
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
import ListGroup from '~/components/ListGroup.vue'
import { formatBytes } from '~/lib/format'
import { playerUrl } from '~/lib/torrents'

const props = defineProps<{
  torrent: Torrent
  /** Повтор уже идёт: кнопка крутится и не жмётся второй раз */
  retrying: boolean
}>()

const emit = defineEmits<{
  retry: []
  delete: []
}>()

const { t, locale } = useI18n()
const { tvUrl } = useRuntimeConfig().public

const meta = computed(() => {
  const { torrent } = props

  if (torrent.status === 'resolving')
    return t('panel.torrents.status.resolving')

  if (torrent.status === 'failed')
    return t(`panel.torrents.status.${torrent.error ?? 'failed'}`)

  return t(
    'panel.torrents.meta',
    {
      size: formatBytes(torrent.totalSize, locale.value),
      n: torrent.files.length,
    },
    torrent.files.length,
  )
})

const hasVideo = computed(() =>
  props.torrent.files.some(file => file.isVideo),
)
</script>

<template>
  <section :aria-label="torrent.name">
    <ListGroup :title="torrent.name">
      <template #meta>
        <span
          class="inline-flex items-center gap-1.5"
          :class="{ 'text-destructive': torrent.status === 'failed' }"
        >
          <Loader2Icon
            v-if="torrent.status === 'resolving'"
            class="size-3.5 animate-spin text-info"
            aria-hidden="true"
          />
          <CircleXIcon
            v-else-if="torrent.status === 'failed'"
            class="size-3.5"
            aria-hidden="true"
          />
          {{ meta }}
        </span>
      </template>
      <template #actions>
        <Button
          v-if="torrent.status === 'failed' && torrent.source === 'magnet'"
          variant="ghost"
          size="sm"
          class="h-7"
          :disabled="retrying"
          @click="emit('retry')"
        >
          <RotateCwIcon
            :class="{ 'animate-spin': retrying }"
            aria-hidden="true"
          />
          {{ t("panel.torrents.retry") }}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              class="size-7"
              :aria-label="t('panel.torrents.actions', { name: torrent.name })"
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-auto min-w-44">
            <DropdownMenuItem
              v-if="torrent.status === 'failed' && torrent.source === 'magnet'"
              :disabled="retrying"
              @select="emit('retry')"
            >
              <RotateCwIcon aria-hidden="true" />
              {{ t("panel.torrents.retry") }}
            </DropdownMenuItem>
            <DropdownMenuSeparator
              v-if="torrent.status === 'failed' && torrent.source === 'magnet'"
            />
            <DropdownMenuItem variant="destructive" @select="emit('delete')">
              <Trash2Icon aria-hidden="true" />
              {{ t("panel.common.delete") }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </template>
    </ListGroup>

    <ul v-if="torrent.status === 'ready'">
      <li
        v-for="file in torrent.files"
        :key="file.index"
        class="grid grid-cols-[16px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] sm:h-11 sm:grid-cols-[16px_minmax(0,1fr)_88px_auto] sm:py-0"
      >
        <component
          :is="file.isVideo ? FilmIcon : FileIcon"
          class="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <span
          class="min-w-0 truncate"
          :class="{ 'text-muted-foreground': !file.isVideo }"
          :title="file.path"
        >
          {{ file.path }}
        </span>
        <span
          class="col-start-2 row-start-2 text-[12.5px] text-muted-foreground tabular-nums sm:col-start-3 sm:row-start-1 sm:text-right"
        >
          {{ formatBytes(file.size, locale) }}
        </span>
        <span
          class="col-start-3 row-span-2 row-start-1 flex justify-end sm:col-start-4 sm:row-span-1"
        >
          <Button
            v-if="file.isVideo"
            as="a"
            variant="ghost"
            size="sm"
            :href="playerUrl(tvUrl, torrent.id, file.index)"
            target="_blank"
            rel="noopener"
            :aria-label="t('panel.torrents.openFile', { name: file.path })"
          >
            <MonitorPlayIcon aria-hidden="true" />
            <span class="hidden md:inline">{{ t("panel.torrents.open") }}</span>
          </Button>
        </span>
      </li>
      <li
        v-if="!hasVideo"
        class="border-b px-4 py-3 text-[13px] text-muted-foreground"
      >
        {{ t("panel.torrents.noVideo") }}
      </li>
    </ul>
  </section>
</template>
