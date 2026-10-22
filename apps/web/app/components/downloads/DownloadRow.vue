<script setup lang="ts">
import type { Torrent } from '@torsher/api-client'
import {
  EllipsisIcon,
  MagnetIcon,
  PauseIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
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
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { progressOf } from '~/lib/downloadStatus'
import { toneText } from '~/lib/indexerStatus'
import DownloadStatusIcon from './DownloadStatusIcon.vue'

const props = defineProps<{
  torrent: Torrent
  selected: boolean
  busy: boolean
}>()

const emit = defineEmits<{
  open: []
  togglePause: []
  toggleKeep: []
  retry: []
  delete: []
}>()

const { t } = useI18n()
const status = useDownloadStatus()
const title = useTitleInfo(() => props.torrent.titleId)

const view = computed(() => status.viewOf(props.torrent))
const label = computed(() => status.label(view.value))
const reason = computed(() => status.reason(props.torrent, view.value))
const percent = computed(() => Math.floor(progressOf(props.torrent) * 100))
const name = computed(() => title.value?.title ?? props.torrent.name)

// Пауза имеет смысл, только пока раздача в движке
const canPause = computed(
  () => props.torrent.status === 'ready' && props.torrent.state !== 'idle',
)
const isPaused = computed(() => props.torrent.state === 'paused')
const canRetry = computed(
  () => props.torrent.status === 'failed' && props.torrent.source === 'magnet',
)

const progressClass = {
  brand: '*:data-[slot=progress-indicator]:bg-brand',
  success: '*:data-[slot=progress-indicator]:bg-success',
  muted: '*:data-[slot=progress-indicator]:bg-muted-foreground/50',
}
</script>

<template>
  <!-- Строку открывает кнопка-имя на всю строку: пауза и «⋯» лежат поверх неё -->
  <li
    :class="
      cn(
        'group/row relative grid grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 border-b py-2.5 pr-2.5 pl-4 text-[13.5px] hover:bg-muted/50 dark:hover:bg-muted',
        'md:h-14 md:grid-cols-[28px_minmax(0,1.3fr)_150px_minmax(0,1fr)_72px] md:py-0',
        selected
          && 'bg-muted/50 dark:bg-muted shadow-[inset_2px_0_0_var(--primary)]',
      )
    "
  >
    <span
      class="row-span-3 grid h-10 w-7 place-items-center self-start overflow-hidden rounded bg-muted text-muted-foreground md:row-span-1 md:self-center"
      aria-hidden="true"
    >
      <img
        v-if="title?.poster"
        :src="title.poster"
        alt=""
        class="size-full object-cover"
        loading="lazy"
      >
      <MagnetIcon v-else class="size-3.5" />
    </span>

    <span class="col-start-2 row-start-1 grid min-w-0">
      <button
        type="button"
        class="min-w-0 truncate text-left font-medium outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
        :aria-current="selected || undefined"
        :title="torrent.name"
        @click="emit('open')"
      >
        {{ name }}
      </button>
      <span class="truncate text-[12.5px] text-muted-foreground">
        {{ status.meta(torrent) }}
      </span>
    </span>

    <span
      class="col-span-2 col-start-2 row-start-2 flex min-w-0 items-center gap-2 text-[13px] whitespace-nowrap md:col-span-1 md:col-start-3 md:row-start-1"
    >
      <DownloadStatusIcon :view="view" :label="label" />
      <span class="truncate" :class="reason ? toneText[view.tone] : undefined">
        {{ reason || label }}
      </span>
    </span>

    <span
      v-if="torrent.status === 'ready'"
      class="col-span-2 col-start-2 row-start-3 grid min-w-0 gap-1 md:col-span-1 md:col-start-4 md:row-start-1"
    >
      <Progress
        :model-value="percent"
        :class="cn('h-1', progressClass[view.progressTone])"
        :aria-label="name"
      />
      <span class="truncate text-xs text-muted-foreground tabular-nums">
        {{ status.numbers(torrent, view) }}
      </span>
    </span>

    <span
      class="col-start-3 row-start-1 flex items-center justify-end gap-0.5 md:col-start-5"
    >
      <Button
        v-if="canPause"
        variant="ghost"
        size="icon-sm"
        class="relative size-7"
        :disabled="busy"
        :aria-label="
          t(isPaused ? 'panel.torrents.resumeFor' : 'panel.torrents.pauseFor', {
            name,
          })
        "
        @click="emit('togglePause')"
      >
        <component :is="isPaused ? PlayIcon : PauseIcon" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="relative size-7 md:opacity-50 md:group-focus-within/row:opacity-100 md:group-hover/row:opacity-100 md:aria-expanded:opacity-100"
            :class="{ 'md:opacity-100': selected }"
            :aria-label="t('panel.torrents.actions', { name })"
          >
            <EllipsisIcon />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-auto min-w-48">
          <DropdownMenuItem
            v-if="canRetry"
            :disabled="busy"
            @select="emit('retry')"
          >
            <RotateCwIcon aria-hidden="true" />
            {{ t("panel.torrents.retry") }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="torrent.status === 'ready'"
            :disabled="busy"
            @select="emit('toggleKeep')"
          >
            <component
              :is="torrent.retention === 'keep' ? PinOffIcon : PinIcon"
              aria-hidden="true"
            />
            {{
              t(
                torrent.retention === "keep"
                  ? "panel.torrents.unkeep"
                  : "panel.torrents.keep",
              )
            }}
          </DropdownMenuItem>
          <DropdownMenuItem
            v-if="canPause"
            :disabled="busy"
            @select="emit('togglePause')"
          >
            <component
              :is="isPaused ? PlayIcon : PauseIcon"
              aria-hidden="true"
            />
            {{ t(isPaused ? "panel.torrents.resume" : "panel.torrents.pause") }}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" @select="emit('delete')">
            <Trash2Icon aria-hidden="true" />
            {{ t("panel.common.delete") }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  </li>
</template>
