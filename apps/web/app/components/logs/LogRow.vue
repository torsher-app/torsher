<script setup lang="ts">
import type { LogEntry } from '@torsher/api-client'
import { AlignLeftIcon } from '@lucide/vue'
import { useI18n } from 'vue-i18n'
import { cn } from '@/lib/utils'
import { formatLogDateTime, formatLogTime, logSourceLabels } from '~/lib/logs'
import LogLevelIcon from './LogLevelIcon.vue'

const props = defineProps<{
  entry: LogEntry
  selected: boolean
}>()

const emit = defineEmits<{
  open: []
}>()

const { t, locale } = useI18n()

const time = computed(() => formatLogTime(props.entry.time, locale.value))
const fullTime = computed(() =>
  formatLogDateTime(props.entry.time, locale.value),
)
const repeat = computed(() => props.entry.repeat ?? 1)
</script>

<template>
  <!-- Строку открывает кнопка-сообщение, растянутая на всю строку -->
  <li
    :class="
      cn(
        'relative grid grid-cols-[auto_16px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 border-b py-2 pr-3 pl-4 text-[13.5px] leading-5 hover:bg-muted/50',
        'sm:h-9 sm:grid-cols-[60px_16px_104px_minmax(0,1fr)_auto] sm:py-0',
        selected && 'bg-muted/50 shadow-[inset_2px_0_0_var(--primary)]',
      )
    "
  >
    <time
      :datetime="entry.time"
      :title="fullTime"
      class="text-[12.5px] text-muted-foreground tabular-nums"
    >
      {{ time }}
    </time>
    <LogLevelIcon
      :level="entry.level"
      :label="t(`panel.logs.levels.${entry.level}`)"
    />
    <span class="min-w-0 truncate text-[13px] text-muted-foreground">
      {{ t(logSourceLabels[entry.source]) }}
    </span>
    <button
      type="button"
      class="col-span-4 row-start-2 min-w-0 truncate text-left font-mono text-[12.5px] outline-none after:absolute after:inset-0 focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset sm:col-span-1 sm:col-start-4 sm:row-start-1"
      :aria-current="selected || undefined"
      @click="emit('open')"
    >
      {{ entry.message }}
    </button>
    <span
      class="col-start-4 row-start-1 flex items-center justify-end gap-2 text-xs text-muted-foreground tabular-nums sm:col-start-5"
    >
      <span
        v-if="repeat > 1"
        :title="t('panel.logs.repeat', { n: repeat }, repeat)"
      >
        <span aria-hidden="true">×{{ repeat }}</span>
        <span class="sr-only">{{
          t("panel.logs.repeat", { n: repeat }, repeat)
        }}</span>
      </span>
      <span v-if="entry.details" :title="t('panel.logs.hasDetails')">
        <AlignLeftIcon class="size-3.5" aria-hidden="true" />
        <span class="sr-only">{{ t("panel.logs.hasDetails") }}</span>
      </span>
    </span>
  </li>
</template>
