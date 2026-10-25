<script setup lang="ts">
import type { FollowQueueItem } from '@torsher/api-client'
import { ClockIcon, DownloadIcon, EyeIcon, HardDriveIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { toneText } from '~/lib/indexerStatus'

const props = defineProps<{
  item: FollowQueueItem
}>()

const { t } = useI18n()
const text = useFollowText()
const title = useFollowTitle(() => props.item.titleId)

const VIEW = {
  pending: { icon: ClockIcon, tone: 'muted' },
  downloading: { icon: DownloadIcon, tone: 'info' },
  no_space: { icon: HardDriveIcon, tone: 'destructive' },
} as const

const view = computed(() => VIEW[props.item.kind])
const percent = computed(() =>
  typeof props.item.progress === 'number'
    ? Math.floor(props.item.progress * 100)
    : null,
)
</script>

<template>
  <li
    class="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-x-3 gap-y-1.5 border-b py-2.5 pr-4 pl-4 text-[13.5px] md:h-14 md:grid-cols-[28px_minmax(0,1.2fr)_minmax(0,1fr)] md:py-0"
  >
    <span
      class="row-span-2 grid h-10 w-7 place-items-center self-start overflow-hidden rounded bg-muted text-muted-foreground md:row-span-1 md:self-center"
      aria-hidden="true"
    >
      <img
        v-if="title?.poster"
        :src="title.poster"
        alt=""
        class="size-full object-cover"
        loading="lazy"
      >
      <EyeIcon v-else class="size-3.5" />
    </span>

    <span class="grid min-w-0">
      <span class="truncate font-medium">
        <template v-if="title">{{ title.title }}</template>
        <Skeleton v-else class="inline-block h-3.5 w-28 align-middle" />
        <span class="ml-1 font-normal text-muted-foreground tabular-nums">{{
          text.episodes(item.season, item.episodes)
        }}</span>
      </span>
      <span
        class="truncate font-mono text-xs text-muted-foreground"
        :title="item.releaseTitle"
      >
        {{ item.releaseTitle }}
      </span>
    </span>

    <span class="col-start-2 grid min-w-0 gap-1 md:col-start-3">
      <span class="flex min-w-0 items-center gap-2 text-[13px]">
        <component
          :is="view.icon"
          :class="cn('size-4 shrink-0 -translate-y-px', toneText[view.tone])"
          aria-hidden="true"
        />
        <span
          class="truncate"
          :class="
            view.tone === 'destructive' ? toneText.destructive : undefined
          "
        >
          {{ text.queue(item) }}
        </span>
        <span
          v-if="item.followState === 'paused'"
          class="shrink-0 text-[12.5px] text-muted-foreground"
        >· {{ t("panel.follow.queue.paused") }}</span>
      </span>
      <Progress
        v-if="item.kind === 'downloading' && percent !== null"
        :model-value="percent"
        class="h-1 *:data-[slot=progress-indicator]:bg-brand"
        :aria-label="title?.title ?? item.releaseTitle"
      />
    </span>
  </li>
</template>
