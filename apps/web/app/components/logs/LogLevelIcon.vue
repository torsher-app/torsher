<script setup lang="ts">
import type { LogLevel } from '~/lib/logs'
import { cn } from '@/lib/utils'
import { toneText } from '~/lib/indexerStatus'
import { logLevelView } from '~/lib/logs'

const props = defineProps<{
  level: LogLevel
  label: string
}>()

const view = computed(() => logLevelView(props.level))
</script>

<template>
  <span
    :class="cn('grid size-4 shrink-0 place-items-center', toneText[view.tone])"
    :title="label"
  >
    <component
      :is="view.icon"
      v-if="view.icon"
      class="size-4"
      aria-hidden="true"
    />
    <span
      v-else
      class="size-1.5 rounded-full bg-current opacity-60"
      aria-hidden="true"
    />
    <span class="sr-only">{{ label }}</span>
  </span>
</template>
