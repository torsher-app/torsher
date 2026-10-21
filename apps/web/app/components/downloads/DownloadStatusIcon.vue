<script setup lang="ts">
import type { DownloadView } from '~/lib/downloadStatus'
import { cn } from '@/lib/utils'
import { toneText } from '~/lib/indexerStatus'

defineProps<{
  view: DownloadView
  label: string
}>()
</script>

<template>
  <span
    :class="cn('grid size-4 shrink-0 place-items-center', toneText[view.tone])"
    :title="label"
  >
    <component
      :is="view.icon"
      class="size-4"
      :class="{ 'animate-spin': view.status === 'resolving' }"
      aria-hidden="true"
    />
    <span class="sr-only">{{ label }}</span>
  </span>
</template>
